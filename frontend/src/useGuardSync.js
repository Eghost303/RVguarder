import { useEffect } from 'preact/hooks';
import { useStore } from './store';
import { fetchSummary, fetchRvStatus, fetchAction, apiErrorMessage } from './api';
import { t } from './i18n';

/* ── Polling hook ── */
export function useGuardSync() {
  const setSummary = useStore((s) => s.setSummary);
  const setRvStatus = useStore((s) => s.setRvStatus);
  const upsertAction = useStore((s) => s.upsertAction);
  const showToast = useStore((s) => s.showToast);
  const setBackendOnline = useStore((s) => s.setBackendOnline);
  const rvMode = useStore((s) => s.rvMode);

  useEffect(() => {
    let timer;
    let source;
    let disposed = false;
    const poll = async () => {
      try {
        const revision = useStore.getState()._actionRevision;
        const s = await fetchSummary({ compact: true });
        if (!disposed && revision === useStore.getState()._actionRevision) setSummary(s);
        if (!disposed) setBackendOnline(true);
        if (rvMode) {
          const rv = await fetchRvStatus();
          if (!disposed) setRvStatus(rv);
        }
      } catch (error) {
        if (!disposed) {
          setBackendOnline(false);
          // 内嵌模式离线横幅负责呈现；独立工作台保留 toast。
          if (!useStore.getState().embedded) showToast(apiErrorMessage(error, t('error_default')));
        }
      }
    };
    poll();
    // 内嵌模式走宿主认证通道，浏览器 EventSource 不可用；使用有界轮询。
    if (!useStore.getState().embedded && typeof EventSource !== 'undefined') {
      source = new EventSource('/api/events');
      const handleEvent = async (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.action_id) { const action = await fetchAction(payload.action_id); if (!disposed) upsertAction(action); }
        } catch (_) { /* 回退轮询负责最终对账 */ }
      };
      ['action.created', 'action.resolved', 'action.updated', 'action.timeout', 'action.conflict'].forEach((name) => {
        source.addEventListener(name, handleEvent);
      });
      source.onopen = () => { poll(); };
      source.onerror = () => { /* EventSource 自动重连后通过快照补偿 */ };
    }
    timer = setInterval(poll, 10000);
    return () => {
      disposed = true;
      clearInterval(timer);
      if (source) source.close();
    };
  }, [rvMode]);
}
