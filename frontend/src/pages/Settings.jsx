import { useT } from '../i18n';
import { useEffect, useState } from 'preact/hooks';
import { ScanProgress } from '../components/ScanProgress';
import { useApi, apiErrorMessage } from '../api';
import { esc } from '../i18n';
import { useStore, useGuardStore } from '../store';

export function Settings() {
  const t = useT();
  const { fetchApprovalTrust, revokeApprovalTrust } = useApi();
  const store = useGuardStore();

  const [trust, setTrust] = useState([]);
  const dsh = useStore((s) => s.summary.host?.kind === 'dsh');
  const embedded = useStore((s) => s.embedded);
  const showToast = useStore((s) => s.showToast);

  const loadTrust = async () => {
    try {
      const result = await fetchApprovalTrust();
      setTrust(Array.isArray(result.items) ? result.items : []);
    } catch (error) {
      showToast(apiErrorMessage(error, t("无法读取精确授权记录")));
    }
  };

  useEffect(() => { if (!dsh && !embedded) loadTrust(); }, [dsh, embedded]);

  const handleRevoke = async (fingerprint) => {
    try {
      await revokeApprovalTrust(fingerprint);
      setTrust((items) => items.filter((item) => item.fingerprint !== fingerprint));
      showToast(t("已撤销精确授权"));
    } catch (error) {
      showToast(apiErrorMessage(error, t("撤销授权失败")));
    }
  };

  return (
    <div class="settings-grid">
      <ScanProgress />
      {embedded ? (
        <article class="card trust-card">
          <div class="card-head">
            <h3>{t("精确命令授权")}</h3>
            <span class="badge info">{t("原生一次性审批")}</span>
          </div>
          <p class="trust-intro">{t("DSH 仅使用原生一次性审批，不复用 OpenClaw 的持久授权；本视图不提供授权管理。")}</p>
        </article>
      ) : (
      <article class="card trust-card">
        <div class="card-head">
          <h3>{t("精确命令授权")}</h3>
          <span class="badge info">{dsh ? t("原生一次性审批") : t("默认 30 天")}</span>
        </div>
        <p class="trust-intro">{store.getState().summary.host?.kind === 'dsh' ? t("DSH 仅使用原生一次性审批，不复用 OpenClaw 的持久授权。") : t("OpenClaw 中选择“始终允许”后，Guard 只会复用完全相同的工具、参数、工作目录和 agent/principal。")}</p>
        {trust.length ? (
          <div class="trust-list">
            {trust.map((item) => (
              <div class="trust-item" key={item.fingerprint}>
                <div>
                  <strong>{esc(item.scope || t("精确命令"))}</strong>
                  <p>{t("有效至")}{esc((item.expires_at || '').slice(0, 19).replace('T', ' '))}</p>
                </div>
                <button class="btn danger" type="button" onClick={() => handleRevoke(item.fingerprint)}>{t("撤销")}</button>
              </div>
            ))}
          </div>
        ) : (
          <div class="empty">{t("当前没有持久授权。")}</div>
        )}
      </article>
      )}
    </div>
  );
}
