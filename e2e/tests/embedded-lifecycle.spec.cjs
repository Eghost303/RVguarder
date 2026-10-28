/** 实际内嵌构建的组件矩阵，与真实宿主验收分开记录。 */
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');

test.beforeEach(async ({ page }) => {
  const module = fs.readFileSync(path.resolve(__dirname, '../../runtime/embedded/rvguarder-embedded.mjs'), 'utf8');
  await page.route('http://embedded.test/**', route => route.fulfill({ contentType: route.request().url().endsWith('.mjs') ? 'text/javascript' : 'text/html', body: route.request().url().endsWith('.mjs') ? module : '<!doctype html><html><body></body></html>' }));
  await page.goto('http://embedded.test/');
  await page.evaluate(async () => {
    window.mount = (await import('/embedded.mjs')).mountEmbedded;
    window.handles = {};
    window.counts = {};
    window.faults = {};
    window.add = (id, fault) => {
      const container = document.createElement('section'); container.id = id; document.body.append(container);
      window.faults[id] = fault;
      const transport = { call: async method => {
        window.counts[id] = (window.counts[id] || 0) + 1;
        if (window.faults[id]) throw Object.assign(new Error(window.faults[id]), { code: window.faults[id] });
        if (method === 'overview') return { backend: { online: true, instanceId: id }, summary: { host: { kind: 'dsh', instance_id: id }, hook: { active: true }, actions: { counts: {}, items: [] }, semantic: {}, capabilities: {} } };
        return method === 'policy' ? { version: 'fixture', rules: [{ id: 'contrast-rule', source: 'Readable rule description', effect: 'block', match: { operation: 'file.read' } }] } : { items: [], chain: { ok: true } };
      }, download: async () => new TextEncoder().encode('{}').buffer };
      window.handles[id] = window.mount(container, { transport, instanceId: id, language: 'zh' });
    };
  });
});

test('mounts isolate data and dispose only their own style/transport/requests', async ({ page }) => {
  await page.evaluate(() => { add('alpha'); add('beta'); });
  await expect(page.locator('#alpha')).toContainText('alpha');
  await expect(page.locator('#beta')).toContainText('beta');
  await expect(page.locator('#beta')).not.toContainText('alpha');
  await page.evaluate(() => handles.alpha.dispose());
  await expect(page.locator('#rvguarder-embedded-styles')).toHaveCount(1);
  await expect(page.locator('#beta .rvg-embed')).toHaveCount(1);
  await page.evaluate(() => { handles.beta.dispose(); handles.beta.dispose(); });
  await expect(page.locator('#rvguarder-embedded-styles')).toHaveCount(0);
});

test('language and theme updates preserve active tab and keyboard focus', async ({ page }) => {
  await page.evaluate(() => add('appearance'));
  const tabs = page.locator('#appearance [role=tab]');
  await tabs.first().focus(); await page.keyboard.press('End');
  await expect(tabs.last()).toBeFocused();
  await page.evaluate(() => handles.appearance.update({ language: 'en', theme: 'dark' }));
  await expect(page.locator('#appearance .rvg-embed')).toHaveAttribute('data-view', 'settings');
  await expect(page.locator('#appearance .rvg-embed')).toHaveAttribute('data-embed-theme', 'dark');
  await expect(tabs.last()).toHaveText(/Settings/); await expect(tabs.last()).toBeFocused();
  expect(await page.locator('html').getAttribute('data-theme')).toBeNull();
  await page.keyboard.press('Home'); await expect(tabs.first()).toBeFocused();
});

test('dark rule descriptions and severity labels have readable contrast', async ({ page }) => {
  await page.evaluate(() => { add('contrast'); handles.contrast.update({ language: 'en', theme: 'dark' }); });
  await page.locator('#contrast').getByRole('tab', { name: 'Rules & RV' }).click();
  await expect(page.locator('#contrast .rule-desc')).toHaveText('Readable rule description');
  const ratios = await page.evaluate(() => {
    const luminance = values => values.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const rgb = text => text.match(/[\d.]+/g).map(Number);
    const card = document.querySelector('#contrast .rule-card');
    const background = rgb(getComputedStyle(card).backgroundColor);
    return ['.rule-desc', '.rule-tag.sev-critical'].map(selector => {
      const node = card.querySelector(selector), style = getComputedStyle(node);
      const overlay = rgb(style.backgroundColor), alpha = overlay[3] ?? 1;
      const surface = overlay.slice(0, 3).map((value, index) => value * alpha + background[index] * (1 - alpha));
      const foreground = luminance(rgb(style.color)), behind = luminance(surface);
      return (Math.max(foreground, behind) + .05) / (Math.min(foreground, behind) + .05);
    });
  });
  for (const contrast of ratios) expect(contrast).toBeGreaterThanOrEqual(4.5);
});

for (const code of ['backend-unreachable', 'backend-unauthorized', 'not-owner', 'backend-error', 'backend-protocol', 'instance-mismatch', 'recovery-required']) {
  test('visible error and reconnect: ' + code, async ({ page }) => {
    await page.evaluate(code => add('fault', 'rvguarder/' + code), code);
    await expect(page.locator('#fault .rvg-embed')).toHaveAttribute('data-error-code', 'rvguarder/' + code);
    await expect(page.locator('#fault')).toContainText('rvguarder/' + code);
    await expect(page.getByRole('button', { name: '重新连接' })).toBeVisible();
  });
}

test('late response from disposed mount cannot replace the next instance', async ({ page }) => {
  await page.evaluate(() => {
    const container = document.createElement('div'); document.body.append(container);
    window.late = {};
    const old = mount(container, { instanceId: 'old', transport: { call: () => new Promise(resolve => { late.resolve = resolve; }), download: async () => new ArrayBuffer(0) } });
    old.dispose();
    add('current');
    late.resolve?.({ summary: { host: { kind: 'dsh', instance_id: 'old' } }, backend: { online: true } });
  });
  await expect(page.locator('#current')).toContainText('current');
  await expect(page.locator('#current')).not.toContainText('old');
});

test('reconnection clears errors and restores the current instance', async ({ page }) => {
  await page.evaluate(() => add('recover', 'rvguarder/backend-unreachable'));
  await expect(page.locator('#recover .rvg-embed')).toHaveAttribute('data-error-code', 'rvguarder/backend-unreachable');
  await page.evaluate(() => { faults.recover = null; });
  await page.getByRole('button', { name: '重新连接' }).click();
  await expect(page.locator('#recover .rvg-embed')).toHaveAttribute('data-error-code', '');
  await expect(page.locator('#recover')).toContainText('recover');
  await expect(page.locator('#recover .rvg-embed-offline')).toHaveCount(0);
});

test('repeated mounting leaves no polling timers or styles', async ({ page }) => {
  await page.evaluate(() => {
    const originalSet = window.setInterval, originalClear = window.clearInterval;
    window.liveTimers = new Set();
    window.setInterval = (...args) => { const id = originalSet(...args); liveTimers.add(id); return id; };
    window.clearInterval = id => { liveTimers.delete(id); return originalClear(id); };
  });
  for (let index = 0; index < 5; index++) {
    const id = 'repeat' + index;
    await page.evaluate(id => add(id), id);
    await expect(page.locator('#' + id)).toContainText(id);
    await page.evaluate(id => handles[id].dispose(), id);
    await expect.poll(() => page.evaluate(() => liveTimers.size)).toBe(0);
    await expect(page.locator('#rvguarder-embedded-styles')).toHaveCount(0);
  }
});
