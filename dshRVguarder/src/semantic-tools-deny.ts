/** Prevent semantic-only child Agents from seeing or executing DSH tools. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-tools';

export const name = 'dsh-rvguarder-semantic-tools-deny';
export const inject = ['tools'];

/** Install tool restrictions in the Agent preset before its first model turn. */
export function apply(ctx: Context): void {
  ctx.tools.restrict({ allow: [] });
  ctx.tools.presentAs('native');
  ctx.tools.guard(() => 'RVguarder semantic child tools are disabled');
}
