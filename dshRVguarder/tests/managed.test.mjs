/** 整包边界与真实子进程生命周期测试；原生运行时由平台构建产物提供。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyBackend, deploymentFor, ManagedBackend, acquireManaged } from '../dist/managed.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'rvg-package-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const executable = process.platform === 'win32' ? 'rvguarder-backend.exe' : 'rvguarder-backend';
  writeFileSync(join(root, executable), 'fixture');
  const manifest = { schema: 1, platform: process.platform, arch: process.arch, executable,
    files: { [executable]: createHash('sha256').update('fixture').digest('hex') } };
  const save = () => writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  save(); return { root, manifest, save };
}

test('platform manifest verifies whole payload and rejects corruption/extra files', (t) => {
  const f = fixture(t);
  assert.equal(verifyBackend(f.root), join(f.root, f.manifest.executable));
  writeFileSync(join(f.root, f.manifest.executable), 'changed');
  assert.throws(() => verifyBackend(f.root), /integrity/);
  writeFileSync(join(f.root, f.manifest.executable), 'fixture');
  writeFileSync(join(f.root, 'extra'), 'unexpected');
  assert.throws(() => verifyBackend(f.root), /inventory/);
});

test('wrong platform and manifest path traversal cannot select executable', (t) => {
  const f = fixture(t);
  f.manifest.platform = 'other'; f.save();
  assert.throws(() => verifyBackend(f.root), /platform/);
  f.manifest.platform = process.platform;
  delete f.manifest.files[f.manifest.executable];
  f.manifest.files['../outside'] = '0'.repeat(64); f.save();
  assert.throws(() => verifyBackend(f.root), /inventory/);
});

test('trusted profile binding separates homes and profile names', () => {
  const home = join(tmpdir(), 'host-home');
  const workspace = join(tmpdir(), 'agent-workspace');
  const ctx = (name, homeDir = home) => ({ get: () => ({ home: homeDir, name, cwd: workspace }), workingDirectory: { defaultDirectory: workspace } });
  assert.equal(deploymentFor(ctx('one')).instanceId, deploymentFor(ctx('one')).instanceId);
  assert.notEqual(deploymentFor(ctx('one')).instanceId, deploymentFor(ctx('two')).instanceId);
  assert.notEqual(deploymentFor(ctx('one')).instanceId, deploymentFor(ctx('one', home + '-2')).instanceId);
  assert.throws(() => deploymentFor(ctx('..')), /trusted/);
});

test('frozen backend authenticates, stops on pipe close and preserves identity', {
  skip: !process.env.RVGUARDER_TEST_BACKEND && 'set RVGUARDER_TEST_BACKEND to platform build executable', timeout: 120000,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rvg-process-'));
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const deployment = { directory: join(root, 'data'), workspace, home: join(root, 'home'), profile: 'test', instanceId: 'process-test' };
  const backend = new ManagedBackend(deployment, process.env.RVGUARDER_TEST_BACKEND);
  t.after(async () => { await backend.close(); rmSync(root, { recursive: true, force: true }); });
  const first = await backend.ready;
  const token = readFileSync(first.tokenFile, 'utf8');
  const anonymous = await fetch(first.backendUrl + '/api/dsh/status');
  assert.equal(anonymous.status, 401);
  const other = new ManagedBackend(deployment, process.env.RVGUARDER_TEST_BACKEND);
  await assert.rejects(other.ready, /failed to start/); await other.close();
  await backend.close(); await backend.close();
  await assert.rejects(fetch(first.backendUrl + '/api/dsh/status'));
  const second = new ManagedBackend(deployment, process.env.RVGUARDER_TEST_BACKEND);
  try { const connection = await second.ready; assert.equal(readFileSync(connection.tokenFile, 'utf8'), token); }
  finally { await second.close(); }
});

test('shared managed owners and rapid reacquisition serialize shutdown before restart', {
  skip: !process.env.RVGUARDER_TEST_BACKEND && 'set RVGUARDER_TEST_BACKEND to platform build executable', timeout: 120000,
}, async t => {
  const root = mkdtempSync(join(tmpdir(), 'rvg-reload-'));
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const ctx = { get: () => ({ home: join(root, 'home'), name: 'test', cwd: workspace }), workingDirectory: { defaultDirectory: workspace } };
  let starts = 0;
  const factory = deployment => { starts++; return new ManagedBackend(deployment, process.env.RVGUARDER_TEST_BACKEND); };
  const core = acquireManaged(ctx, factory), admin = acquireManaged(ctx, factory);
  const first = await core.ready;
  assert.equal((await admin.ready).backendUrl, first.backendUrl); assert.equal(starts, 1);
  await core.release();
  assert.equal((await fetch(first.backendUrl + '/api/dsh/status')).status, 401);
  const closing = admin.release();
  const next = acquireManaged(ctx, factory);
  t.after(async () => { await next.release(); rmSync(root, { recursive: true, force: true }); });
  const second = await next.ready; await closing;
  assert.equal(starts, 2); assert.equal(second.tokenFile, first.tokenFile);
  assert.equal((await fetch(second.backendUrl + '/api/dsh/status')).status, 401);
});
