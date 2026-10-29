/** RVguarder 管理插件入口：宿主侧管理适配器；UI 失败不影响核心守卫加载。 */
import type { Context } from '@deepseek-ai/cordis';
import { RvguarderAdmin, type AdminConfig } from './management.js';
import { acquireManaged, deploymentFor, deploymentFailureReason, type ManagedConfig } from './managed.js';

export const name = 'dsh-rvguarder-admin';
export const inject: string[] = ['workingDirectory'];
export interface Config extends AdminConfig, ManagedConfig {}

export function apply(ctx: Context, config: Config) {
  if (config?.backendMode === 'managed') {
    let ready: AdminConfig['connectionReady'];
    let status: AdminConfig['deploymentStatus'];
    let instanceId = config.managedBinding?.instanceId ?? 'managed';
    try {
      const managed = acquireManaged(ctx, undefined, config.managedBinding, config.resourceWorkspace); ready = managed.ready; status = managed.status;
      instanceId = deploymentFor(ctx, config.managedBinding, config.resourceWorkspace).instanceId;
      ctx.effect(() => () => managed.release(), 'rvguarder-admin-backend');
    } catch (error) {
      console.error(`RVguarder managed initialization: ${error instanceof Error ? error.message : 'failed'}`);
      const reason = deploymentFailureReason(error);
      status = () => ({ mode: 'managed', state: 'failed', reason });
      ready = Promise.reject(new Error('Bundled backend unavailable'));
    }
    // 即使后端启动失败，仍提供管理通道，页面显示明确离线状态。
    new RvguarderAdmin(ctx, { backendUrl: 'http://127.0.0.1:1', tokenFile: '', instanceId, connectionReady: ready, deploymentStatus: status });
    return;
  }
  if (!config?.instanceId || !/^[a-zA-Z0-9_.-]{1,128}$/.test(config.instanceId)) throw new Error('Invalid Guard instanceId');
  const service = new RvguarderAdmin(ctx, config);
  // Service 构造即通过 TypertRemoteService 提供并绑定 Gateway；fiber 卸载自动注销。
  ctx.effect(() => async () => {
    void service;
  }, 'rvguarder-admin-shutdown');
}
