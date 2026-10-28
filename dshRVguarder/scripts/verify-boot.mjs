/** 从真实宿主的认证 HTML 和客户端资源验证 boot graph；输出不含认证值。 */
import { readFileSync, writeFileSync } from 'node:fs';
const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, list) => index % 2 ? out : [...out, [value.slice(2), list[index + 1]]], []));
const origin = new URL(args.url).origin;
const logs = readFileSync(args.log, 'utf8');
const token = /token=([A-Za-z0-9_.-]+)/.exec(logs)?.[1];
if (!token) throw new Error('Host launch record missing');
// 根页面启动链接签发 owner cookie；/connect 是 API operator，不能代替 owner。
const authentication = await fetch(origin + '/?token=' + encodeURIComponent(token), { redirect: 'manual', signal: AbortSignal.timeout(10000) });
const cookie = authentication.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
const page = await fetch(origin + '/', { headers: { cookie, Accept: 'text/html' }, signal: AbortSignal.timeout(10000) });
const html = await page.text();
const resources = [...html.matchAll(/(?:\/)?plugins\/\?\?[^"'<>\s]+/g)].map(item => item[0].replaceAll('&amp;', '&'));
const resource = resources.find(url => decodeURIComponent(url).includes('dsh-rvguarder/client.js'));
const report = { http: page.status, authenticated: Boolean(cookie), htmlBytes: Buffer.byteLength(html), bootEntry: Boolean(resource), clientBytes: 0, registered: false };
if (resource) {
  const response = await fetch(new URL(resource.startsWith('/') ? resource : '/' + resource, origin), { headers: { cookie }, signal: AbortSignal.timeout(10000) });
  const body = await response.text(); report.clientBytes = Buffer.byteLength(body); report.registered = response.ok && body.includes('__ModuleLoader__.load') && body.includes('rvguarder.settings') && body.includes('rvguarder-settings-section');
}
if (args.output) writeFileSync(args.output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!page.ok || !cookie || !report.bootEntry || !report.registered) process.exitCode = 1;
