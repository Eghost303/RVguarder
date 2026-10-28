import { useApi, apiErrorMessage } from '../api';
/** 内嵌外壳：局部页签导航、离线状态、宿主主题适配；不渲染整页侧栏。 */
import { useEffect } from 'preact/hooks';
import { useStore, useGuardStore } from '../store';
import { useT } from '../i18n';
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

export function EmbeddedShell({ view, views, onNavigate, instanceId, panelId }) {
  const t = useT();
  const { fetchSummary } = useApi();
  const store = useGuardStore();

  useGuardSync();
  const summary = useStore((s) => s.summary);
  const hookActive = !!summary.hook?.active;
  const backendOnline = useStore((s) => s.backendOnline !== false);
  const backendError = useStore((s) => s.backendError);
  const errorCode = useStore(s => s.backendErrorCode);
  const backendStatus = useStore(s => s.backendStatus);
  const theme = useStore(s => s.theme);
  const onTabKey = event => {
    const index = views.indexOf(view);
    const next = event.key === 'ArrowRight' ? (index + 1) % views.length : event.key === 'ArrowLeft' ? (index + views.length - 1) % views.length : event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); onNavigate(views[next]);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
  };

  // 连接断开后的重新连接入口：手动触发一次快照。
  const refresh = async () => {
    const state = store.getState(); state.setLoading(true);
    try { const snapshot = await fetchSummary({ compact: true }); state.setSummary(snapshot); state.setBackendOnline(true); state.setBackendError(''); store.setState({ backendErrorCode: '' }); }
    catch (error) { state.setBackendOnline(false); state.setBackendError(error.message || t("管理通道不可用")); store.setState({ backendErrorCode: error.code || 'request-failed' }); }
    finally { state.setLoading(false); }
  };

  return (
    <div class="rvg-embed" data-instance={instanceId} data-view={view} data-embed-theme={theme} data-error-code={errorCode} data-deployment-state={backendStatus?.deployment?.state || ''}>
      <div class="rvg-embed-tabs" role="tablist" aria-label={t("RVguarder 管理视图")}>
        {views.map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={view === name}
            aria-controls={panelId}
            tabIndex={view === name ? 0 : -1}
            onKeyDown={onTabKey}
            class={'rvg-embed-tab' + (view === name ? ' active' : '')}
            onClick={() => onNavigate(name)}
          >
            <span aria-hidden="true">{VIEW_ICONS[name]}</span>
            {t(VIEW_LABELS[name] || name)}
          </button>
        ))}
      </div>
      {!backendOnline && (
        <div class="rvg-embed-offline" role="status">
          <p>{t(backendError || "Guard 后端未连接，请检查插件状态后重新连接。")}{errorCode ? ` (${errorCode})` : ''}</p>
          <button class="rvg-embed-btn" onClick={refresh}>{t("重新连接")}</button>
        </div>
      )}
      <div class="rvg-embed-body" role="tabpanel" id={panelId}>
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
  const t = useT();
  const { fetchSummary } = useApi();
  const store = useGuardStore();

  const summary = useStore((s) => s.summary);
  const semantic = summary.semantic || {};
  const host = summary.host || {};
  return (
    <div class="stack-view">
      <section class="card" data-testid="embed-connection">
        <div class="card-head"><h3>{t("连接信息（只读）")}</h3></div>
        <p>{t("实例：")}{host.instance_id || '—'} · Profile：{host.profile || '—'}</p>
        <p>{t("协议：dsh-guard-v2 · 语义模式：")}{semantic.configured_mode || '—'}</p>
        <p>{t("平台整包随插件启停托管后端；外部服务模式需要单独启动。部署与诊断见插件说明。")}</p>
      </section>
    </div>
  );
}
