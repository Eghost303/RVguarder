import { useT } from '../i18n';
import { useEffect, useState } from 'preact/hooks';
import { ScanProgress } from '../components/ScanProgress';
import { useApi, apiErrorMessage, fetchTaskAuthorizations } from '../api';
import { esc } from '../i18n';
import { useStore, useGuardStore } from '../store';

function formatRemaining(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  return minutes > 0 ? `${minutes} 分 ${total % 60} 秒` : `${total} 秒`;
}

export function Settings() {
  const t = useT();
  const { fetchApprovalTrust, revokeApprovalTrust } = useApi();
  const store = useGuardStore();

  const [trust, setTrust] = useState([]);
  const [taskAuth, setTaskAuth] = useState(null);
  const summary = useStore((s) => s.summary);
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

  useEffect(() => {
    if (!dsh && !embedded) return;
    let cancelled = false;
    fetchTaskAuthorizations()
      .then((data) => { if (!cancelled) setTaskAuth(Array.isArray(data?.grants) ? data : { grants: [], command_approvals: [] }); })
      .catch(() => { if (!cancelled) setTaskAuth({ grants: [], command_approvals: [] }); });
    return () => { cancelled = true; };
  }, [dsh, embedded]);

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
      {summary?.actions?.approvals && (
        <article class="card trust-card">
          <div class="card-head">
            <h3>{t("审批归因")}</h3>
            <span class="badge info">{summary.actions.approvals.total || 0}</span>
          </div>
          <p class="trust-intro">{t("按支配原因统计已记录的审批与阻断；未知原因单列。")}</p>
          {Object.entries(summary.actions.approvals.by_reason || {}).length ? (
            <div class="trust-list">
              {Object.entries(summary.actions.approvals.by_reason)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([reason, count]) => (
                  <div class="trust-item" key={reason}>
                    <div>
                      <strong>{esc(reason)}</strong>
                      <p>{t("次数")}{count}</p>
                    </div>
                  </div>
                ))}
            </div>
          ) : <div class="empty">{t("暂无审批记录。")}</div>}
        </article>
      )}
      {(dsh || embedded) && (
        <article class="card trust-card">
          <div class="card-head">
            <h3>{t("任务授权")}</h3>
            <span class="badge info">{t("只读")}</span>
          </div>
          <p class="trust-intro">{t("当前任务的有效授权与已批准的命令类别；越界仍会重新审批。")}</p>
          {taskAuth === null ? (
            <div class="empty">{t("读取中…")}</div>
          ) : (
            <>
              {taskAuth.grants?.length ? (
                <div class="trust-list">
                  {taskAuth.grants.map((item) => (
                    <div class="trust-item" key={item.grant_id}>
                      <div>
                        <strong>{esc(item.task_id)}</strong>
                        <p>{t("范围")}{esc((item.operations || []).join(" / "))} · {t("剩余")}{formatRemaining(item.remaining_seconds)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div class="empty">{t("当前没有有效任务授权。")}</div>}
              {taskAuth.command_approvals?.length ? (
                <div class="trust-list">
                  {taskAuth.command_approvals.map((item) => (
                    <div class="trust-item" key={`${item.task_id}-${item.command_class}`}>
                      <div>
                        <strong>{esc(item.command_class)}</strong>
                        <p>{t("已批准类别")} · {t("剩余")}{formatRemaining(item.remaining_seconds)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </article>
      )}
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
