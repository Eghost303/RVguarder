/** RVguarder 管理插件入口：宿主侧管理适配器；UI 失败不影响核心守卫加载。 */
import type { Context } from '@deepseek-ai/cordis';
import { RvguarderAdmin, type AdminConfig } from './management.js';

export const name = 'dsh-rvguarder-admin';
export const inject: string[] = [];
export interface Config extends AdminConfig {}

export function apply(ctx: Context, config: Config) {
  if (!config?.instanceId || !/^[a-zA-Z0-9_.-]{1,128}$/.test(config.instanceId)) throw new Error('Invalid Guard instanceId');
  const service = new RvguarderAdmin(ctx, config);
  // Service 构造即通过 TypertRemoteService 提供并绑定 Gateway；fiber 卸载自动注销。
  ctx.effect(() => async () => {
    void service;
  }, 'rvguarder-admin-shutdown');
}
