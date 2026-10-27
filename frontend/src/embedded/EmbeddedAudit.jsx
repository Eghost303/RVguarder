/** 内嵌审计页：近期记录、链完整性、受控导出下载。 */
import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../store';
import { getTransport } from '../transport';
import { apiErrorMessage } from '../api';
import { esc } from '../i18n';

export function EmbeddedAudit() {
  const showToast = useStore((s) => s.showToast);
  const [audit, setAudit] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getTransport().call('audit').then((value) => { if (alive) setAudit(value); }).catch((e) => { if (alive) setError(apiErrorMessage(e, '无法读取审计记录')); });
    return () => { alive = false; };
  }, []);

  const chainOk = audit?.chain?.ok;
  const items = audit?.items || [];

  const download = async (format) => {
    if (busy) return; // 防重复点击
    setBusy(true);
    try {
      const buffer = await getTransport().download('auditExport', { format });
      const blob = new Blob([buffer], { type: format === 'json' ? 'application/json' : 'text/csv' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `rvguarder-audit-export.${format}`;
      anchor.rel = 'noopener';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      showToast('审计导出已交付下载');
    } catch (e) {
      showToast(apiErrorMessage(e, '审计导出失败'));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div class="card"><p role="alert">{esc(error)}</p></div>;
  if (!audit) return <div class="card"><p>正在读取审计记录…</p></div>;

  return (
    <div class="stack-view">
      <section class="card" data-testid="embed-audit">
        <div class="card-head">
          <h3>审计链完整性</h3>
          <span class={'badge ' + (chainOk ? 'ok' : 'warn')}>{chainOk ? '链完整' : '存在断链'}</span>
        </div>
        {!chainOk && (
          <p role="alert">断链记录：{(audit.chain.broken_records || []).join('、') || '未知'}；请核对导出记录。</p>
        )}
        <p>
          <button class="btn" disabled={busy} onClick={() => download('json')}>导出 JSON</button>{' '}
          <button class="btn" disabled={busy} onClick={() => download('csv')}>导出 CSV</button>
        </p>
      </section>
      <section class="card">
        <div class="card-head"><h3>近期审计记录（{items.length}）</h3></div>
        <div class="approval-list">
          {items.length === 0 && <div class="empty">暂无审计记录。</div>}
          {items.slice(0, 20).map((record, index) => (
            <p key={record.record_id || index}>
              {esc(record.timestamp || '')} · {esc(record.record_type || record.event_type || '事件')} · 哈希 {esc(String(record.record_hash || '').slice(0, 12) || '—')}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}
