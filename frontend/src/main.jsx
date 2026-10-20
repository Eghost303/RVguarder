import { render } from 'preact';
import { App } from './App';
import { useStore } from './store';

// 首屏前注入主题，避免闪烁（在 React 渲染前同步设置 data-theme）
document.documentElement.setAttribute('data-theme', useStore.getState().theme);

async function start() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('guard-token');
  if (token) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    const response = await fetch('/api/dsh/session', { method: 'POST', headers: { 'x-rvguarder-token': token } });
    if (!response.ok) {
      document.getElementById('app').textContent = 'DSH 工作台认证失败，请重新打开有效的本机登录链接。';
      return;
    }
  }
  const initial = await fetch('/api/summary?view=compact', { cache: 'no-store' });
  if (initial.status === 401) {
    document.getElementById('app').textContent = '工作台需要认证，请使用本机服务的有效登录链接。';
    return;
  }
  if (initial.ok) useStore.getState().setSummary(await initial.json());
  render(<App />, document.getElementById('app'));
}
start().catch(() => { document.getElementById('app').textContent = '无法连接 RVguarder 服务。'; });
