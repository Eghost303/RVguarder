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
import { apply as applyAdmin } from '../dist/admin.js';

function fixture(t, { status = 200, body = { ok: true }, identity = 'test', protocol = 'dsh-guard-v2' } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'rvg-admin-'));
  const tokenFile = join(temp, 'token');
  writeFileSync(tokenFile, 'x'.repeat(48));
  const server = createServer((req, res) => {
    if (req.headers['x-rvguarder-token'] !== 'x'.repeat(48)) { res.writeHead(401).end(); return; }
    if (req.url === '/api/dsh/status' && status === 200) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ protocol, instance_id: identity })); return; }
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

test('every management method rejects non-owner', async (t) => {
  const { service, ctx } = await admin(t);
  Object.defineProperty(ctx, 'invocation', { value: { peer: { principal: { kind: 'agent', id: 'untrusted' } } }, configurable: true });
  for (const [method, args] of Object.entries({ overview: [], actionDetail: ['a'], policy: [], rvStatus: [], rvToggle: [true], semanticMode: ['local'], runScan: [], audit: [], auditExport: ['json'], report: ['json'] })) {
    await assert.rejects(() => service[method](...args), (error) => error.code === 'rvguarder/not-owner', method);
  }
});

test('wrong identity is rejected for reads, mutations and downloads', async (t) => {
  const { service } = await admin(t, { backend: { identity: 'other' } });
  for (const run of [() => service.overview(), () => service.rvToggle(true), () => service.auditExport('json')]) {
    await assert.rejects(run, (error) => error.code === 'rvguarder/instance-mismatch');
  }
});

test('HTTP/authentication errors cannot become successful offline overview', async (t) => {
  for (const [status, code] of [[500, 'rvguarder/backend-error'], [401, 'rvguarder/backend-unauthorized']]) {
    const { service } = await admin(t, { backend: { status } });
    await assert.rejects(() => service.overview(), (error) => error.code === code);
  }
});

test('large UTF-8 JSON is limited by bytes', async (t) => {
  const { service } = await admin(t, { backend: { body: { message: '中'.repeat(1500000) } } });
  await assert.rejects(() => service.overview(), (error) => error.code === 'rvguarder/response-too-large');
});

test('startup overview remains bounded while runtime initialization is pending', async t => {
  const f = fixture(t); await f.ready;
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  const service = new RvguarderAdmin(ctx, { backendUrl: 'http://127.0.0.1:1', tokenFile: '', instanceId: 'starting-instance', connectionReady: new Promise(() => {}), deploymentStatus: () => ({ mode: 'managed', state: 'starting' }) });
  const result = await service.overview();
  assert.equal(result.backend.online, false); assert.equal(result.backend.deployment.state, 'starting'); assert.equal(result.backend.instanceId, 'starting-instance');
});

test('invalid JSON shape and HTTP 403 have distinct visible failure codes', async t => {
  const malformed = await admin(t, { backend: { body: ['not-an-object'] } });
  await assert.rejects(() => malformed.service.overview(), error => error.code === 'rvguarder/backend-protocol');
  const forbidden = await admin(t, { backend: { status: 403 } });
  await assert.rejects(() => forbidden.service.overview(), error => error.code === 'rvguarder/backend-error' && error.details.status === 403);
});

test('core recovery lock is reported even when the backend process is ready', async t => {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  const service = new RvguarderAdmin(ctx, { backendUrl: 'http://127.0.0.1:1', tokenFile: '', instanceId: 'locked-instance', connectionReady: new Promise(() => {}), deploymentStatus: () => ({ mode: 'managed', state: 'failed', reason: 'recovery-required' }) });
  const value = await service.overview();
  assert.equal(value.backend.recoveryRequired, true);
  assert.equal(value.backend.online, false);
  assert.equal(value.backend.deployment.reason, 'recovery-required');
});

test('synchronous managed workspace configuration errors stay visible without paths', async t => {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  const home = join(tmpdir(), 'rvg-invalid-config-home');
  ctx.provide('profileContext', { home, name: 'rvguarder-dev', cwd: home });
  applyAdmin(ctx, { backendMode: 'managed', resourceWorkspace: home });
  const service = ctx.get('rvguarderAdmin');
  const result = await service.overview();
  assert.equal(result.backend.online, false);
  assert.equal(result.backend.deployment.reason, 'workspace-conflict');
  assert.equal(JSON.stringify(result).includes(home), false);
});
