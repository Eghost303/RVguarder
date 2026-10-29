/** 证据截图：设置 → RVguarder（打开与审计两个视图）。 */
const { test } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const cachedUrl = () => { try { return fs.readFileSync(path.join(__dirname, '../.cache/embed-e2e-url.txt'), 'utf8').trim(); } catch { return null; } };

async function openRvg(page) {
  const presentation = page.locator('[role="presentation"] button');
  if (await presentation.count()) {
    const continueButton = presentation.filter({ hasText: 'Continue' }).first();
    if (await continueButton.count()) { await continueButton.click({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1200); }
  }
  if (await page.locator('[class*="_mask_o6lrb"]').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
  await page.locator('button[aria-label="Account menu"]').click({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  await page.locator('[role="menuitem"]:has-text("设置"), [role="menuitem"]:has-text("Settings")').first().click();
  await page.waitForTimeout(1500);
  await page.locator('text=RVguarder').first().click();
  await page.waitForTimeout(4000);
}

test('capture evidence screenshots', async ({ page }) => {
  test.setTimeout(150_000);
  fs.mkdirSync('evidence', { recursive: true });
  await page.goto(process.env.DSH_UI_E2E_URL || cachedUrl(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'evidence/01-dsh-shell.png' });
  // 插件面板
  await page.locator('button[aria-label="Plugins"]').click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'evidence/02-plugins-page.png', fullPage: true });
  await page.locator('button[aria-label="Plugins"]').click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
  // 设置 → RVguarder
  await openRvg(page);
  await page.screenshot({ path: 'evidence/03-settings-rvguarder-overview.png', fullPage: true });
  await page.locator('.rvg-embed-tab:has-text("审计")').click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'evidence/04-settings-rvguarder-audit.png', fullPage: true });
  await page.locator('.rvg-embed-tab:has-text("调用与审批")').click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'evidence/05-settings-rvguarder-actions.png', fullPage: true });
});
