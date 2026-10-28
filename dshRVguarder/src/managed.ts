/** 随插件分发的原生后端：校验平台及内容，托管单一子进程，不下载或执行外部脚本。 */
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, toNamespacedPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';

export interface ManagedBinding { projectDir: string; instanceId: string; stateDir: string; }
export interface ManagedConfig { backendMode?: 'managed' | 'external'; managedBinding?: ManagedBinding; resourceWorkspace?: string; }
export interface DeploymentStatus { mode: 'managed' | 'external'; state: 'starting' | 'ready' | 'failed' | 'stopped'; reason?: string; }
export interface Connection { backendUrl: string; tokenFile: string; instanceId: string; stateDir: string; }
export interface Deployment { directory: string; workspace: string; home: string; profile: string; instanceId: string; stateDir?: string; }
interface Manifest { schema: number; platform: string; arch: string; executable: string; files: Record<string, string>; }
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 任一方向的包含都属于资源根与私有存储重叠。 */
function overlaps(left: string, right: string): boolean {
  const contains = (parent: string, child: string) => { const path = relative(parent, child); return path === '' || (!path.startsWith('..') && !isAbsolute(path)); };
  return contains(left, right) || contains(right, left);
}

/** 拒绝路径逃逸、链接、缺失及篡改；manifest 是随平台包交付的完整文件清单。 */
export function verifyBackend(root = join(packageRoot, 'backend')): string {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Manifest;
  const executable = process.platform === 'win32' ? 'rvguarder-backend.exe' : 'rvguarder-backend';
  if (manifest.schema !== 1 || manifest.platform !== process.platform || manifest.arch !== process.arch || manifest.executable !== executable || !manifest.files || typeof manifest.files !== 'object') throw new Error('RVguarder backend platform/manifest mismatch');
  const actual = new Set<string>();
  const walk = (dir: string) => {
    if (lstatSync(dir).isSymbolicLink()) throw new Error('RVguarder backend links are forbidden');
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('RVguarder backend links are forbidden');
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) actual.add(relative(root, path).replaceAll('\\', '/'));
      else throw new Error('RVguarder backend contains non-regular file');
    }
  };
  walk(root); actual.delete('manifest.json');
  if (!Object.hasOwn(manifest.files, executable) || Object.keys(manifest.files).length !== actual.size) throw new Error('RVguarder backend inventory mismatch');
  for (const [name, digest] of Object.entries(manifest.files)) {
    if (!actual.has(name) || !/^[a-f0-9]{64}$/.test(digest) || createHash('sha256').update(readFileSync(join(root, name))).digest('hex') !== digest) throw new Error('RVguarder backend integrity check failed');
  }
  return realpathSync(join(root, executable));
}

/** 只使用宿主注入的 profile 事实与工作区默认值，不读工具参数或浏览器输入。 */
export function deploymentFor(ctx: Context, binding?: ManagedBinding, resourceWorkspace?: string): Deployment {
  const profile = ctx.get('profileContext') as { home: string; name: string; cwd: string } | undefined;
  if (!profile || !isAbsolute(profile.home) || !/^[a-zA-Z0-9_.-]{1,128}$/.test(profile.name) || ['.', '..'].includes(profile.name)) throw new Error('Managed backend requires trusted DSH profileContext');
  // 服务的受控资源命名空间属于 profile 配置，不以启动终端或任一会话的 cwd 作为实例绑定。
  // 工具调用的真实 cwd 仍由 SDK 随每次调用发送；此处不修改 workingDirectory 服务。
  if (resourceWorkspace !== undefined && !isAbsolute(resourceWorkspace)) throw new Error('Invalid managed resource workspace');
  const workspace = resolve(resourceWorkspace ?? (binding ? ctx.workingDirectory?.defaultDirectory || profile.cwd : join(resolve(profile.home), 'workspaces', profile.name)));
  const id = 'dsh-' + createHash('sha256').update(resolve(profile.home) + '\0' + profile.name).digest('hex').slice(0, 24);
  if (binding && (!isAbsolute(binding.projectDir) || !isAbsolute(binding.stateDir) || !/^[a-zA-Z0-9_.-]{1,128}$/.test(binding.instanceId))) throw new Error('Invalid managedBinding');
  const directory = binding ? resolve(binding.projectDir) : join(resolve(profile.home), 'rvguarder', id);
  if (overlaps(workspace, directory) || overlaps(workspace, join(resolve(profile.home), 'rvguarder', 'runtimes'))) throw new Error('Guard data must be outside managed resource workspace');
  if (binding) {
    if (overlaps(workspace, resolve(binding.stateDir))) throw new Error('Plugin state must be outside managed resource workspace');
  }
  return { directory, workspace, home: resolve(profile.home), profile: profile.name, instanceId: binding?.instanceId ?? id, stateDir: binding?.stateDir };
}

