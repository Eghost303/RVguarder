/** 本地验证 dist/webclient.js 的注册形状与 factory 导出（不依赖浏览器）。 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../dist/webclient.js', import.meta.url), 'utf8');
if (!source.includes("window.__ModuleLoader__.load({") || !source.includes("id: 'dsh-rvguarder'")) throw new Error('missing loader registration');

const start = source.indexOf('factory: function (require) {') + 'factory: function (require) {'.length;
// factory 结束于文件尾部的 "  },\n});" —— 用最后的 "return module.exports;" 后截断。
const returnIndex = source.lastIndexOf('return module.exports;');
const body = source.slice(start, returnIndex + 'return module.exports;'.length);

const stubRequire = (name) => {
  if (name === 'react') return { createElement: () => null, useEffect: () => null, useRef: () => ({ current: null }) };
  if (name === 'zod') return { z: { object: () => ({ passthrough: () => ({}) }), literal: () => ({}), string: () => ({ min: () => ({ max: () => ({}) }) }), boolean: () => ({}), enum: () => ({}), instanceof: () => ({}) } };
  throw new Error('unexpected require: ' + name);
};

const module = { exports: {} };
const factory = new Function('require', 'module', 'exports', body);
const result = factory(stubRequire, module, module.exports);
if (typeof result.apply !== 'function') throw new Error('factory result has no apply');
if (!Array.isArray(result.inject)) throw new Error('factory result inject is not an array');
console.log('client factory OK: apply=' + typeof result.apply + ', inject=' + JSON.stringify(result.inject));
