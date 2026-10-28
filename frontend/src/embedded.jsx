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
import { useEffect, useState } from 'preact/hooks';
import { setTransport, createHttpTransport } from './transport';
import { useStore } from './store';
import { fetchSummary } from './api';
import { t } from './i18n';
import { EmbeddedShell } from './embedded/EmbeddedShell';
import { embeddedCss } from './embedded-styles.js';
import embeddedLayout from './embedded-layout.css?inline';

const VIEWS = ['overview', 'actions', 'rules', 'scan', 'audit', 'settings'];

/** 注入一次性作用域样式表；返回移除函数。 */
const STYLE_ID = 'rvguarder-embedded-styles';
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return () => {};
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = embeddedCss + embeddedLayout;
  document.head.append(tag);
  return () => { tag.remove(); };
}

/** 挂载内嵌 Guard 管理界面；返回 { dispose }。 */
export function mountEmbedded(container, options = {}) {
  if (!container || !(container instanceof HTMLElement)) throw new Error('embedded: container must be an HTMLElement');
  const transport = options.transport;
  if (!transport || typeof transport.call !== 'function' || typeof transport.download !== 'function') throw new Error('embedded: transport with call/download is required');
  const instanceId = typeof options.instanceId === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(options.instanceId) ? options.instanceId : 'embedded';
  const initialView = VIEWS.includes(options.initialView) ? options.initialView : 'overview';

  const removeStyles = ensureStyles();
  setTransport(transport);
  useStore.getState()._enterEmbedded(instanceId, options.language || 'zh');

  const Root = () => {
    const [view, setView] = useState(initialView);
    useEffect(() => {
      // 初始快照；错误由 EmbeddedShell 的离线状态呈现，不用无限 spinner。
      fetchSummary({ compact: true }).catch(() => {});
    }, []);
    return (
      <EmbeddedShell
        view={view}
        views={VIEWS}
        onNavigate={(next) => { if (VIEWS.includes(next)) setView(next); }}
        instanceId={instanceId}
      />
    );
  };

  render(<Root />, container);
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      render(null, container);
      removeStyles();
      // 恢复 HTTP 传输并清空内嵌会话状态（选择、错误、缓存、订阅数据）。
      setTransport(createHttpTransport());
      useStore.getState()._exitEmbedded();
    },
  };
}