/** 创建受控资源根并核对真实路径，防止链接或私有目录重叠。 */
export function prepareResourceWorkspace(deployment: Deployment): void {
  mkdirSync(deployment.workspace, { recursive: true, mode: 0o700 });
  // 核对真实路径；不能通过资源根目录的链接将 Guard 私有数据纳入资源命名空间。
  const workspace = realpathSync(deployment.workspace);
  for (const path of [deployment.directory, deployment.stateDir, join(deployment.home, 'rvguarder', 'runtimes')]) {
    if (!path) continue;
    const target = (() => { try { return realpathSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return resolve(path); } })();
    if (overlaps(workspace, target)) throw Object.assign(new Error('Guard private paths overlap managed resource workspace'), { reason: 'workspace-conflict' });
  }
}

/** 用短命自举进程部署缓存，常驻进程不持有 npm 包内 executable/DLL。 */
async function cachedBackend(deployment: Deployment): Promise<ManagedBackend> {
  prepareResourceWorkspace(deployment);
  const source = verifyBackend();
  const cache = join(deployment.home, 'rvguarder', 'runtimes');
  const result = await promisify(execFile)(toNamespacedPath(source), ['runtime-stage', '--cache', cache, '--workspace', deployment.workspace], {
    windowsHide: true, timeout: 60000, maxBuffer: 65536, encoding: 'utf8', cwd: dirname(toNamespacedPath(source)),
    env: { ...process.env, PYTHONPATH: '', PYTHONHOME: '', PYTHONNOUSERSITE: '1' },
  });
  const executable = String(JSON.parse(result.stdout).executable);
  const local = relative(resolve(cache), resolve(executable));
  if (local.startsWith('..') || isAbsolute(local) || verifyBackend(dirname(executable)) !== realpathSync(executable)) throw new Error('Runtime cache verification failed');
  return new ManagedBackend(deployment, executable);
}

/** 启动后端并等待其认证就绪；stdin EOF 使子进程随宿主退出，不接管外部服务。 */
export class ManagedBackend {
  readonly ready: Promise<Connection>;
  private child: ChildProcess;
  private stopped = false;
  private closing?: Promise<void>;
  /** 只反映本对象所持进程的存活状态，不探测或接管外部进程。 */
  alive(): boolean { return !this.stopped && this.child.exitCode === null && this.child.signalCode === null; }
  constructor(deployment: Deployment, executable = verifyBackend()) {
    // pnpm 的真实安装路径可能超过 MAX_PATH，CreateProcess 需要 Windows 命名空间路径。
    const nativeExecutable = toNamespacedPath(executable);
    this.child = spawn(nativeExecutable, ['--project-dir', deployment.directory, '--dsh-home', deployment.home,
      '--workspace', deployment.workspace, '--profile', deployment.profile, '--instance-id', deployment.instanceId,
      '--port', '0', '--managed-stdio'], { cwd: dirname(nativeExecutable), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONNOUSERSITE: '1', PYTHONPATH: '', PYTHONHOME: '' } });
    // 后端日志不含凭据；不把原始 stderr/文件路径送入浏览器或用户通知。
    let startupError = '';
    this.child.stderr!.on('data', (data: Buffer) => { startupError = (startupError + data.toString('utf8')).slice(-8192); });
    this.ready = new Promise((accept, reject) => {
      let buffer = ''; let settled = false;
      const fail = () => { if (!settled) {
        settled = true; clearTimeout(timer);
        const diagnostic = startupError.split('\n').filter(line => /^(ModuleNotFoundError|ImportError|ValueError|OSError|PermissionError|RuntimeError|FileNotFoundError):/.test(line)).pop();
        console.error(`RVguarder backend startup failed (${this.child.exitCode ?? 'timeout/spawn'}): ${diagnostic ?? 'see platform installation and instance binding'}`);
        const reason = /dsh_state_binding_mismatch/.test(startupError) ? 'instance-mismatch' : /already.owned|already.locked|instance.already|PermissionError.*dsh-owner/i.test(startupError) ? 'instance-conflict' : /ModuleNotFoundError|ImportError/.test(startupError) ? 'runtime-damaged' : 'startup-failed';
        reject(Object.assign(new Error('RVguarder bundled backend failed to start; guard remains closed'), { reason }));
      } };
      const timer = setTimeout(() => { fail(); void this.close(); }, 60000);
      this.child.once('error', (error) => { console.error('RVguarder backend spawn:', (error as NodeJS.ErrnoException).code); fail(); });
      this.child.once('exit', fail);
      this.child.stdout!.on('data', (bytes: Buffer) => {
        buffer += bytes.toString('utf8');
        if (buffer.length > 65536) { fail(); void this.close(); return; }
        while (buffer.includes('\n')) {
          const end = buffer.indexOf('\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (settled) continue;
          let item: Record<string, unknown>;
          try { item = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
          if (!item.url) continue;
          settled = true; clearTimeout(timer);
          void (async () => {
            const url = new URL(String(item.url));
            const tokenFile = join(deployment.directory, 'runtime', 'dsh-token');
            if (this.stopped || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password || item.instance_id !== deployment.instanceId || resolve(String(item.token_file)) !== tokenFile) throw new Error('Bundled backend readiness identity mismatch');
            const token = readFileSync(tokenFile, 'utf8').trim();
            if (token.length < 32) throw new Error('Bundled backend token missing');
            const response = await fetch(url.origin + '/api/dsh/status', { headers: { 'x-rvguarder-token': token }, redirect: 'error', signal: AbortSignal.timeout(5000) });
            const status = await response.json() as Record<string, unknown>;
            if (!response.ok || status.protocol !== 'dsh-guard-v2' || status.instance_id !== deployment.instanceId || this.stopped || this.child.exitCode !== null) throw new Error('Bundled backend authentication failed');
            accept({ backendUrl: url.origin, tokenFile, instanceId: deployment.instanceId, stateDir: deployment.stateDir ?? join(deployment.directory, 'runtime', 'plugin-state') });
          })().catch((error: unknown) => { reject(error); void this.close(); });
        }
      });
    });
  }

  /** 仅关闭本对象创建的进程；保留实例、令牌、完成队列与审计。 */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopped = true;
    this.closing = new Promise((done) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null || !this.child.pid) { done(); return; }
      const timer = setTimeout(() => { this.child.kill('SIGKILL'); }, 8000);
      this.child.once('exit', () => { clearTimeout(timer); done(); });
      this.child.stdin!.on('error', () => {});
      this.child.stdin!.end();
    });
    return this.closing;
  }
}

