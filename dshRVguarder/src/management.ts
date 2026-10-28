/** RVguarder 宿主侧管理适配器：唯一持有桥接令牌，向浏览器暴露有界只读管理方法。 */
import { readFileSync } from 'node:fs';
import type { Context } from '@deepseek-ai/cordis';
import { Remote, RemoteError, TypertRemoteService, principalOf } from '@deepseek-ai/dsh-typert-protocol';
import { sdkVersion } from './sdk.js';

export interface AdminConfig { backendUrl: string; tokenFile: string; instanceId: string; timeoutMs?: number; connectionReady?: Promise<{backendUrl: string; tokenFile: string; instanceId: string}>; }

/** 后端字段白名单：概览中允许离开宿主的键；其余配置与私有路径不离开宿主侧。 */
const SUMMARY_FIELDS = [
  'generated_at', 'host', 'hook', 'semantic', 'actions', 'sync', 'execution_guard',
  'policy', 'rv', 'audit', 'baseline', 'capabilities', 'product',
] as const;

/** 限制响应体积，避免页面一次拉入超大 JSON。 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

type Json = Record<string, unknown>;

/** RVguarder 管理失败码；跨线传输依赖 RemoteError 的结构标记而非类型键集合。 */
type AdminCode = 'rvguarder/invalid-argument' | 'rvguarder/not-owner' | 'rvguarder/backend-unreachable' | 'rvguarder/backend-unauthorized' | 'rvguarder/backend-error' | 'rvguarder/backend-protocol' | 'rvguarder/instance-mismatch' | 'rvguarder/response-too-large' | 'rvguarder/action-not-found' | 'rvguarder/llm-key-missing' | 'rvguarder/report-not-generated';

/** 构造管理 RemoteError；code 在运行时原样过线（结构标记识别，不依赖 instanceof）。 */
function adminError(code: AdminCode, message: string, details: Record<string, unknown> = {}): RemoteError {
  return new RemoteError(code as never, message, details as never);
}

function sanitizeSummary(summary: Json): Json {
  const out: Json = {};
  for (const key of SUMMARY_FIELDS) if (key in summary) out[key] = summary[key];
  // target/paths 携带本机绝对路径，只保留非敏感标识。
  const target = summary.target as Json | undefined;
  if (target && typeof target === 'object') out.target_profile = target.profile;
  return out;
}

function assertString(value: unknown, field: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || (pattern && !pattern.test(value))) throw adminError('rvguarder/invalid-argument', `${field} is not an acceptable string`, { field });
  return value;
}

export class RvguarderAdmin extends TypertRemoteService {
  private base: string;
  private token: string;
  private readonly timeoutMs: number;
  private instanceId: string;
  private readonly connectionReady: Promise<void>;
  /** 与后端最近一次成功握手时间；0 表示尚未确认在线。 */
  private backendSeenAt = 0;

