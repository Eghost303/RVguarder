/** 证据文本：插件页 bundle 状态 + 设置导航 + RPC 概览 JSON。 */
const { test } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const cachedUrl = () => { try { return fs.readFileSync(path.join(__dirname, '../.cache/embed-e2e-url.txt'), 'utf8').trim(); } catch { return null; } };

test('capture textual evidence', async ({ page }) => {
  test.setTimeout(150_000);
  fs.mkdirSync('evidence', { recursive: true });
  const out = [];
  await page.goto(process.env.DSH_UI_E2E_URL || cachedUrl(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(5000);
  // 关闭公告
  const presentation = page.locator('[role="presentation"] button');
  if (await presentation.count()) {
    const continueButton = presentation.filter({ hasText: 'Continue' }).first();
    if (await continueButton.count()) { await continueButton.click({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1200); }
  }
  if (await page.locator('[class*="_mask_o6lrb"]').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
  // 插件面板文本
  await page.locator('button[aria-label="Plugins"]').click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const pluginsText = await page.locator('body').innerText().catch(() => '');
  out.push('=== Plugins page (excerpt) ===');
  const rvgLines = pluginsText.split('\n').filter((l) => /rvguarder|RVguarder|0\.2\.0-rc\.3/i.test(l));
  out.push(...rvgLines.slice(0, 15));
  // RPC 证据
  const bundles = await page.evaluate(async () => {
    const response = await fetch('/api/pluginManager/listBundles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'ev1', method: 'pluginManager/listBundles', payload: { args: {} } }),
    });
    const data = await response.json();
    return (data.result.value || []).filter((b) => b.name === 'dsh-rvguarder');
  });
  out.push('=== pluginManager.listBundles → dsh-rvguarder ===');
  out.push(JSON.stringify(bundles, null, 2));
  const overview = await page.evaluate(async () => {
    const response = await fetch('/api/rvguarderAdmin/overview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'ev2', method: 'rvguarderAdmin/overview', payload: { args: {} } }),
    });
    const data = await response.json();
    return { ok: data.result.ok, backend: data.result.value?.backend, summaryHost: data.result.value?.summary?.host, hasSettingsLeak: !!data.result.value?.summary?.settings };
  });
  out.push('=== rvguarderAdmin/overview ===');
  out.push(JSON.stringify(overview, null, 2));
  fs.writeFileSync('evidence/text-evidence.txt', out.join('\n'));
  console.log(out.join('\n'));
});
