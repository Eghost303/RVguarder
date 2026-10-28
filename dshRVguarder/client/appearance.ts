/** 从宿主主题服务的真实快照读取已解析配色，不修改宿主偏好。 */
import type { ClientContext } from './types.js';

export function readHostTheme(ctx?: ClientContext): 'dark' | 'light' {
  const service = ctx?.get<{ getTheme(): { active?: { colorScheme?: string } } }>('theme');
  return service?.getTheme().active?.colorScheme === 'dark' ? 'dark' : 'light';
}
