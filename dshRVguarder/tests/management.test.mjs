/** 管理适配器测试：owner 门禁、固定方法、后端脱敏与错误映射。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Context } from '@deepseek-ai/cordis';
import { RvguarderAdmin } from '../dist/management.js';

function fixture(t, { status = 200, body = { ok: true } } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'rvg-admin-'));
  const tokenFile = join(temp, 'token');
  writeFileSync(tokenFile, 'x'.repeat(48));
  const server = createServer((req, res) => {
    if (req.headers['x-rvguarder-token'] !== 'x'.repeat(48)) { res.writeHead(401).end(); return; }
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); rmSync(temp, { recursive: true, force: true }); });
  return { server, temp, tokenFile, ready: once(server, 'listening') };
}

async function admin(t, overrides = {}) {
  const f = fixture(t, overrides.backend);
  await f.ready;
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); });
  return { service: new RvguarderAdmin(ctx, { backendUrl: 'http://127.0.0.1:' + f.server.address().port, tokenFile: f.tokenFile, instanceId: 'test', timeoutMs: 1000 }), ctx, f };
}

test('constructor rejects non-loopback backend', () => {
  const temp = mkdtempSync(join(tmpdir(), 'rvg-admin-'));
  const tokenFile = join(temp, 'token');
  writeFileSync(tokenFile, 'x'.repeat(48));
  for (const url of ['http://10.0.0.1:1', 'http://127.0.0.1:1/path', 'https://127.0.0.1:1']) {
    assert.throws(() => new RvguarderAdmin(new Context(), { backendUrl: url, tokenFile, instanceId: 'test' }), /loopback/);
  }
  rmSync(temp, { recursive: true, force: true });
});

test('management methods are a fixed allowlist on the prototype', () => {
  const proto = RvguarderAdmin.prototype;
  for (const method of ['overview', 'actionDetail', 'policy', 'rvStatus', 'rvToggle', 'semanticMode', 'runScan', 'audit', 'auditExport', 'report']) {
    assert.equal(typeof proto[method], 'function', method);
  }
  // 桥接执行接口不得进入管理面。
  for (const absent of ['hello', 'before', 'dispatch', 'result', 'degraded', 'probe', 'request']) {
    assert.equal(proto[absent], undefined, absent);
  }
});

test('non-owner invocation is refused with rvguarder/not-owner', async (t) => {
  const { service, ctx } = await admin(t);
  // 模拟非 owner：ctx.invocation 携带非 owner principal。
  const invocation = { peer: { principal: { kind: 'api-operator', id: 'op-1' } } };
  Object.defineProperty(ctx, 'invocation', { value: invocation, configurable: true });
  await assert.rejects(() => service.overview(), (error) => {
    assert.equal(error.code, 'rvguarder/not-owner');
    return true;
  });
});

test('owner invocation reaches backend and returns sanitized overview', async (t) => {
  const summary = {
    generated_at: 'now', host: { kind: 'dsh', instance_id: 'test', profile: 'p' }, hook: { active: true },
    semantic: { configured_mode: 'local' }, actions: { counts: {}, items: [] },
    target: { profile: 'p', workspace_path: 'C:/secret/path' }, paths: { runtime_dir: 'C:/private' },
    settings: { sqlite_path: 'C:/private/audit.db', policy_template: 'default' },
  };
  const { service } = await admin(t, { backend: { status: 200, body: summary } });
  const result = await service.overview();
  assert.equal(result.ok, true);
  assert.equal(result.backend.online, true);
  assert.equal(result.summary.hook.active, true);
  // target/paths/settings 不整体离开宿主；settings 携带 sqlite/jsonl 绝对路径。
  assert.equal(result.summary.target, undefined);
  assert.equal(result.summary.paths, undefined);
  assert.equal(result.summary.settings, undefined);
  assert.equal(result.summary.target_profile, 'p');
});

test('backend offline maps to online:false rather than throwing', async (t) => {
  const f = fixture(t);
  const ctx = new Context();
  const service = new RvguarderAdmin(ctx, { backendUrl: 'http://127.0.0.1:1', tokenFile: f.tokenFile, instanceId: 'test', timeoutMs: 500 });
  t.after(async () => { await ctx.fiber.dispose(); });
  const result = await service.overview();
  assert.equal(result.ok, true);
  assert.equal(result.backend.online, false);
  assert.equal(result.summary, null);
});

test('actionDetail validates identifier and maps missing action', async (t) => {
  const { service } = await admin(t);
  await assert.rejects(() => service.actionDetail('../etc/passwd'), (e) => e.code === 'rvguarder/invalid-argument');
  await assert.rejects(() => service.actionDetail(123), (e) => e.code === 'rvguarder/invalid-argument');
});

test('semanticMode only accepts local/auto/llm and maps missing key', async (t) => {
  const { service } = await admin(t);
  await assert.rejects(() => service.semanticMode('fast'), (e) => e.code === 'rvguarder/invalid-argument');
  const f = fixture(t, { status: 409, body: { error: 'llm_mode_requires_host_api_key' } });
  await once(f.server, 'listening');
  const ctx = new Context();
  const conflict = new RvguarderAdmin(ctx, { backendUrl: 'http://127.0.0.1:' + f.server.address().port, tokenFile: f.tokenFile, instanceId: 'test', timeoutMs: 500 });
  t.after(async () => { await ctx.fiber.dispose(); });
  await assert.rejects(() => conflict.semanticMode('llm'), (e) => e.code === 'rvguarder/llm-key-missing');
});

test('report and auditExport accept only controlled formats', async (t) => {
  const { service } = await admin(t);
  await assert.rejects(() => service.report('exe'), (e) => e.code === 'rvguarder/invalid-argument');
  await assert.rejects(() => service.auditExport('xml'), (e) => e.code === 'rvguarder/invalid-argument');
});

test('rvToggle requires boolean', async (t) => {
  const { service } = await admin(t);
  await assert.rejects(() => service.rvToggle('yes'), (e) => e.code === 'rvguarder/invalid-argument');
});
