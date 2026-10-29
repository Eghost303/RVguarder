import { useGuardSync } from '../useGuardSync';
import { Link } from 'preact-router';
import { useStore } from '../store';
import { useT } from '../i18n';
import { useApi, apiErrorMessage } from '../api';
import { Toast } from './Toast';
import { HostPanel } from './HostPanel';

/** 根据当前路径判断 nav 按钮是否 active */
function useIsActive(view, currentPath) {
  const p = currentPath || '/';
  if (view === 'dashboard') return p === '/' || p === '';
  const target = '/' + view;
  return p === target || p.startsWith(target + '/');
}

export function Layout({ children, currentPath }) {
  const t = useT();
  const { fetchSummary, rvToggle } = useApi();

  useGuardSync();
  const hostKind = useStore((s) => s.summary.host?.kind);
  const rvMode = useStore((s) => s.rvMode);
  const setRvMode = useStore((s) => s.setRvMode);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const showToast = useStore((s) => s.showToast);
  const setSummary = useStore((s) => s.setSummary);

  const handleRvToggle = async () => {
    const on = !rvMode;
    try {
      await rvToggle(on);
      setRvMode(on);
      showToast(on ? t("🔄 RV 模式已开启 — 安全执行链路实时追踪") : t("🔄 RV 模式已关闭 — 恢复标准视图"));
    } catch (error) {
      showToast(apiErrorMessage(error, t('error_default')));
    }
  };

  const handleRefresh = async () => {
    try {
      const s = await fetchSummary();
      setSummary(s);
    } catch (error) {
      showToast(apiErrorMessage(error, t('error_default')));
    }
  };

  const navItems = [
    ['dashboard', '▤', t('dashboard')],
    ['actions', '☰', t('actions')],
    ['rules', '◈', t('rules')],
    ['skills', '🔧', t('skills')],
    ['settings', '⚙', t('settings')],
  ];

  return (
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <h1>{t('appName')}</h1>
          <p>{hostKind === 'dsh' ? t("DSH Agent 安全插件") : t('appSub')}</p>
        </div>
        <nav class="nav">
          {navItems.filter(([view]) => hostKind !== 'dsh' || view !== 'skills').map(([view, icon, label]) => (
            <Link
              key={view}
              class={'nav-btn' + (useIsActive(view, currentPath) ? ' active' : '')}
              href={view === 'dashboard' ? '/' : '/' + view}
              aria-current={useIsActive(view, currentPath) ? 'page' : undefined}
            >
              <span class="nav-icon">{icon}</span>
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main class="main">
        <div class="topbar">
          <button
            class="topbar-btn theme-btn"
            id="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? t("切换亮色主题") : t("切换暗色主题")}
          >
            {theme === 'dark' ? t("☀️ 亮色") : t("🌙 暗色")}
          </button>
          <div class="rv-toggle">
            <span>{t('rvMode')}</span>
            <button id="rv-toggle" class={'rv-btn ' + (rvMode ? 'on' : 'off')} onClick={handleRvToggle}>
              {rvMode ? t('rvModeOn') : t('rvModeOff')}
            </button>
          </div>
          <button class="topbar-btn primary" id="refresh-btn" onClick={handleRefresh}>
            {t('refresh')}
          </button>
        </div>
        <div class="content"><HostPanel />{children}</div>
      </main>
      <Toast />
    </div>
  );
}
