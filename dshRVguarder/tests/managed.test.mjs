/** 整包边界与真实子进程生命周期测试；原生运行时由平台构建产物提供。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyBackend, deploymentFor, ManagedBackend, acquireManaged, coreFailureReason, deploymentFailureReason, prepareResourceWorkspace } from '../dist/managed.js';

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
  const binding = { projectDir: join(home, 'legacy-data'), instanceId: 'old-id', stateDir: join(home, 'legacy-plugin-state') };
  const migrated = deploymentFor(ctx('one'), binding);
  assert.equal(migrated.instanceId, 'old-id'); assert.equal(migrated.directory, binding.projectDir); assert.equal(migrated.stateDir, binding.stateDir);
  assert.throws(() => deploymentFor(ctx('one'), { ...binding, projectDir: workspace }), /outside/);
});

test('core recovery failure stays visible across concurrent admin readiness', async t => {
  const root = mkdtempSync(join(tmpdir(), 'rvg-core-failure-'));
  const ctx = { get: () => ({ home: join(root, 'home'), name: 'test', cwd: join(root, 'workspace') }), workingDirectory: { defaultDirectory: join(root, 'workspace') } };
  let finish;
  const connection = new Promise(resolve => { finish = resolve; });
  const factory = () => ({ ready: connection, alive: () => true, close: async () => {} });
  const core = acquireManaged(ctx, factory), admin = acquireManaged(ctx, factory);
  t.after(async () => { await core.release(); await admin.release(); rmSync(root, { recursive: true, force: true }); });
  const classified = coreFailureReason(new Error('Previous plugin owner exited; inspect outbox and explicitly remove stale owner.lock before restart'));
  assert.equal(classified, 'recovery-required');
  const failed = core.ready.then(() => core.reportFailure(classified));
  finish({ backendUrl: 'http://127.0.0.1:1', tokenFile: 'private', instanceId: 'test', stateDir: root });
  await Promise.all([failed, admin.ready]);
  assert.deepEqual(admin.status(), { mode: 'managed', state: 'failed', reason: 'recovery-required' });
  assert.equal(coreFailureReason(new Error('DSH plugin state directory already owned')), 'instance-conflict');
  assert.equal(coreFailureReason(new Error('Unconfirmed execution from previous process')), 'recovery-required');
});

test('managed profile storage and resource roots do not depend on launcher cwd', () => {
  const user = join(tmpdir(), 'user');
  const home = join(user, '.dsh');
  const choices = [user, home, join(home, 'rvguarder'), join(user, 'project'), process.platform === 'win32' ? 'C:\\' : '/'];
  let expected;
  for (const cwd of choices) {
    const workingDirectory = { defaultDirectory: cwd };
    const ctx = { get: () => ({ home, name: 'rvguarder-dev', cwd }), workingDirectory };
    const deployment = deploymentFor(ctx);
    assert.equal(deployment.workspace, join(home, 'workspaces', 'rvguarder-dev'));
    assert.equal(workingDirectory.defaultDirectory, cwd, 'must not change the host workspace');
    if (expected) assert.deepEqual(deployment, expected);
    expected = deployment;
  }
  const ctx = { get: () => ({ home, name: 'rvguarder-dev', cwd: user }), workingDirectory: { defaultDirectory: user } };
  assert.throws(() => deploymentFor(ctx, undefined, user), /outside managed resource workspace/);
  assert.throws(() => deploymentFor(ctx, undefined, join(expected.directory, 'resources')), /outside managed resource workspace/);
  assert.throws(() => deploymentFor(ctx, undefined, '.'), /Invalid managed resource workspace/);
  assert.equal(deploymentFailureReason(new Error('Guard data must be outside managed resource workspace')), 'workspace-conflict');
  assert.equal(deploymentFailureReason(new Error('Managed backend requires trusted DSH profileContext')), 'configuration-invalid');
});

test('a resource-root junction cannot include private state through an alias', t => {
  const root = mkdtempSync(join(tmpdir(), 'rvg-resource-alias-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const privateRoot = join(root, 'private'), alias = join(root, 'resources');
  mkdirSync(privateRoot); symlinkSync(privateRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => prepareResourceWorkspace({ directory: join(privateRoot, 'data'), workspace: alias, home: join(root, 'home'), profile: 'rvguarder-dev', instanceId: 'test' }), error => error.reason === 'workspace-conflict');
});

test('two owners with different default directories share the same managed backend', async t => {
  const root = mkdtempSync(join(tmpdir(), 'rvg-cwd-'));
  const home = join(root, 'home'); let starts = 0;
  const ctx = cwd => ({ get: () => ({ home, name: 'rvguarder-dev', cwd }), workingDirectory: { defaultDirectory: cwd } });
  const factory = () => { starts++; return { ready: Promise.resolve({ backendUrl: 'http://127.0.0.1:1', tokenFile: 'private', instanceId: 'test', stateDir: root }), alive: () => true, close: async () => {} }; };
  const core = acquireManaged(ctx(root), factory), admin = acquireManaged(ctx(join(root, 'project')), factory);
  t.after(async () => { await core.release(); await admin.release(); rmSync(root, { recursive: true, force: true }); });
  assert.deepEqual(await core.ready, await admin.ready); assert.equal(starts, 1);
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
