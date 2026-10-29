/** 真实rc.3主题快照结构，覆盖system解析结果及缺少服务的兼容降级。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source = stripTypeScriptTypes(readFileSync(new URL('../client/appearance.ts', import.meta.url), 'utf8'));
const {readHostTheme} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('host theme reads active.colorScheme including system preference', () => {
  const ctx = snapshot => ({ get: () => ({ getTheme: () => snapshot }) });
  assert.equal(readHostTheme(ctx({ preference: 'system', active: { id: 'dark', colorScheme: 'dark' } })), 'dark');
  assert.equal(readHostTheme(ctx({ preference: 'dark', active: { id: 'custom-light', colorScheme: 'light' } })), 'light');
  assert.equal(readHostTheme({ get: () => undefined }), 'light');
  assert.equal(readHostTheme(), 'light');
});
