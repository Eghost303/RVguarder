/**
 * 构建浏览器客户端包：client/index.ts + 内嵌 Guard 模块 → dist/client.js
 * 输出 window.__ModuleLoader__.load({id: 'dsh-rvguarder', factory}) 注册格式。
 *
 * externals（平台 seed / 宿主共享运行时）：react、zod、@deepseek-ai/cordis。
 * 其余（preact 内嵌模块、remote-info）全部打入，避免宿主内路径问题。
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(root, '..');
const embeddedPath = resolve(pluginRoot, '..', 'runtime', 'embedded', 'rvguarder-embedded.mjs');
const remoteInfoPath = resolve(pluginRoot, 'node_modules', '@deepseek-ai', 'dsh-typert-protocol', 'lib', 'types', 'remote-info.js');

/** 把 client/index.ts 对内嵌模块的相对导入重定向到 frontend 构建产物。 */
const embeddedResolver = {
  name: 'rvguarder-embedded',
  setup(build) {
    build.onResolve({ filter: /^rvguarder:embedded$/ }, () => ({ path: embeddedPath }));
  },
};

const result = await build({
  entryPoints: [join(pluginRoot, 'client', 'index.ts')],
  bundle: true,
  format: 'cjs',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  outfile: join(pluginRoot, 'dist', 'webclient.cjs'),
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'zod', '@deepseek-ai/cordis'],
  plugins: [{
    name: 'rvguarder-client-resolves',
    setup(build) {
      build.onResolve({ filter: /embedded\/rvguarder-embedded\.mjs$/ }, () => ({ path: embeddedPath }));
      // remote-info 无运行时依赖，直接打入客户端，避免要求宿主 seed。
      build.onResolve({ filter: /^@deepseek-ai\/dsh-typert-protocol\/remote-info$/ }, () => ({ path: remoteInfoPath }));
    },
  }],
  define: { 'process.env.NODE_ENV': '"production"' },
  write: false,
  logLevel: 'warning',
});

const cjs = result.outputFiles[0].text;
const finalClient = `/* dsh-rvguarder 浏览器客户端（构建产物，勿手改；npm run build:client 生成） */
window.__ModuleLoader__.load({
  id: 'dsh-rvguarder',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
${cjs.replace(/;\s*$/, '')}
    return module.exports;
  },
});
`;
mkdirSync(join(pluginRoot, 'dist'), { recursive: true });
writeFileSync(join(pluginRoot, 'dist', 'webclient.js'), finalClient, 'utf8');
console.log('client bundle written: dist/webclient.js (' + finalClient.length + ' bytes)');
