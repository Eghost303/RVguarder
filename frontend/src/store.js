import { create } from 'zustand';
import { useGuardSession } from './session';

/** 内嵌模式持久化前缀：与独立工作台键完全隔离，按实例编号区分。 */
const EMBED_PREFIX = 'rvguarder-embed';

const _initialTheme = () => {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('openclaw-guard-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  }
  return 'light';
};

/** 当前模式下的持久化键；内嵌模式按实例隔离。 */
export function createGuardStore() {
let embeddedScope = null;
const _key = (base) => (embeddedScope ? `${EMBED_PREFIX}-${embeddedScope}-${base}` : `openclaw-guard-${base}`);
return create((set, get) => ({
  // ── Summary data ──
  summary: {},
  loading: true,
  _summaryHash: '',
  _actionRevision: 0,

  // ── Theme ──
  theme: _initialTheme(),

  // ── View state (replaces state.view — now handled by preact-router) ──
  actionFilter: 'pending_approval',
  pages: { actions: 1 },
  pageSize: 8,

  // ── Toast ──
  toast: null,

  // ── Scan ──
  scan: {
    running: false,
    progress: 0,
    phase: '',
    result: null,
    selected: 'config',
  },

  // ── Search ──
  rulesSearch: '',

  // ── RV ──
  rvMode: (typeof localStorage !== 'undefined'
    ? localStorage.getItem('openclaw-guard-rv-mode') || 'on'
    : 'on') === 'on',
  rvStatus: null,

  // ── Embedded session ──
  embedded: false,
  language: 'zh',
  backendOnline: true,
  backendError: '',
  backendErrorCode: '',
  backendStatus: null,
  setBackendError: (backendError) => set({ backendError }),

  // ── Setters ──

  setSummary: (summary) =>
    set((s) => {
      const h = summary?.actions
        ? JSON.stringify({
            actions: summary.actions,
            sync: summary.sync || {},
            host: summary.host, semantic: summary.semantic, hook: summary.hook, capabilities: summary.capabilities,
            skills: summary.skills || {},
            channels: summary.channels || {},
            preferences: summary.preferences || {},
          })
        : '0';
      return h !== s._summaryHash || s.loading
        ? { summary: { ...s.summary, ...summary }, loading: false, _summaryHash: h }
        : {};
    }),

  upsertAction: (action) => set((s) => {
    const current = s.summary.actions || {};
    const items = [...(current.items || [])];
    const index = items.findIndex((item) => item.action_id === action.action_id);
    if (index >= 0) items[index] = { ...items[index], ...action };
    else items.unshift(action);
    return { _actionRevision: s._actionRevision + 1, loading: false, summary: { ...s.summary, actions: { ...current, items } } };
  }),

  setLoading: (loading) => set({ loading }),

  setActionFilter: (f) => set({ actionFilter: f, pages: { ...get().pages, actions: 1 } }),

  setPage: (pk, n) =>
    set((s) => {
      const cur = (s.pages[pk] || 1) + n;
      return { pages: { ...s.pages, [pk]: Math.max(1, cur) } };
    }),

  setScan: (scan) => set({ scan: { ...get().scan, ...scan } }),

  setRulesSearch: (q) => set({ rulesSearch: q }),

  setRvMode: (on) => {
    const v = !!on;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(_key('rv-mode'), v ? 'on' : 'off');
    }
    set({ rvMode: v });
  },

  setTheme: (t) => {
    const v = t === 'dark' ? 'dark' : 'light';
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(_key('theme'), v);
    }
    if (typeof document !== 'undefined' && !get().embedded) {
      // 内嵌模式不改写整页 data-theme；主题跟随宿主。
      document.documentElement.setAttribute('data-theme', v);
    }
    set({ theme: v });
  },

  toggleTheme: () => set((s) => {
    const v = s.theme === 'dark' ? 'light' : 'dark';
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(_key('theme'), v);
    }
    if (typeof document !== 'undefined' && !s.embedded) {
      document.documentElement.setAttribute('data-theme', v);
    }
    return { theme: v };
  }),

  // ── Embedded lifecycle ──

  /** 进入内嵌会话：按实例隔离持久化，重置所有视图状态。 */
  _enterEmbedded: (instanceId, language) => {
    embeddedScope = `${instanceId}`;
    const storedRv = typeof localStorage !== 'undefined' ? localStorage.getItem(_key('rv-mode')) : null;
    set({
      embedded: true,
      backendOnline: true,
      backendError: '',
      language: language === 'en' ? 'en' : 'zh',
      summary: { host: { kind: 'dsh', instance_id: instanceId } },
      loading: true,
      _summaryHash: '',
      _actionRevision: 0,
      actionFilter: 'pending_approval',
      pages: { actions: 1 },
      scan: { running: false, progress: 0, phase: '', result: null, selected: 'config' },
      rulesSearch: '',
      rvMode: (storedRv ?? 'on') === 'on',
      rvStatus: null,
      toast: null,
    });
  },

  /** 退出内嵌会话：清空内存状态并恢复独立工作台键。 */
  _exitEmbedded: () => {
    embeddedScope = null;
    set({
      embedded: false,
      backendOnline: true,
      backendError: '',
      summary: {},
      loading: true,
      _summaryHash: '',
      _actionRevision: 0,
      actionFilter: 'pending_approval',
      pages: { actions: 1 },
      scan: { running: false, progress: 0, phase: '', result: null, selected: 'config' },
      rulesSearch: '',
      rvStatus: null,
      toast: null,
    });
  },

  setRvStatus: (rvStatus) => set({ rvStatus }),

  setBackendOnline: (online) => set({ backendOnline: online === true }),

  showToast: (msg) => {
    set({ toast: msg });
    clearTimeout(get()._toastTimer);
    const timer = setTimeout(() => set({ toast: null }), 3000);
    set({ _toastTimer: timer });
  },

  // ── Optimistic action updates ──

  optimisticUpdate: (id, status) =>
    set((s) => {
      const a = s.summary.actions || {};
      const items = (a.items || []).map((i) =>
        i.action_id === id ? { ...i, status } : i,
      );
      return { summary: { ...s.summary, actions: { ...a, items } } };
    }),

  setActionLoading: (id, loading) =>
    set((s) => {
      const a = s.summary.actions || {};
      const items = (a.items || []).map((i) =>
        i.action_id === id ? { ...i, _loading: loading } : i,
      );
      return { summary: { ...s.summary, actions: { ...a, items } } };
    }),
}));
}

const defaultStore = createGuardStore();
/** 组件通过上下文取得其所属挂载的 store。 */
export function useGuardStore() { return useGuardSession()?.store ?? defaultStore; }
export function useStore(selector) { return useGuardStore()(selector); }
useStore.getState = defaultStore.getState;
