/**
 * 管理通道抽象 —— 独立工作台 HTTP 与 DSH 宿主 Remote 两种实现共用一份方法表。
 *
 * 每个方法对应宿主管理适配器的一个固定业务方法；不提供通用 URL 代理。
 */

/**
 * 创建基于现有 HTTP API 的传输（独立工作台继续使用）。
 * @param {string} [base] API 根路径，默认同源。
 */
export function createHttpTransport(base = '') {
  const call = async (method, args = {}) => {
    const route = httpRoutes[method];
    if (!route) throw new Error(`transport: unknown method ${method}`);
    const url = base + route.path(route.params ? route.params(args) : {});
    const options = route.method === 'POST'
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(route.body ? route.body(args) : {}) }
      : { cache: 'no-store' };
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error_code || payload.error || 'request_failed');
      error.payload = payload;
      throw error;
    }
    return payload;
  };
  const download = async (method, args = {}) => {
    const route = httpRoutes[method];
    if (!route) throw new Error(`transport: unknown method ${method}`);
    const url = base + route.path(route.params ? route.params(args) : {});
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error_code || payload.error || 'download_failed');
      error.payload = payload;
      throw error;
    }
    return await response.arrayBuffer();
  };
  return { kind: 'http', call, download };
}

/** HTTP 路由表：方法名 → 现有端点。 */
const httpRoutes = {
  overview: { method: 'GET', path: () => '/api/summary' },
  actionDetail: { method: 'GET', path: ({ actionId }) => `/api/actions/${encodeURIComponent(actionId)}`, params: true },
  policy: { method: 'GET', path: () => '/api/dsh/policy' },
  rvStatus: { method: 'GET', path: () => '/api/rv/status' },
  rvToggle: { method: 'POST', path: () => '/api/rv/toggle', body: ({ enabled }) => ({ enabled }) },
  semanticMode: { method: 'POST', path: () => '/api/dsh/semantic', body: ({ mode }) => ({ mode }) },
  runScan: { method: 'POST', path: () => '/api/baseline/run', body: () => ({}) },
  audit: { method: 'GET', path: () => '/api/dsh/audit' },
  auditExport: { method: 'GET', path: ({ format }) => `/api/dsh/audit-export/${format}`, params: true },
  report: { method: 'GET', path: ({ format }) => `/api/dsh/reports/${format}`, params: true },
};

/**
 * 创建基于 DSH 宿主 Remote 命名空间的传输（内嵌模式）。
 * @param {object} remoteNamespace `ctx.remote.rvguarderAdmin` 服务对象。
 */
export function createRemoteTransport(remoteNamespace) {
  const call = async (method, args = {}) => {
    const fn = remoteNamespace[method];
    if (typeof fn !== 'function') throw new Error(`transport: 宿主管理通道缺少方法 ${method}`);
    const result = await fn(...remoteArgs(method, args));
    if (!result || result.ok !== true) {
      const error = new Error(result?.error?.message || 'remote_call_failed');
      error.code = result?.error?.code;
      error.payload = result?.error;
      throw error;
    }
    return result.value;
  };
  const download = async (method, args = {}) => {
    const fn = remoteNamespace[method];
    if (typeof fn !== 'function') throw new Error(`transport: 宿主管理通道缺少方法 ${method}`);
    const result = await fn(...remoteArgs(method, args));
    if (!result || result.ok !== true) {
      const error = new Error(result?.error?.message || 'remote_call_failed');
      error.code = result?.error?.code;
      error.payload = result?.error;
      throw error;
    }
    return result.value?.bytes ? new Uint8Array(result.value.bytes).buffer : new ArrayBuffer(0);
  };
  return { kind: 'remote', call, download };
}

/** 宿主 Remote 方法的位置参数表（与 management.ts 的方法签名一一对应）。 */
function remoteArgs(method, args) {
  switch (method) {
    case 'actionDetail': return [args.actionId];
    case 'rvToggle': return [args.enabled === true];
    case 'semanticMode': return [args.mode];
    case 'auditExport': return [args.format];
    case 'report': return [args.format];
    default: return [];
  }
}

/** 当前生效的传输；独立工作台默认 HTTP。 */
let active = createHttpTransport();

/** 安装传输（内嵌入口在 mount 时调用；独立工作台无需调用）。 */
export function setTransport(transport) {
  active = transport;
}

/** 读取当前传输。 */
export function getTransport() {
  return active;
}