export type CoreFailure = 'recovery-required' | 'instance-conflict' | 'startup-failed';

/** 将核心启动/持久化故障映射为固定原因，绝不向浏览器透出异常路径。 */
export function coreFailureReason(error: unknown): CoreFailure {
  const message = error instanceof Error ? error.message : '';
  if (/previous plugin owner|reconcile|outbox|completion|execution|persistence/i.test(message)) return 'recovery-required';
  if (/state directory already owned/i.test(message)) return 'instance-conflict';
  return 'startup-failed';
}

/** 同步配置故障和异步启动故障使用固定分类，不把文件路径带进管理响应。 */
export function deploymentFailureReason(error: unknown): string {
  const reason = (error as {reason?: unknown})?.reason;
  if (typeof reason === 'string' && ['instance-mismatch', 'instance-conflict', 'runtime-damaged', 'startup-failed', 'workspace-conflict'].includes(reason)) return reason;
  const message = error instanceof Error ? error.message : '';
  if (/workspace|namespace/i.test(message)) return 'workspace-conflict';
  if (/profileContext|managedBinding/i.test(message)) return 'configuration-invalid';
  return /manifest|integrity|inventory|platform|cache/i.test(message) ? 'runtime-damaged' : 'startup-failed';
}

const sessions = new Map<string, { backend: Promise<ManagedBackend>; references: number; fingerprint: string; status: DeploymentStatus; coreFailure?: CoreFailure }>();
const shutdowns = new Map<string, Promise<void>>();

/** 核心与管理入口共享一个进程；最后一个宿主 fiber 卸载时关闭。 */
export function acquireManaged(ctx: Context, factory: (deployment: Deployment) => ManagedBackend | Promise<ManagedBackend> = cachedBackend, binding?: ManagedBinding, resourceWorkspace?: string): { ready: Promise<Connection>; status(): DeploymentStatus; reportFailure(reason: CoreFailure): void; release(): Promise<void> } {
  const deployment = deploymentFor(ctx, binding, resourceWorkspace);
  const fingerprint = JSON.stringify(deployment);
  let session = sessions.get(deployment.directory);
  if (session && session.fingerprint !== fingerprint) throw new Error('Conflicting managed instance binding');
  if (!session) {
    // 快速禁用/启用时先等待旧进程释放目录锁，不能复用正在退出的连接。
    session = { backend: (shutdowns.get(deployment.directory) ?? Promise.resolve()).then(() => factory(deployment)), references: 0, fingerprint, status: { mode: 'managed', state: 'starting' } };
    sessions.set(deployment.directory, session);
  }
  session.references++;
  const owned = session; let released = false;
  let runtime: ManagedBackend | undefined;
  void owned.backend.then(backend => { runtime = backend; }, () => {});
  const ready = owned.backend.then(backend => backend.ready);
  void ready.then(() => { owned.status = { mode: 'managed', state: 'ready' }; }, (error: unknown) => { owned.status = { mode: 'managed', state: 'failed', reason: deploymentFailureReason(error) }; });
  return { ready, reportFailure(reason) { if (!released) owned.coreFailure = reason; }, status: () => owned.status.state === 'stopped' ? ({ ...owned.status }) : owned.coreFailure ? { mode: 'managed', state: 'failed', reason: owned.coreFailure } : owned.status.state === 'ready' && runtime && !runtime.alive() ? { mode: 'managed', state: 'failed', reason: 'backend-exited' } : ({ ...owned.status }), async release() {
    if (released) return; released = true;
    if (--owned.references === 0) {
      if (sessions.get(deployment.directory) === owned) sessions.delete(deployment.directory);
      const stopping = owned.backend.then(backend => backend.close(), () => {});
      shutdowns.set(deployment.directory, stopping);
      try { await stopping; }
      finally { owned.status = { mode: 'managed', state: 'stopped' }; if (shutdowns.get(deployment.directory) === stopping) shutdowns.delete(deployment.directory); }
    }
  } };
}
