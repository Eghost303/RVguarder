/** 在模拟 __ModuleLoader__ 环境中执行 dist/webclient.js 的 factory，捕获真实错误。 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const source = readFileSync(new URL('../dist/webclient.js', import.meta.url), 'utf8');
const start = source.indexOf('factory: function (require) {') + 'factory: function (require) {'.length;
const returnIndex = source.lastIndexOf('return module.exports;');
const body = source.slice(start, returnIndex + 'return module.exports;'.length);

// React seed：React 18 的 CJS 命名导出。
const react = await import('react');
const reactModule = { ...react, __esModule: true };
// zod seed：ESM 命名导出。
const zod = await import('zod');
const zodModule = { ...zod, __esModule: true };

const errors = [];
const ctx = {
  effect: (fn) => { const dispose = fn(); return () => { try { dispose && dispose(); } catch (e) { errors.push('dispose: ' + e.message); } }; },
  locale: {
    register: () => () => {},
    bind: () => (key) => key,
    getSnapshot: () => ({ language: 'zh' }),
    resolveText: (t) => String(t),
  },
  slots: {
    inject: (slot, register) => { try { const dispose = register(); return () => { dispose && dispose(); }; } catch (e) { errors.push('slots.inject(' + slot + '): ' + e.message); return () => {}; }; },
    register: () => () => {},
  },
  remote: {
    $mount: async (contribution) => {
      if (!contribution || typeof contribution !== 'object') throw new Error('$mount: contribution is not an object');
      if (typeof contribution.package !== 'string') throw new Error('$mount: contribution.package missing');
      if (!Array.isArray(await Promise.resolve(contribution.descriptors))) throw new Error('$mount: contribution.descriptors missing');
      return async () => {};
    },
    $on: () => () => {},
  },
  get: (key) => {
    if (key === 'remote.rvguarderAdmin') return undefined;
    return undefined;
  },
};

const plugin = {
  apply: (innerCtx) => {
    console.log('apply(ctx) called');
    return undefined;
  },
  inject: ['slots', 'remote'],
};

const fakeModule = { exports: {} };
const factory = new Function('require', 'module', 'exports', body);
try {
  const exports = factory((name) => {
    if (name === 'react') return reactModule;
    if (name === 'zod') return zodModule;
    throw new Error('unexpected require: ' + name);
  }, fakeModule, fakeModule.exports);
  console.log('exports keys:', Object.keys(exports));
  console.log('apply type:', typeof exports.apply);
  // 调用 apply 捕获真实错误
  const result = exports.apply(ctx);
  console.log('apply returned:', typeof result);
} catch (error) {
  console.error('FACTORY/APPLY ERROR:', error && error.stack || error);
  process.exit(1);
}
if (errors.length) { console.error('collected errors:', errors); process.exit(1); }
console.log('OK');
