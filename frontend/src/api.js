/**
 * API 请求层 —— 现有端点签名不变；底层经 transport 抽象，
 * 独立工作台走 HTTP，DSH 内嵌走宿主认证 Remote 通道。
 */
import { getTransport } from './transport';

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
