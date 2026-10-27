/**
 * 构建脚本：把全局 styles.css 转换为内嵌作用域样式。
 * - :root → .rvg-embed（变量局部化，不污染宿主 :root）
 * - [data-theme="dark"] → .rvg-embed[data-embed-theme="dark"]
 * - html/body 规则剔除；其余元素选择器加 .rvg-embed 前缀
 * 输出 frontend/src/embedded-styles.js（export const embeddedCss = "…")
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(root, '..', 'src', 'styles.css'), 'utf8');
const SCOPED = '.rvg-embed';

const lines = source.split('\n');
const out = [];
let skipBlock = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();
  // 跳过 html/body 基础规则块（1 个块）
  if (skipBlock > 0) {
    skipBlock += (line.match(/{/g) || []).length;
    skipBlock -= (line.match(/}/g) || []).length;
    if (skipBlock <= 0) skipBlock = 0;
    continue;
  }
  if (/^html, body\s*{/.test(trimmed)) { skipBlock = 1; continue; }
  let replaced = line;
  if (trimmed.startsWith(':root')) {
    replaced = line.replace(':root', SCOPED);
  } else if (trimmed.startsWith('[data-theme="dark"]')) {
    replaced = line.replace('[data-theme="dark"]', `${SCOPED}[data-embed-theme="dark"]`);
  } else if (/^(\*|button|input|select|textarea|a|p|h1|h2|h3|h4|table|th|td|dl|dt|dd|code|pre|label|span|div|section|article|aside|nav|main|ul|ol|li|strong|small|img|svg|input\[|button\[)/.test(trimmed) && trimmed.includes('{')) {
    // 元素/通配选择器行：加前缀（保持缩进与后续行不动）
    const indent = line.slice(0, line.length - line.trimStart().length);
    const selector = trimmed.slice(0, trimmed.indexOf('{')).trim();
    const rest = trimmed.slice(trimmed.indexOf('{'));
    const scoped = selector.split(',').map((part) => `${SCOPED} ${part.trim()}`).join(', ');
    replaced = `${indent}${scoped} ${rest}`;
  } else if (/^\.[a-zA-Z][\w-]*\s*[{,]/.test(trimmed) || /^\.rvg-/.test(trimmed)) {
    // 类选择器行：给每个选择器加前缀
    const indent = line.slice(0, line.length - line.trimStart().length);
    const selector = trimmed.slice(0, trimmed.indexOf('{') >= 0 ? trimmed.indexOf('{') : trimmed.length).trim();
    const rest = trimmed.indexOf('{') >= 0 ? trimmed.slice(trimmed.indexOf('{')) : '';
    const scoped = selector.split(',').map((part) => `${SCOPED} ${part.trim()}`).join(', ');
    replaced = `${indent}${scoped} ${rest}`;
  }
  out.push(replaced);
}

const css = out.join('\n');
writeFileSync(join(root, '..', 'src', 'embedded-styles.js'), `/** 自动生成：内嵌作用域样式（由 scripts/build-embed-styles.mjs 从 styles.css 转换）。 */\nexport const embeddedCss = ${JSON.stringify(css)};\n`, 'utf8');
console.log(`embedded styles generated: ${css.length} bytes`);
