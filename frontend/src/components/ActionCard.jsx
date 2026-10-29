import { useStore } from '../store';
import { esc, useT } from '../i18n';
import { useApi, apiErrorMessage } from '../api';

export function ActionCard({ item }) {
  const t = useT();
  const { approveAction, rejectAction, fetchSummary } = useApi();

  const optimisticUpdate = useStore((s) => s.optimisticUpdate);
  const setActionLoading = useStore((s) => s.setActionLoading);
  const showToast = useStore((s) => s.showToast);
  const setSummary = useStore((s) => s.setSummary);
  const rvMode = useStore((s) => s.rvMode);

  const d = item.decision || {};
  const userMessage = d.user_message || item.user_message || d.reason || '';
  const presentation = item.event?.metadata?.approval_presentation || {};
  const approvalDetails = presentation.details || {};
  const riskSummary = presentation.risk_summary || {};
  const trust = presentation.allow_always || {};
  const ip = item.status === 'pending_approval';
  const canApprove = item.source !== 'hook_bridge' && !item.event?.metadata?.hook_bridge;
  const il = item._loading;

  const handleApprove = async () => {
    setActionLoading(item.action_id, true);
    try {
      await approveAction(item.action_id);
      optimisticUpdate(item.action_id, 'approved');
      showToast(t("✅ 已批准"));
      const s = await fetchSummary();
      setSummary(s);
    } catch (error) {
      setActionLoading(item.action_id, false);
      showToast(apiErrorMessage(error, t('error_default')));
      const s = await fetchSummary();
      setSummary(s);
    }
  };

  const handleReject = async () => {
    setActionLoading(item.action_id, true);
    try {
      await rejectAction(item.action_id);
      optimisticUpdate(item.action_id, 'rejected');
      showToast(t("🚫 已拒绝"));
      const s = await fetchSummary();
      setSummary(s);
    } catch (error) {
      setActionLoading(item.action_id, false);
      showToast(apiErrorMessage(error, t('error_default')));
      const s = await fetchSummary();
      setSummary(s);
    }
  };

  const handleCopy = async () => {
    const command = presentation.command_preview || '';
    if (!command || typeof navigator === 'undefined' || !navigator.clipboard) {
      showToast(t("当前环境不支持复制"));
      return;
    }
    try {
      await navigator.clipboard.writeText(command);
      showToast(t("已复制脱敏命令"));
    } catch (_error) {
      showToast(t("复制失败，请手动选择文本"));
    }
  };

  const rvResult = item.event?.metadata?.rv_result;
  const decisionRecord = item.event?.metadata?.decision_record || null;
  const decisionInfo = decisionRecord?.decision || {};
  const evidenceInfo = decisionRecord?.evidence || {};
  const policyInfo = decisionRecord?.policy || {};
  const resourcesInfo = decisionRecord?.resources || {};
  const executionUnknown = item.execution_state === 'unknown';
  const dshMeta = item.event?.metadata?.dsh || {};
  const innerCall = Boolean(dshMeta.parent_call_id);
  const statusKey = executionUnknown ? 'unknown_result' : (item.status || 'unknown');

  return (
    <article class={'approval-card tone-' + esc(d.risk_level || 'safe') + (il ? ' card-loading' : '')}>
      <div class="approval-head">
        <span class="risk-chip">{esc(d.risk_level || 'safe')}</span>
        <span class="status-chip">{t('status_' + statusKey)}</span>
        {innerCall && <span class="chip chip-muted">{t("内层调用")}</span>}
      </div>
      <h4>{esc(presentation.intent_summary || d.user_title || (item.source === 'hook_bridge' ? t("OpenClaw 工具请求") : item.target_summary || item.source_message || ''))}</h4>
      <p class="approval-intent">{esc(userMessage)}</p>
      {(presentation.target_summary || riskSummary.level) && (
        <div class="approval-summary-grid">
          {presentation.target_summary && (
            <div><span class="approval-label">{t("目标")}</span><strong>{esc(presentation.target_summary)}</strong></div>
          )}
          {riskSummary.level && (
            <div><span class="approval-label">{t("风险")}</span><strong>{esc(riskSummary.level)}</strong></div>
          )}
        </div>
      )}
      {item.source === 'hook_bridge' && (
        <div class="sync-hint">{item.event?.metadata?.host === 'dsh' ? t("请在 DSH 原生审批处理") : t("请在 OpenClaw 审批中心处理")}{t("· 同步状态：")}{esc(item.sync_state || 'local_only')}</div>
      )}
      {rvMode && rvResult?.verdict && (
        <div class={'rv-badge ' + esc(rvResult.verdict)}>
          RV: {esc(rvResult.verdict.toUpperCase())}
        </div>
      )}
      {ip && canApprove && (
        <div class="approval-actions">
          <button
            class="btn primary approve-action"
            data-id={esc(item.action_id)}
            disabled={il}
            onClick={handleApprove}
          >
            {il ? t('approving') : t('approve')}
          </button>
          <button
            class="btn danger reject-action"
            data-id={esc(item.action_id)}
            disabled={il}
            onClick={handleReject}
          >
            {il ? t('rejecting') : t('reject')}
          </button>
        </div>
      )}
      <details class="approval-details">
        <summary>{t('details')}</summary>
        <div class="approval-detail-stack">
          {presentation.command_preview && (
            <section class="approval-section">
              <div class="approval-section-head">
                <h5>{t("命令与参数")}</h5>
                <button class="btn-text" type="button" onClick={handleCopy}>{t("复制脱敏命令")}</button>
              </div>
              <pre>{esc(presentation.command_preview)}</pre>
              {approvalDetails.working_directory && (
                <p class="approval-meta">{t("工作目录：")}{esc(approvalDetails.working_directory)}</p>
              )}
              {approvalDetails.tool_name && (
                <p class="approval-meta">{t("工具：")}{esc(approvalDetails.tool_name)}</p>
              )}
              {approvalDetails.params && Object.keys(approvalDetails.params).length > 0 && (
                <details class="params-details">
                  <summary>{t("查看脱敏参数")}</summary>
                  <pre>{esc(JSON.stringify(approvalDetails.params, null, 2))}</pre>
                </details>
              )}
            </section>
          )}
          {(approvalDetails.rule_ids || item.matched_rules || []).length > 0 && (
            <section class="approval-section">
              <h5>{t("规则与权限依据")}</h5>
              <div class="approval-tags">
                {(approvalDetails.rule_ids || item.matched_rules || []).slice(0, 8).map((rule) => (
                  <span class="chip chip-muted" key={rule}>{esc(rule)}</span>
                ))}
              </div>
              {riskSummary.reason && <p class="approval-meta">{esc(riskSummary.reason)}</p>}
            </section>
          )}
          {trust.eligible && trust.scope && (
            <section class="approval-section trust-section">
              <h5>{t("精确授权范围")}</h5>
              <p class="approval-meta">{esc(trust.scope)}{t("· 默认有效")}{esc(trust.ttl_days || 30)}{t("天")}</p>
            </section>
          )}
          {decisionRecord && (
            <section class="approval-section">
              <h5>{t("决策依据")}</h5>
              <div class="approval-tags">
                {decisionInfo.deciding_layer && (
                  <span class="chip chip-muted">{t("决定层：")}{esc(decisionInfo.deciding_layer)}</span>
                )}
                {decisionInfo.dominant_reason && (
                  <span class="chip chip-muted">{t("原因：")}{esc(decisionInfo.dominant_reason)}</span>
                )}
                {(decisionInfo.reason_codes || [])
                  .filter((code) => code !== decisionInfo.dominant_reason)
                  .map((code) => <span class="chip chip-muted" key={code}>{esc(code)}</span>)}
                {(policyInfo.selected_rule_ids || []).slice(0, 6).map((rule) => (
                  <span class="chip chip-muted" key={rule}>{esc(rule)}</span>
                ))}
              </div>
              {executionUnknown && (
                <p class="approval-meta">{t("执行结果未知：派发已发生但没有可信完成证据，既不计成功也不计失败。")}</p>
              )}
              {innerCall && <p class="approval-meta">{t("父调用：")}{esc(dshMeta.parent_call_id)}</p>}
              {(evidenceInfo.missing_features || []).length > 0 && (
                <p class="approval-meta">{t("缺失证据：")}{esc(evidenceInfo.missing_features.join(", "))}</p>
              )}
              {(resourcesInfo.items || []).length > 0 && (
                <p class="approval-meta">
                  {t("资源：")}{esc(resourcesInfo.items.map((r) => `${r.role}:${r.type}`).join(", "))}
                </p>
              )}
              <p class="approval-meta">
                {t("审批发起：")}{esc(decisionRecord.approval?.initiator || '')}
                {decisionRecord.tool?.execution_surface ? ` · ${t("执行面：")}${esc(decisionRecord.tool.execution_surface)}` : ''}
              </p>
              {item.event?.metadata?.task_grant_id && (
                <p class="approval-meta">{t("任务授权：")}{esc(item.event.metadata.task_grant_id)}</p>
              )}
              {item.event?.metadata?.command_class && (
                <p class="approval-meta">{t("命令类别：")}{esc(item.event.metadata.command_class)}</p>
              )}
            </section>
          )}
          <section class="approval-section">
            <h5>{t("运行时审计")}</h5>
            <pre>{esc(JSON.stringify({
              decision: d,
              resolution: item.resolution || {},
              sync_state: item.sync_state,
              execution_state: item.execution_state,
            }, null, 2))}</pre>
          </section>
        </div>
      </details>
    </article>
  );
}
