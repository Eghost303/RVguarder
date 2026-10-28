/** 在固定 rvguarder-dev profile 中验证不同启动目录，保留真实会话 cwd；不另建 profile。 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--cli', '--output'].includes(args[index]) || !args[index + 1]) throw new Error('Expected --cli <dsh.cmd> or --output <new-directory>');
  options[args[index].slice(2)] = args[index + 1];
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = options.cli || join(process.env.LOCALAPPDATA || '', 'Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd');
const home = join(homedir(), '.dsh'), profile = 'rvguarder-dev';
const output = resolve(options.output || join(repo, 'runtime/startup-proof'));
if (existsSync(output)) throw new Error('Use a new output directory');
if (!existsSync(join(home, 'profiles', profile, 'package.json'))) throw new Error('Install the platform bundle into rvguarder-dev first');
mkdirSync(output, { recursive: true });
const fixture = pathToFileURL(join(repo, 'dshRVguarder/tests/fixtures/startup-probe.mjs')).href;
const quote = value => { if (/[%!"&|<>^\r\n]/.test(value)) throw new Error('Unsupported shell path characters'); return '"' + value + '"'; };
const cases = [...new Set([homedir(), home, parse(homedir()).root, repo])];
const results = [];
for (const [index, cwd] of cases.entries()) {
  const resultPath = join(output, `case-${index}.json`), overlay = join(output, `case-${index}.yml`);
  writeFileSync(overlay, JSON.stringify([{ insert: [{ id: 'rvguarder-startup-proof', name: fixture, config: { output: resultPath, expectedDirectory: cwd } }] }]));
  const child = spawn([quote(cli), profile, '--patch', quote(overlay), '--no-open', '--port', '0'].join(' '), {
    shell: true, cwd, windowsHide: true, env: { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: ' ' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => writeFileSync(join(output, `case-${index}.out.log`), data, { flag: 'a' }));
  child.stderr.on('data', data => writeFileSync(join(output, `case-${index}.err.log`), data, { flag: 'a' }));
  let timer;
  const code = await new Promise((accept, reject) => {
    timer = setTimeout(() => {
      if (child.pid) { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} }
      reject(new Error('Owned startup test host timed out'));
    }, 120000);
    child.once('exit', accept); child.once('error', reject);
  }).finally(() => clearTimeout(timer));
  if (!existsSync(resultPath)) throw new Error('Host did not produce a sanitized startup report: case ' + index);
  const result = JSON.parse(readFileSync(resultPath, 'utf8'));
  results.push(result);
  if (code !== 0 || !result.ok || !result.cwdPreserved || !result.hostDisposed) throw new Error('Startup verification failed: case ' + index);
  console.log(JSON.stringify({ case: index, connected: true, cwdPreserved: true, hostDisposed: true }));
}
if (new Set(results.map(result => result.instanceId)).size !== 1) throw new Error('Startup cwd changed instance identity');
writeFileSync(join(output, 'summary.json'), JSON.stringify({ profile, cases: results, passed: results.length, sameInstance: true }, null, 2));
