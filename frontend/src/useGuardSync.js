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
        if (rvMode) {
          const rv = await fetchRvStatus();
          if (!disposed) setRvStatus(rv);
        }
      } catch (error) {
        if (!disposed) showToast(apiErrorMessage(error, t('error_default')));
      }
    };
    poll();
    if (typeof EventSource !== 'undefined') {
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