  constructor(ctx: Context, config: AdminConfig) {
    super(ctx, 'rvguarderAdmin');
    const url = new URL(config.backendUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Guard backend must use a loopback HTTP origin');
    this.base = url.origin;
    this.token = config.connectionReady ? '' : readFileSync(config.tokenFile, 'utf8').trim();
    if (!config.connectionReady && this.token.length < 32) throw new Error('Invalid Guard token');
    this.instanceId = config.instanceId;
    const timeout = config.timeoutMs ?? 8000;
    if (!Number.isInteger(timeout) || timeout < 500 || timeout > 30000) throw new Error('Invalid timeoutMs');
    this.timeoutMs = timeout;
    this.connectionReady = config.connectionReady ? config.connectionReady.then(connection => {
      this.base = connection.backendUrl;
      this.token = readFileSync(connection.tokenFile, 'utf8').trim();
      this.instanceId = connection.instanceId;
    }) : Promise.resolve();
    void this.connectionReady.catch(() => {});
  }

  /** 每个管理方法都要求当前 Remote 调用来自 owner Peer。 */
  private requireOwner(): void {
    if (principalOf(this.ctx.invocation) !== undefined) throw adminError('rvguarder/not-owner', 'RVguarder management is limited to the session owner', {});
  }

  /** 固定路径、固定方法的后端调用；不跟随重定向，限制响应大小。 */
  private async backend(path: string, init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' }): Promise<Json> {
    await this.connectionReady.catch(() => { throw adminError('rvguarder/backend-unreachable', '整包后端不可用；请核对平台安装包与实例状态。'); });
    if (path !== '/api/dsh/status') await this.checkIdentity();
    const response = await fetch(this.base + path, {
      method: init.method, redirect: 'error',
      headers: { 'x-rvguarder-token': this.token, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch(() => { throw adminError('rvguarder/backend-unreachable', 'RVguarder 后端未连接；请先启动 Python 服务。', { path }); });
    if (response.status === 401) throw adminError('rvguarder/backend-unauthorized', 'RVguarder 后端拒绝了宿主桥接令牌。', { path });
    if (!response.ok) throw adminError('rvguarder/backend-error', `RVguarder 后端返回 HTTP ${response.status}`, { path, status: response.status });
    const text = new TextDecoder().decode(await this.boundedBody(response));
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw adminError('rvguarder/backend-protocol', 'RVguarder 后端响应不可解析。', { path }); }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw adminError('rvguarder/backend-protocol', 'RVguarder 后端响应不是对象。', { path });
    this.backendSeenAt = Date.now();
    return parsed as Json;
  }

  /** 二进制下载（报告/审计导出），返回字节交给 Gateway 的附件通道。 */
  private async backendBytes(path: string, media: string): Promise<{ bytes: Uint8Array; filename: string; mediaType: string }> {
    await this.connectionReady.catch(() => { throw adminError('rvguarder/backend-unreachable', '整包后端不可用；请核对平台安装包与实例状态。'); });
    await this.checkIdentity();
    const response = await fetch(this.base + path, {
      method: 'GET', redirect: 'error',
      headers: { 'x-rvguarder-token': this.token },
      signal: AbortSignal.timeout(Math.max(this.timeoutMs, 30000)),
    }).catch(() => { throw adminError('rvguarder/backend-unreachable', 'RVguarder 后端未连接；请先启动 Python 服务。', { path }); });
    if (response.status === 401) throw adminError('rvguarder/backend-unauthorized', 'RVguarder 后端拒绝了宿主桥接令牌。');
    if (!response.ok) throw adminError('rvguarder/backend-error', `RVguarder 后端返回 HTTP ${response.status}`, { path, status: response.status });
    const buffer = await this.boundedBody(response);
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    return { bytes: buffer, filename: match?.[1] ?? 'rvguarder-export', mediaType: media };
  }

  /** 每个业务调用前校验真实后端身份，避免页面把错误实例显示为配置中的实例。 */
  private async checkIdentity(): Promise<Json> {
    const status = await this.backend('/api/dsh/status');
    if (status.protocol !== 'dsh-guard-v2' || status.instance_id !== this.instanceId) throw adminError('rvguarder/instance-mismatch', '后端协议或实例身份不符；请核对连接配置。');
    return status;
  }

  /** 读取期间实施字节限额，超限立即取消流，避免完整缓冲后才检测。 */
  private async boundedBody(response: Response): Promise<Uint8Array> {
    const reader = response.body?.getReader();
    if (!reader) throw adminError('rvguarder/backend-protocol', '后端响应缺少内容。');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const item = await reader.read(); if (item.done) break;
        size += item.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw adminError('rvguarder/response-too-large', '管理通道响应超过 4 MiB 限额。'); }
        chunks.push(item.value);
      }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  }

  /** 概览：连接状态 + 摘要（脱敏）。 */
  @Remote('overview')
  async overview(): Promise<Json> {
    this.requireOwner();
    let summary: Json; let status: Json;
    try {
      status = await this.checkIdentity();
      summary = sanitizeSummary(await this.backend('/api/summary'));
    } catch (error) {
      if (error instanceof RemoteError && error.code === 'rvguarder/backend-unreachable') {
        return { ok: true, backend: { online: false, instanceId: this.instanceId, sdkVersion, lastSeenAt: this.backendSeenAt || null }, summary: null };
      }
      throw error;
    }
    return { ok: true, backend: { online: true, instanceId: this.instanceId, sdkVersion, lastSeenAt: this.backendSeenAt, recoveryRequired: status.recovery_required === true }, summary };
  }

  /** 动作详情（只读）。 */
  @Remote('actionDetail')
  async actionDetail(actionId: unknown): Promise<Json> {
    this.requireOwner();
    const id = assertString(actionId, 'actionId', /^[A-Za-z0-9_.:-]{1,256}$/);
    const result = await this.backend(`/api/actions/${encodeURIComponent(id)}`);
    const action = (result as { action?: unknown }).action;
    if (typeof action !== 'object' || action === null) throw adminError('rvguarder/action-not-found', `动作 ${id} 不存在。`, { actionId: id });
    return { ok: true, action };
  }

  /** 规则与策略版本（只读）。 */
  @Remote('policy')
  async policy(): Promise<Json> {
    this.requireOwner();
    return { ok: true, ...(await this.backend('/api/dsh/policy')) };
  }

  /** RV 状态（只读）。 */
  @Remote('rvStatus')
  async rvStatus(): Promise<Json> {
    this.requireOwner();
    return { ok: true, ...(await this.backend('/api/rv/status')) };
  }

  /** RV 模式切换；沿用后端既有语义。 */
  @Remote('rvToggle')
  async rvToggle(enabled: unknown): Promise<Json> {
    this.requireOwner();
    if (typeof enabled !== 'boolean') throw adminError('rvguarder/invalid-argument', 'enabled must be a boolean', { field: 'enabled' });
    return { ok: true, ...(await this.backend('/api/rv/toggle', { method: 'POST', body: { enabled } })) };
  }

  /** 语义模式设置：local/auto/llm。 */
  @Remote('semanticMode')
  async semanticMode(mode: unknown): Promise<Json> {
    this.requireOwner();
    const value = assertString(mode, 'mode');
    if (value !== 'local' && value !== 'auto' && value !== 'llm') throw adminError('rvguarder/invalid-argument', 'mode must be one of local/auto/llm', { field: 'mode' });
    try {
      return { ok: true, ...(await this.backend('/api/dsh/semantic', { method: 'POST', body: { mode: value } })) };
    } catch (error) {
      if (error instanceof RemoteError && error.code === 'rvguarder/backend-error' && (error.details as { status?: number } | undefined)?.status === 409) {
        throw adminError('rvguarder/llm-key-missing', '后端缺少模型密钥，无法切换到 llm 模式。', { mode: value });
      }
      throw error;
    }
  }

  /** 运行基线扫描；有并发保护（后端串行执行）。 */
  @Remote('runScan')
  async runScan(): Promise<Json> {
    this.requireOwner();
    return { ok: true, ...(await this.backend('/api/baseline/run', { method: 'POST', body: {} })) };
  }

  /** 审计记录与链完整性（只读）。 */
  @Remote('audit')
  async audit(): Promise<Json> {
    this.requireOwner();
    return { ok: true, ...(await this.backend('/api/dsh/audit')) };
  }

  /** 审计导出下载（受控标识 json/csv）。 */
  @Remote('auditExport')
  async auditExport(format: unknown): Promise<{ bytes: Uint8Array; filename: string; mediaType: string }> {
    this.requireOwner();
    const value = assertString(format, 'format');
    if (value !== 'json' && value !== 'csv') throw adminError('rvguarder/invalid-argument', 'format must be json or csv', { field: 'format' });
    return this.backendBytes(`/api/dsh/audit-export/${value}`, value === 'json' ? 'application/json' : 'text/csv');
  }

  /** 合规报告下载（受控标识 json/html/pdf）。 */
  @Remote('report')
  async report(format: unknown): Promise<{ bytes: Uint8Array; filename: string; mediaType: string }> {
    this.requireOwner();
    const value = assertString(format, 'format');
    if (value !== 'json' && value !== 'html' && value !== 'pdf') throw adminError('rvguarder/invalid-argument', 'format must be json/html/pdf', { field: 'format' });
    try {
      return await this.backendBytes(`/api/dsh/reports/${value}`, value === 'json' ? 'application/json' : value === 'html' ? 'text/html' : 'application/pdf');
    } catch (error) {
      if (error instanceof RemoteError && error.code === 'rvguarder/backend-error' && (error.details as { status?: number } | undefined)?.status === 404) {
        throw adminError('rvguarder/report-not-generated', '报告尚未生成；请先运行扫描。', { format: value });
      }
      throw error;
    }
  }
}
