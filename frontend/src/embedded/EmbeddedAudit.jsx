import { useT } from '../i18n';
/** 内嵌审计页：近期记录、链完整性、受控导出下载。 */
import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../store';
import { useTransport } from '../transport';
import { useApi, apiErrorMessage } from '../api';
import { esc } from '../i18n';

export function EmbeddedAudit() {
  const t = useT();
  const transport = useTransport();

  const showToast = useStore((s) => s.showToast);
  const [audit, setAudit] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    transport.call('audit').then((value) => { if (alive) setAudit(value); }).catch((e) => { if (alive) setError(apiErrorMessage(e, t("无法读取审计记录"))); });
    return () => { alive = false; };
  }, []);

  const chainOk = audit?.chain?.ok;
  const items = audit?.items || [];

  const download = async (format) => {
    if (busy) return; // 防重复点击
    setBusy(true);
    try {
      const result = await transport.download('auditExport', { format });
      const blob = new Blob([result?.bytes ?? result], { type: format === 'json' ? 'application/json' : 'text/csv' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `rvguarder-audit-export.${format}`;
      anchor.rel = 'noopener';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      showToast(t("审计导出已交付下载"));
    } catch (e) {
      showToast(apiErrorMessage(e, t("审计导出失败")));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div class="card"><p role="alert">{esc(error)}</p></div>;
  if (!audit) return <div class="card"><p>{t("正在读取审计记录…")}</p></div>;

  return (
    <div class="stack-view">
      <section class="card" data-testid="embed-audit">
        <div class="card-head">
          <h3>{t("审计链完整性")}</h3>
          <span class={'badge ' + (chainOk ? 'ok' : 'warn')}>{chainOk ? t("链完整") : t("存在断链")}</span>
        </div>
        {!chainOk && (
          <p role="alert">{t("断链记录：")}{(audit.chain.broken_records || []).join('、') || t("未知")}{t("；请核对导出记录。")}</p>
        )}
        <p>
          <button class="btn" disabled={busy} onClick={() => download('json')}>{t("导出 JSON")}</button>{' '}
          <button class="btn" disabled={busy} onClick={() => download('csv')}>{t("导出 CSV")}</button>
        </p>
      </section>
      <section class="card">
        <div class="card-head"><h3>{t("近期审计记录（")}{items.length}）</h3></div>
        <div class="approval-list">
          {items.length === 0 && <div class="empty">{t("暂无审计记录。")}</div>}
          {items.slice(0, 20).map((record, index) => (
            <p key={record.record_id || index}>
              {esc(record.timestamp || '')} · {esc(record.record_type || record.event_type || t("事件"))}{t("· 哈希")}{esc(String(record.record_hash || '').slice(0, 12) || '—')}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}
