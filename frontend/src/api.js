/**
 * API 请求层 —— 现有端点签名不变；底层经 transport 抽象，
 * 独立工作台走 HTTP，DSH 内嵌走宿主认证 Remote 通道。
 */
import { getTransport } from './transport';
import { useGuardSession } from './session';

/** 通用 fetch wrapper —— 非 2xx → throw（独立工作台内部使用） */
export async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  const pl = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(pl.error_code || pl.error || 'request_failed');
    e.payload = pl;
    throw e;
  }
  return pl;
}

export function apiErrorMessage(error, fallback = '请求处理失败') {
  return error?.payload?.detail || error?.payload?.message || error?.payload?.error || error?.message || fallback;
}

/** 经当前 transport 调用固定业务方法。 */
function call(method, args) {
  return getTransport().call(method, args);
}

/** GET /api/summary（独立路径保留原查询参数语义） */
export async function fetchSummary({ compact = false } = {}) {
  // Summary contains mutable action/skill state.  Do not let a browser reuse
  // the pre-mutation response after an SSE or POST reconciliation.
  if (getTransport().kind === 'http') {
    const query = compact ? 'view=compact&' : '';
    return api(`/api/summary?${query}_ts=${Date.now()}`, { cache: 'no-store' });
  }
  const value = await call('overview');
  if (value?.backend?.recoveryRequired) throw Object.assign(new Error('Guard 恢复锁定：上次执行尚未完成核对，请检查实例历史。'), { code: 'rvguarder/recovery-required' });
  // 宿主 overview 返回 { backend, summary }；页面继续消费 summary 形状。
  if (value && value.summary) return value.summary;
  throw Object.assign(new Error('后端未连接'), { code: 'rvguarder/backend-unreachable' });
}

/** GET /api/rv/status */
export async function fetchRvStatus() {
  return call('rvStatus');
}

/** GET /api/actions/{action_id} */
export async function fetchAction(id) {
  const result = await call('actionDetail', { actionId: id });
  return result.action;
}

/** POST /api/actions/approve —— 独立工作台路径；DSH 内嵌不提供（原生审批为准） */
export async function approveAction(id) {
  return api('/api/actions/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action_id: id, confirmation_text: '' }),
  });
}

/** POST /api/actions/reject —— 独立工作台路径；DSH 内嵌不提供 */
export async function rejectAction(id) {
  return api('/api/actions/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action_id: id }),
  });
}

/** POST /api/actions/clear —— 独立工作台路径；DSH 内嵌不提供 */
export async function clearActions() {
  return api('/api/actions/clear', { method: 'POST' });
}

/** GET /api/approval-trust —— 独立工作台路径 */
export async function fetchApprovalTrust() {
  return api('/api/approval-trust');
}

/** POST /api/approval-trust/revoke —— 独立工作台路径 */
export async function revokeApprovalTrust(fingerprint) {
  return api('/api/approval-trust/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fingerprint }),
  });
}

/** POST /api/rv/toggle */
export async function rvToggle(enabled) {
  return call('rvToggle', { enabled });
}

/** POST /api/baseline/run */
export async function runBaseline() {
  return call('runScan');
}

/** 审计导出：返回 ArrayBuffer（两种传输统一行为）。 */
export async function exportAudit(format = 'json') {
  if (getTransport().kind === 'http') return api('/api/audit/export', { method: 'POST' });
  return getTransport().download('auditExport', { format });
}

/** 报告下载：返回 ArrayBuffer。 */
export async function downloadReport(format) {
  return getTransport().download('report', { format });
}

/** POST /api/skills/upsert —— 独立工作台路径 */
export async function upsertSkill(name, enabled) {
  return api('/api/skills/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, enabled }),
  });
}

/** 创建只使用给定会话传输的业务 API，内嵌模式不向宿主 URL 直连 fetch。 */
export function createScopedApi(transport, store) {
  const scopedCall = (method, args) => transport.call(method, args);
  const routes = { '/api/dsh/policy': 'policy', '/api/rv/status': 'rvStatus', '/api/dsh/audit': 'audit' };
  return {
    api(path) {
      if (!routes[path]) return Promise.reject(new Error('此操作不支持宿主内嵌模式'));
      return scopedCall(routes[path]);
    },
    async fetchSummary() {
      const value = await scopedCall('overview');
      store?.setState({ backendStatus: value?.backend ?? null });
      if (value?.backend?.recoveryRequired) throw Object.assign(new Error('Guard 恢复锁定：上次执行尚未完成核对，请检查实例历史。'), { code: 'rvguarder/recovery-required' });
      if (value?.summary) return value.summary;
      const state = value?.backend?.deployment?.state;
      throw Object.assign(new Error(state === 'starting' ? 'Guard 后端正在启动' : state === 'failed' ? 'Guard 运行时启动失败，请检查插件状态' : '后端未连接'), { code: 'rvguarder/' + (state || 'backend-unreachable') });
    },
    fetchRvStatus: () => scopedCall('rvStatus'),
    fetchAction: async id => (await scopedCall('actionDetail', { actionId: id })).action,
    rvToggle: enabled => scopedCall('rvToggle', { enabled }),
    runBaseline: () => scopedCall('runScan'),
    exportAudit: (format = 'json') => transport.download('auditExport', { format }),
    downloadReport: format => transport.download('report', { format }),
    approveAction: () => Promise.reject(new Error('审批由宿主处理')),
    rejectAction: () => Promise.reject(new Error('审批由宿主处理')),
    clearActions: () => Promise.reject(new Error('此操作不支持宿主内嵌模式')),
    fetchApprovalTrust: () => Promise.reject(new Error('此操作不支持宿主内嵌模式')),
    revokeApprovalTrust: () => Promise.reject(new Error('此操作不支持宿主内嵌模式')),
    upsertSkill: () => Promise.reject(new Error('此操作不支持宿主内嵌模式')),
  };
}

const defaultApi = { api, fetchSummary, fetchRvStatus, fetchAction, rvToggle, runBaseline, exportAudit, downloadReport, approveAction, rejectAction, clearActions, fetchApprovalTrust, revokeApprovalTrust, upsertSkill };
export function useApi() { return useGuardSession()?.api ?? defaultApi; }
