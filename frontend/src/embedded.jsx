/**
 * 内嵌入口 —— 显式 mount(container, options)/dispose()，
 * 与自动挂载的 main.jsx 完全分离；不读取 URL 令牌、不操作整页主题。
 *
 * options:
 *   transport    { call, download }    宿主认证管理通道（必需）
 *   instanceId   string                Guard 实例编号（持久化键隔离）
 *   language     'zh' | 'en'           语言（默认 zh）
 *   initialView  string                初始视图（默认 'overview'）
 */
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { createGuardStore } from './store';
import { createScopedApi } from './api';
import { GuardSession } from './session';
import { EmbeddedShell } from './embedded/EmbeddedShell';
import { embeddedCss } from './embedded-styles.js';
import embeddedLayout from './embedded-layout.css?inline';

const VIEWS = ['overview', 'actions', 'rules', 'scan', 'audit', 'settings'];

/** 注入一次性作用域样式表；返回移除函数。 */
const STYLE_ID = 'rvguarder-embedded-styles';
let styleUsers = 0;
let mountSequence = 0;
function ensureStyles() {
  styleUsers++;
  const remove = () => { if (--styleUsers === 0) document.getElementById(STYLE_ID)?.remove(); };
  if (document.getElementById(STYLE_ID)) return remove;
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = embeddedCss + embeddedLayout;
  document.head.append(tag);
  return remove;
}

/** 挂载内嵌 Guard 管理界面；返回 { dispose }。 */
export function mountEmbedded(container, options = {}) {
  if (!container || !(container instanceof HTMLElement)) throw new Error('embedded: container must be an HTMLElement');
  const transport = options.transport;
  if (!transport || typeof transport.call !== 'function' || typeof transport.download !== 'function') throw new Error('embedded: transport with call/download is required');
  const instanceId = typeof options.instanceId === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(options.instanceId) ? options.instanceId : 'embedded';
  const initialView = VIEWS.includes(options.initialView) ? options.initialView : 'overview';

  const removeStyles = ensureStyles();
  let disposed = false;
  const scopedTransport = Object.fromEntries(['call', 'download'].map(method => [method, async (...args) => {
    if (disposed) throw new DOMException('Embedded session disposed', 'AbortError');
    const value = await transport[method](...args);
    if (disposed) throw new DOMException('Embedded session disposed', 'AbortError');
    return value;
  }]));
  const store = createGuardStore();
  store.getState()._enterEmbedded(instanceId, options.language || 'zh');
  const session = { store, transport: scopedTransport, api: createScopedApi(scopedTransport, store) };
  const panelId = 'rvguarder-panel-' + (++mountSequence);

  const Root = () => {
    const [view, setView] = useState(initialView);
    return (
      <EmbeddedShell
        view={view}
        views={VIEWS}
        onNavigate={(next) => { if (VIEWS.includes(next)) setView(next); }}
        instanceId={instanceId}
        panelId={panelId}
      />
    );
  };

  render(<GuardSession.Provider value={session}><Root /></GuardSession.Provider>, container);
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      render(null, container);
      removeStyles();
      // 清空此挂载的状态与延迟任务。
      clearTimeout(store.getState()._toastTimer);
      store.getState()._exitEmbedded();
    },
    update(next = {}) {
      if (disposed) return;
      store.setState({ language: next.language === 'en' ? 'en' : 'zh', theme: next.theme === 'dark' ? 'dark' : 'light' });
    },
  };
}
