/** 真实 DSH 宿主内的 RVguarder 设置页 E2E：Account 菜单 → Settings → RVguarder → 内嵌管理页面。 */
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');

const cachedUrl = () => { try { return fs.readFileSync(path.join(__dirname, '../.cache/embed-e2e-url.txt'), 'utf8').trim(); } catch { return null; } };
const dshUrl = () => process.env.DSH_UI_E2E_URL || cachedUrl() || 'http://127.0.0.1:8792/?token=missing';

/** 关闭 Preview 公告 → 打开设置 → 返回是否成功。 */
async function openSettings(page) {
  const presentation = page.locator('[role="presentation"] button');
  if (await presentation.count()) {
    const continueButton = presentation.filter({ hasText: 'Continue' }).first();
    if (await continueButton.count()) {
      await continueButton.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1200);
    }
  }
  if (await page.locator('[class*="_mask_o6lrb"]').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
  await page.locator('button[aria-label="Account menu"]').click({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  const settingsItem = page.locator('[role="menuitem"]:has-text("设置"), [role="menuitem"]:has-text("Settings")').first();
  if (!(await settingsItem.count())) return false;
  await settingsItem.click({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  return true;
}

/** 打开设置并进入 RVguarder 页签；返回内嵌根节点 locator。 */
async function openRvguarderSection(page) {
  await page.goto(dshUrl(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(5000);
  expect(await openSettings(page)).toBe(true);
  const nav = page.locator('text=RVguarder').first();
  await expect(nav).toBeVisible({ timeout: 15_000 });
  await nav.click();
  const embedded = page.locator('[data-testid="rvguarder-settings-section"]');
  await expect(embedded).toBeVisible({ timeout: 20_000 });
  return embedded;
}

test('settings shows RVguarder section with embedded management view', async ({ page }) => {
  test.setTimeout(150_000);
  await openRvguarderSection(page);
  // 内嵌视图结构：局部页签 + 概览
  await expect(page.locator('.rvg-embed')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.rvg-embed-tab').first()).toBeVisible();
});

test('embedded overview shows real backend connection', async ({ page }) => {
  test.setTimeout(150_000);
  await openRvguarderSection(page);
  // 后端在线：显示“已连接”与原生审批说明
  const embed = page.locator('.rvg-embed');
  await expect(embed).toContainText(/已连接|[Cc]onnected/, { timeout: 30_000 });
  await expect(embed).toContainText(/请在 DSH 原生窗口进行工具审批|Approve tools in the native DSH window/);
});

test('embedded navigation uses local tabs without touching host pathname', async ({ page }) => {
  test.setTimeout(150_000);
  await openRvguarderSection(page);
  const pathnameBefore = new URL(page.url()).pathname;
  await page.locator('.rvg-embed').getByRole('tab', { name: /审计|Audit/ }).click();
  await expect(page.locator('[data-testid="embed-audit"]')).toBeVisible({ timeout: 15_000 });
  expect(new URL(page.url()).pathname).toBe(pathnameBefore);
  // 切回概览（局部状态，不重载）
  await page.locator('.rvg-embed').getByRole('tab', { name: /概览|Overview/ }).click();
  await expect(page.locator('[data-testid="dsh-host-panel"]').first()).toBeVisible({ timeout: 15_000 });
});

test('embedded actions tab lists actions and marks native approval', async ({ page }) => {
  test.setTimeout(150_000);
  await openRvguarderSection(page);
  await page.locator('.rvg-embed').getByRole('tab', { name: /调用与审批|Calls & approvals/ }).click();
  await expect(page.locator('.approval-list, .empty').first()).toBeVisible({ timeout: 15_000 });
  // DSH 动作卡片不出现自建批准按钮（原生审批为准）
  await expect(page.locator('.approve-action')).toHaveCount(0);
});

test('embedded scan tab can run baseline and audit tab shows chain', async ({ page }) => {
  test.setTimeout(180_000);
  await openRvguarderSection(page);
  await page.locator('.rvg-embed').getByRole('tab', { name: /扫描与报告|Scans & reports/ }).click();
  const run = page.locator('#run-baseline');
  await expect(run).toBeVisible({ timeout: 15_000 });
  await run.click();
  await expect(run).toBeEnabled({ timeout: 120_000 });
  await page.locator('.rvg-embed').getByRole('tab', { name: /审计|Audit/ }).click();
  await expect(page.locator('[data-testid="embed-audit"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="embed-audit"]')).toContainText(/审计链完整性|Audit integrity/, { timeout: 30_000 });
});

test('closing settings unmounts embedded app without residue', async ({ page }) => {
  test.setTimeout(150_000);
  await openRvguarderSection(page);
  await expect(page.locator('#rvguarder-embedded-styles')).toHaveCount(1);
  // 关闭设置面板（Esc）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  // 兜底：再次 Esc（第一次可能只是关公告层）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  const stillMounted = await page.locator('[data-testid="rvguarder-settings-section"]').count();
  if (stillMounted) {
    await page.locator('button[aria-label="Close"], [aria-label*="关闭"]').first().click().catch(() => {});
    await page.waitForTimeout(1000);
  }
  // 样式表被移除（dispose 清理）
  await expect(page.locator('[data-testid="rvguarder-settings-section"]')).toHaveCount(0);
  await expect(page.locator('#rvguarder-embedded-styles')).toHaveCount(0, { timeout: 10_000 });
});

test('embedded downloads contain real JSON report and audit bytes', async ({ page }) => {
  test.setTimeout(180_000);
  await openRvguarderSection(page);
  await page.locator('.rvg-embed').getByRole('tab', { name: /扫描与报告|Scans & reports/ }).click();
  await page.locator('#run-baseline').click();
  await expect(page.locator('#run-baseline')).toBeEnabled({ timeout: 120_000 });
  await page.locator('.rvg-embed').getByRole('tab', { name: /概览|Overview/ }).click();
  const reportReady = page.waitForEvent('download');
  await page.locator('[data-testid="dsh-host-panel"]').getByRole('button', { name: 'JSON', exact: true }).click();
  const report = await reportReady;
  expect(report.suggestedFilename()).toBe('rvguarder-report.json');
  expect(typeof JSON.parse(fs.readFileSync(await report.path(), 'utf8'))).toBe('object');
  await page.locator('.rvg-embed').getByRole('tab', { name: /审计|Audit/ }).click();
  const auditReady = page.waitForEvent('download');
  await page.getByRole('button', { name: /^(导出|Export) JSON$/ }).click();
  const audit = await auditReady;
  expect(audit.suggestedFilename()).toBe('rvguarder-audit-export.json');
  expect(typeof JSON.parse(fs.readFileSync(await audit.path(), 'utf8'))).toBe('object');
  const output = path.resolve(__dirname, '../../runtime/rc5-evidence/browser');
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'managed-audit.png') });
});

test('managed bundle disable and enable preserve identity and business history', async ({ page }) => {
  test.skip(!process.env.RVGUARDER_MANAGED_PACKAGE, 'platform bundle only');
  test.setTimeout(150_000);
  await openRvguarderSection(page);
  const rpc = async (service, method, args = {}) => {
    const response = await page.request.post(new URL(`/api/${service}/${method}`, dshUrl()).href, { data: { type: 'client-request', rpcId: crypto.randomUUID(), method: `${service}/${method}`, payload: { args } } });
    expect(response.ok()).toBe(true);
    const body = await response.json(); expect(body.result.ok).toBe(true); return body.result.value;
  };
  const before = await rpc('rvguarderAdmin', 'overview');
  expect(before.backend.online).toBe(true);
  await rpc('pluginManager', 'setBundleEnabled', { name: 'dsh-rvguarder', enabled: false });
  const own = entries => entries.filter(e => ['dsh-rvguarder', 'dsh-rvguarder/admin'].includes(e.moduleName));
  await expect.poll(async () => {
    const bundle = (await rpc('pluginManager', 'listBundles')).find(bundle => bundle.name === 'dsh-rvguarder');
    const entries = own((await rpc('pluginInventory', 'list')).entries);
    return bundle?.enabled === false && entries.every(e => e.fiberPhase !== 'active');
  }, { timeout: 15000 }).toBe(true);
  await rpc('pluginManager', 'setBundleEnabled', { name: 'dsh-rvguarder', enabled: true });
  await expect.poll(async () => { try { return (await rpc('rvguarderAdmin', 'overview')).backend.online; } catch { return false; } }, { timeout: 60000 }).toBe(true);
  const after = await rpc('rvguarderAdmin', 'overview');
  expect(after.backend.instanceId).toBe(before.backend.instanceId);
  const entries = (await rpc('pluginInventory', 'list')).entries;
  expect(entries.filter(e => e.moduleName === 'dsh-rvguarder')).toHaveLength(1);
  expect(entries.filter(e => e.moduleName === 'dsh-rvguarder/admin')).toHaveLength(1);
});

test('embedded browser surfaces never receive temporary bridge credentials', async ({ page }) => {
  test.setTimeout(150_000);
  const info = JSON.parse(fs.readFileSync(path.join(__dirname, '../.cache/embed-e2e.json'), 'utf8'));
  await openRvguarderSection(page);
  await expect(page.locator('.rvg-embed')).toContainText(/已连接|[Cc]onnected/);
  let runtime = path.join(info.tmpRoot, 'guard/runtime');
  const managedRoot = path.join(info.tmpRoot, 'home/rvguarder');
  if (process.env.RVGUARDER_MANAGED_PACKAGE) {
    const instance = fs.readdirSync(managedRoot).find(name => name.startsWith('dsh-'));
    runtime = path.join(managedRoot, instance, 'runtime');
  }
  const token = fs.readFileSync(path.join(runtime, 'dsh-token'), 'utf8').trim();
  const signing = fs.readFileSync(path.join(runtime, 'authorization/content-signing.key'));
  const secrets = [token, signing.toString('hex'), signing.toString('base64')];
  const clean = text => secrets.every(secret => !text.includes(secret));
  expect(clean(await page.content())).toBe(true);
  expect(clean(page.url())).toBe(true);
  expect(clean(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })))).toBe(true);
  // 检查有限响应，避免对宿主常驻事件流调用 response.text()。
  const overview = await page.request.post(new URL('/api/rvguarderAdmin/overview', dshUrl()).href, {
    data: { type: 'client-request', rpcId: 'credential-scan', method: 'rvguarderAdmin/overview', payload: { args: {} } }, timeout: 10_000,
  });
  expect(overview.ok()).toBe(true);
  expect(clean(await overview.text())).toBe(true);
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => name.includes('/plugins/')));
  expect(resources.length).toBeGreaterThan(0);
  for (const url of new Set(resources)) {
    const resource = await page.request.get(url, { timeout: 10_000 });
    expect(resource.ok()).toBe(true);
    expect(clean(await resource.text())).toBe(true);
  }
});
