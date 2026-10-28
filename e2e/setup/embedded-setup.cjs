/** 宿主内嵌 E2E 的 globalSetup：隔离目录中准备后端 + 安装 rc.3 插件 + 启动真实 DSH web profile。 */
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '../..');
const MANAGED_PACKAGE = process.env.RVGUARDER_MANAGED_PACKAGE;
const PLUGIN_TGZ = MANAGED_PACKAGE || path.join(REPO, `dshRVguarder/dsh-rvguarder-${require('../../dshRVguarder/package.json').version}.tgz`);
const DSH_CLI = process.env.DSH_E2E_CLI || 'C:\\Users\\elect\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd';
const PYTHON = process.env.RVGUARDER_PYTHON || (fs.existsSync(path.join(REPO, '.venv/bin/python.exe')) ? path.join(REPO, '.venv/bin/python.exe') : path.join(REPO, '.venv/Scripts/python.exe'));
const WEB_PORT = process.env.RVGUARDER_MANAGED_PACKAGE ? '8794' : '8792';
const BACKEND_PORT = '8786';

module.exports = async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rvguarder-embed-e2e-'));
  const home = path.join(tmpRoot, 'home'), workspace = path.join(tmpRoot, 'workspace'), projectDir = path.join(tmpRoot, 'guard'), temp = path.join(tmpRoot, 'temp');
  for (const dir of [workspace, temp, projectDir]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'data.txt'), 'e2e');

  let backend = null;
  let backendUrl = null;
  if (MANAGED_PACKAGE) {
    // 真实下载安装路径：只选 bundle，不生成令牌或手工启动后端。
    const profile = path.join(home, 'profiles/rvguarder-e2e');
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'rvg-managed-e2e', private: true, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-rvguarder'] } } }));
    fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), '[]');
  } else {
  // 1) prepare-only 生成实例与令牌
  execFileSync(PYTHON, ['-X', 'utf8', '-m', 'clawRVguarder.hosts.dsh.server',
    '--project-dir', projectDir, '--dsh-home', home, '--workspace', workspace,
    '--profile', 'rvguarder-e2e', '--instance-id', 'e2e-ui', '--port', '0', '--semantic-mode', 'local', '--prepare-only'],
    { cwd: REPO, stdio: 'ignore', env: { ...process.env, PYTHONUTF8: '1' } });
  const tokenFile = path.join(projectDir, 'runtime', 'dsh-token');

  // 2) bundle 化 profile（用户层覆盖两行 config）
  execFileSync('node', [path.join(REPO, 'dshRVguarder/scripts/create-test-profile.mjs'),
    '--profile', 'rvguarder-e2e', '--instance', 'e2e-ui', '--token', tokenFile,
    '--backend', `http://127.0.0.1:${BACKEND_PORT}`, '--home', home,
    '--state', path.join(projectDir, 'runtime', 'plugin-state')],
    { cwd: workspace, stdio: 'ignore' });
  }

  // 3) 安装插件 tgz（.cmd 路径含空格，shell 模式需整体加引号）
  const installCommand = `"${DSH_CLI}" plugin --profile rvguarder-e2e add --store-dir "${path.join(tmpRoot, 'pnpm-store')}" "${PLUGIN_TGZ}"`;
  try {
    execFileSync(installCommand, { cwd: workspace, env: { ...process.env, DSH_HOME: home, TEMP: temp, TMP: temp }, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  } catch (error) {
    throw new Error('plugin install failed: ' + String(error.stdout || '') + String(error.stderr || '') + String(error.message));
  }

  // 4) 启动真实后端
  if (!MANAGED_PACKAGE) {
  backend = spawn(PYTHON, ['-X', 'utf8', '-m', 'clawRVguarder.hosts.dsh.server',
    '--project-dir', projectDir, '--dsh-home', home, '--workspace', workspace,
    '--profile', 'rvguarder-e2e', '--instance-id', 'e2e-ui', '--port', BACKEND_PORT, '--semantic-mode', 'local'],
    { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1' } });
  let backendLog = '';
  backend.stdout.on('data', (b) => {
    backendLog += b;
    for (const line of String(b).split('\n')) { try { const item = JSON.parse(line); if (item.url) backendUrl = item.url; } catch {} }
  });
  backend.stderr.on('data', (b) => { backendLog += b; });
  const deadline = Date.now() + 30000;
  while (!backendUrl && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  if (!backendUrl) throw new Error('backend failed: ' + backendLog);
  }

  // 5) 启动 DSH web profile（.cmd 路径含空格 → 单命令字符串 + shell）
  const host = spawn(`"${DSH_CLI}" --profile rvguarder-e2e --no-open --port ${WEB_PORT}`,
    { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DSH_HOME: home, TEMP: temp, TMP: temp }, shell: true });
  let launchToken = null, hostLog = '';
  const pump = (stream) => stream.on('data', (b) => {
    hostLog += b;
    fs.appendFileSync(path.join(tmpRoot, 'host.log'), b);
    const m = /token=([A-Za-z0-9_\-\.]+)/.exec(String(b));
    if (m) launchToken = m[1];
  });
  pump(host.stdout); pump(host.stderr);
  const hostDeadline = Date.now() + 60000;
  while (!launchToken && Date.now() < hostDeadline) {
    if (host.exitCode !== null) throw new Error('dsh web exited: ' + hostLog);
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!launchToken) throw new Error('dsh web did not start: ' + hostLog);

  fs.mkdirSync(path.join(__dirname, '../.cache'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../.cache/embed-e2e.json'), JSON.stringify({
    webUrl: `http://127.0.0.1:${WEB_PORT}`, launchToken, backendUrl,
    backendPid: backend?.pid, hostPid: host.pid, tmpRoot,
  }));
  process.env.DSH_UI_E2E_URL = `http://127.0.0.1:${WEB_PORT}/?token=${launchToken}`;
  // 存储到文件供测试进程读取
  fs.writeFileSync(path.join(__dirname, '../.cache/embed-e2e-url.txt'), process.env.DSH_UI_E2E_URL);
  return module.exports.teardown;
};

module.exports.teardown = async () => {
  const cache = path.join(__dirname, '../.cache/embed-e2e.json');
  try {
    const info = JSON.parse(fs.readFileSync(cache, 'utf8'));
    try { fs.writeFileSync(path.join(__dirname, '../.cache/last-embed-host.log'), fs.readFileSync(path.join(info.tmpRoot, 'host.log'), 'utf8').replace(/token=[A-Za-z0-9_.-]+/g, 'token=<redacted>')); } catch {}
    // shell:true 下 SIGTERM 只杀 cmd 壳；用 taskkill /T 杀整棵进程树。
    for (const pid of [info.hostPid, info.backendPid]) {
      if (!pid) continue;
      try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', shell: true }); } catch {}
    }
    setTimeout(() => { try { fs.rmSync(info.tmpRoot, { recursive: true, force: true }); } catch {} }, 3000);
  } catch {}
};
