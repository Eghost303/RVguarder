/** 仅供本机真实宿主验收：读取 owner 侧概览并正常卸载，不读取启动链接或令牌。 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
export const name = 'rvguarder-startup-proof';
export const inject = ['rvguarderAdmin', 'workingDirectory'];
export function apply(ctx, config) {
  let finished = false, checking = false;
  const deadline = Date.now() + 90000;
  const finish = async value => {
    if (finished) return; finished = true;
    const report = { ...value, processCwd: process.cwd(), hostDefaultDirectory: ctx.get('workingDirectory').defaultDirectory };
    report.cwdPreserved = resolve(report.hostDefaultDirectory) === resolve(config.expectedDirectory);
    try { await ctx.root.fiber.dispose(); report.hostDisposed = true; }
    catch { report.hostDisposed = false; report.ok = false; }
    writeFileSync(config.output, JSON.stringify(report, null, 2));
    process.exit(report.ok && report.cwdPreserved && report.hostDisposed ? 0 : 1);
  };
  const inspect = async () => {
    if (finished || checking) return; checking = true;
    try {
      const value = await ctx.get('rvguarderAdmin').overview();
      if (value.backend?.online && value.summary?.hook?.active) {
        await finish({ ok: true, instanceId: value.backend.instanceId, sdkVersion: value.backend.sdkVersion,
          deployment: value.backend.deployment, pluginConnected: value.summary.hook.active });
      } else if (Date.now() > deadline || value.backend?.deployment?.state === 'failed') {
        await finish({ ok: false, deployment: value.backend?.deployment });
      }
    } catch { if (Date.now() > deadline) await finish({ ok: false, reason: 'overview-failed' }); }
    finally { checking = false; }
  };
  ctx.effect(() => { const timer = setInterval(() => { void inspect(); }, 250); void inspect(); return () => clearInterval(timer); });
}
