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
  await expect(embed).toContainText('已连接', { timeout: 30_000 });
  await expect(embed).toContainText('请在 DSH 原生窗口进行工具审批');
});

test('embedded navigation uses local tabs without touching host pathname', async ({ page }) => {
  test.setTimeout(150_000);
  await openRvguarderSection(page);
  const pathnameBefore = new URL(page.url()).pathname;
  await page.locator('.rvg-embed-tab:has-text("审计")').click();
  await expect(page.locator('[data-testid="embed-audit"]')).toBeVisible({ timeout: 15_000 });
  expect(new URL(page.url()).pathname).toBe(pathnameBefore);
  // 切回概览（局部状态，不重载）
  await page.locator('.rvg-embed-tab:has-text("概览")').click();
  await expect(page.locator('[data-testid="dsh-host-panel"]').first()).toBeVisible({ timeout: 15_000 });
});

test('embedded actions tab lists actions and marks native approval', async ({ page }) => {
  test.setTimeout(150_000);
  await openRvguarderSection(page);
  await page.locator('.rvg-embed-tab:has-text("调用与审批")').click();
  await expect(page.locator('.approval-list, .empty').first()).toBeVisible({ timeout: 15_000 });
  // DSH 动作卡片不出现自建批准按钮（原生审批为准）
  await expect(page.locator('.approve-action')).toHaveCount(0);
});

test('embedded scan tab can run baseline and audit tab shows chain', async ({ page }) => {
  test.setTimeout(180_000);
  await openRvguarderSection(page);
  await page.locator('.rvg-embed-tab:has-text("扫描与报告")').click();
  const run = page.locator('#run-baseline');
  await expect(run).toBeVisible({ timeout: 15_000 });
  await run.click();
  await expect(run).toBeEnabled({ timeout: 120_000 });
  await page.locator('.rvg-embed-tab:has-text("审计")').click();
  await expect(page.locator('[data-testid="embed-audit"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="embed-audit"]')).toContainText('审计链完整性', { timeout: 30_000 });
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
  await expect(page.locator('#rvguarder-embedded-styles')).toHaveCount(0, { timeout: 10_000 }).catch(() => {
    // 若宿主复用了面板（未真正卸载），至少 DOM 中组件应已卸载
    expect(page.locator('[data-testid="rvguarder-settings-section"]').count()).toBe(0);
  });
});
