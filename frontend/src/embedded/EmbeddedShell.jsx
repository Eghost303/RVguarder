/** 内嵌外壳：局部页签导航、离线状态、宿主主题适配；不渲染整页侧栏。 */
import { useEffect } from 'preact/hooks';
import { useStore } from '../store';
import { t } from '../i18n';
import { useGuardSync } from '../useGuardSync';
import { Dashboard } from '../pages/Dashboard';
import { Actions } from '../pages/Actions';
import { Rules } from '../pages/Rules';
import { Settings } from '../pages/Settings';
import { HostPanel } from '../components/HostPanel';
import { EmbeddedAudit } from './EmbeddedAudit';

const VIEW_LABELS = {
  overview: '概览',
  actions: '调用与审批',
  rules: '规则与 RV',
  scan: '扫描与报告',
  audit: '审计',
  settings: '设置',
};

const VIEW_ICONS = {
  overview: '▤', actions: '☰', rules: '◈', scan: '🛡', audit: '⛓', settings: '⚙',
};

export function EmbeddedShell({ view, views, onNavigate, instanceId }) {
  useGuardSync();
  const summary = useStore((s) => s.summary);
  const hookActive = !!summary.hook?.active;
  const backendOnline = useStore((s) => s.backendOnline !== false);

  // 连接断开后的重新连接入口：手动触发一次快照。
  const refresh = () => { useStore.getState().setLoading(true); import('../api').then(({ fetchSummary }) => fetchSummary({ compact: true })).catch(() => {}); };

  return (
    <div class="rvg-embed" data-instance={instanceId} data-view={view}>
      <div class="rvg-embed-tabs" role="tablist" aria-label="RVguarder 管理视图">
        {views.map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={view === name}
            class={'rvg-embed-tab' + (view === name ? ' active' : '')}
            onClick={() => onNavigate(name)}
          >
            <span aria-hidden="true">{VIEW_ICONS[name]}</span>
            {VIEW_LABELS[name] || name}
          </button>
        ))}
      </div>
      {!backendOnline && (
        <div class="rvg-embed-offline" role="status">
          <p>Guard 后端未连接。插件安装与守卫状态不受影响；启动后端后重新连接。</p>
          <button class="rvg-embed-btn" onClick={refresh}>重新连接</button>
        </div>
      )}
      <div class="rvg-embed-body" role="tabpanel">
        {view === 'overview' && (
          <div class="stack-view">
            {/* HostPanel 提供实例/语义/审计概览；独立工作台中由 Layout 承载。 */}
            <HostPanel />
            <Dashboard />
          </div>
        )}
        {view === 'actions' && <Actions />}
        {view === 'rules' && <Rules />}
        {view === 'scan' && <Settings />}
        {view === 'audit' && <EmbeddedAudit />}
        {view === 'settings' && <EmbeddedSettingsPanel />}
      </div>
    </div>
  );
}

/** 内嵌设置页：语义模式 + 只读连接信息；不复用含 OpenClaw 配置的整页 Settings。 */
function EmbeddedSettingsPanel() {
  const summary = useStore((s) => s.summary);
  const semantic = summary.semantic || {};
  const host = summary.host || {};
  return (
    <div class="stack-view">
      <section class="card" data-testid="embed-connection">
        <div class="card-head"><h3>连接信息（只读）</h3></div>
        <p>实例：{host.instance_id || '—'} · Profile：{host.profile || '—'}</p>
        <p>协议：dsh-guard-v2 · 语义模式：{semantic.configured_mode || '—'}</p>
        <p>后端由用户单独启动；本页面不自动托管进程。启动说明见项目部署文档。</p>
      </section>
    </div>
  );
}
