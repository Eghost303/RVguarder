/** 从实际整包自动初始化全新数据，并跨启动目录复用身份；不另建真实 DSH profile。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, parse } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

test('clean platform package boots from a broad cwd and reuses identity from another cwd', {
  skip: !process.env.RVGUARDER_TEST_PACKAGE && 'set RVGUARDER_TEST_PACKAGE to unpacked platform package', timeout: 120000,
}, async t => {
  const root = mkdtempSync(join(tmpdir(), 'rvg-clean-managed-'));
  const user = join(root, 'user'), home = join(user, '.dsh'); mkdirSync(user);
  const module = await import(pathToFileURL(join(process.env.RVGUARDER_TEST_PACKAGE, 'dist/managed.js')).href);
  const ctx = cwd => ({ get: () => ({ home, name: 'rvguarder-dev', cwd }), workingDirectory: { defaultDirectory: cwd } });
  let owner;
  t.after(async () => { await owner?.release(); rmSync(root, { recursive: true, force: true }); });
  assert.equal(existsSync(join(home, 'workspaces', 'rvguarder-dev')), false);
  owner = module.acquireManaged(ctx(user));
  const first = await owner.ready;
  assert.equal(existsSync(join(home, 'workspaces', 'rvguarder-dev')), true);
  const token = readFileSync(first.tokenFile, 'utf8');
  const status = await fetch(first.backendUrl + '/api/dsh/status', { headers: { 'x-rvguarder-token': token } });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).instance_id, first.instanceId);
  await owner.release();
  await assert.rejects(fetch(first.backendUrl + '/api/dsh/status'));
  owner = module.acquireManaged(ctx(parse(root).root));
  const second = await owner.ready;
  assert.equal(second.instanceId, first.instanceId);
  assert.equal(second.tokenFile, first.tokenFile);
  assert.equal(readFileSync(second.tokenFile, 'utf8'), token);
  assert.equal(owner.status().state, 'ready');
});
