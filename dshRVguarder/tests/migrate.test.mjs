/** 迁移脚本测试：旧 plain-dependency profile → bundle；幂等、保留身份与历史。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'migrate-test-profile.mjs');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function makeOldProfile(home, { withInsert = true, extraPlugin = false } = {}) {
  const dir = join(home, 'profiles', 'rvguarder-old');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'rvguarder-profile-rvguarder-old', private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    dependencies: { 'dsh-rvguarder': 'file:C:/some/old.tgz', ...(extraPlugin ? { 'other-plugin': '^1.0.0' } : {}) },
  }, null, 2));
  const patches = [];
  if (withInsert) {
    patches.push({ insert: [{ id: 'rvguarder-dsh', name: 'dsh-rvguarder', config: {
      backendUrl: 'http://127.0.0.1:8780', instanceId: 'old-inst', tokenFile: 'C:/old/token',
      stateDir: 'C:/old/state', timeoutMs: 6000, failMode: 'open' } }] });
  }
  if (extraPlugin) patches.push({ id: 'other-plugin', config: { enabled: true } });
  writeFileSync(join(dir, 'cordis.patch.yml'), JSON.stringify(patches, null, 2));
  return dir;
}

function run(args) {
  return execFileSync('node', [script, ...args], { encoding: 'utf8' });
}

/** 生成一个存在的令牌文件（脚本要求存在性校验）。 */
function fakeToken(temp) {
  const token = join(temp, 'token');
  writeFileSync(token, 'x'.repeat(48));
  return token;
}

test('migration converts insert row to bundle and preserves identity', () => {
  const temp = mkdtempSync(join(tmpdir(), 'rvg-mig-'));
  try {
    const home = join(temp, 'home');
    makeOldProfile(home);
    const token = fakeToken(temp);
    const out = JSON.parse(run(['--profile', 'rvguarder-old', '--token', token, '--home', home]));
    assert.equal(out.migrated, true);
    assert.equal(out.instanceId, 'old-inst');
    assert.equal(out.tokenReused, true);
    // bundle 加入且其他 bundle 保留
    const manifest = JSON.parse(readFileSync(join(home, 'profiles/rvguarder-old/package.json'), 'utf8'));
    assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-rvguarder']);
    // 用户层：id 定向覆盖 + 保留旧 config 字段
    const patches = JSON.parse(readFileSync(join(home, 'profiles/rvguarder-old/cordis.patch.yml'), 'utf8'));
    const core = patches.find((p) => p.id === 'rvguarder-dsh');
    const admin = patches.find((p) => p.id === 'rvguarder-admin');
    assert.ok(core && !core.insert);
    assert.equal(core.config.instanceId, 'old-inst');
    assert.equal(core.config.backendUrl, 'http://127.0.0.1:8780');
    assert.equal(core.config.failMode, 'open');
    assert.equal(core.config.timeoutMs, 6000);
    assert.ok(admin);
    assert.equal(admin.config.instanceId, 'old-inst');
    // 备份存在
    assert.ok(listBackups(home).length >= 1);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

import { readdirSync } from 'node:fs';

function listBackups(home) {
  try { return readdirSync(join(home, 'profiles/rvguarder-old')).filter((n) => n.startsWith('.rvguarder-migration-')); } catch { return []; }
}

test('repeat migration is idempotent (no second backup, no change)', () => {
  const temp = mkdtempSync(join(tmpdir(), 'rvg-mig-'));
  try {
    const home = join(temp, 'home');
    makeOldProfile(home);
    const token = fakeToken(temp);
    const first = JSON.parse(run(['--profile', 'rvguarder-old', '--token', token, '--home', home]));
    assert.equal(first.migrated, true);
    const before = readFileSync(join(home, 'profiles/rvguarder-old/cordis.patch.yml'), 'utf8');
    const second = JSON.parse(run(['--profile', 'rvguarder-old', '--token', token, '--home', home]));
    assert.equal(second.migrated, false);
    assert.equal(second.reason, 'already-bundle');
    const after = readFileSync(join(home, 'profiles/rvguarder-old/cordis.patch.yml'), 'utf8');
    assert.equal(before, after);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('other plugins and unknown shapes are preserved or refused', () => {
  const temp = mkdtempSync(join(tmpdir(), 'rvg-mig-'));
  try {
    const home = join(temp, 'home');
    makeOldProfile(home, { extraPlugin: true });
    run(['--profile', 'rvguarder-old', '--token', fakeToken(temp), '--home', home]);
    const patches = JSON.parse(readFileSync(join(home, 'profiles/rvguarder-old/cordis.patch.yml'), 'utf8'));
    const other = patches.find((p) => p.id === 'other-plugin');
    assert.ok(other && other.config.enabled === true, 'other plugin patch preserved');
    // 未知形状拒绝
    const badHome = join(temp, 'home2');
    const bad = makeOldProfile(badHome);
    writeFileSync(join(bad, 'cordis.patch.yml'), '{ not json');
    assert.throws(() => run(['--profile', 'rvguarder-old', '--token', fakeToken(temp), '--home', badHome]), /不是可解析的 JSON 数组|refuses to migrate|cannot be parsed/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
