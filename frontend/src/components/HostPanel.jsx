import { useT } from '../i18n';
import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../store';
import { useApi, apiErrorMessage } from '../api';
import { useTransport } from '../transport';

/** DSH 实例、语义模式和审计；状态只来自认证服务，不推测已连接。 */
export function HostPanel() {
  const t = useT();
  const { api, exportAudit, downloadReport, fetchSummary } = useApi();
  const transport = useTransport();

  const summary = useStore((s) => s.summary);
  const showToast = useStore((s) => s.showToast);
  const [status, setStatus] = useState(null);
  const dsh = summary.host?.kind === 'dsh';
  const embedded = useStore((s) => s.embedded);
  const backendStatus = useStore(s => s.backendStatus);
  useEffect(() => {
    if (!dsh) return;
    let alive = true;
    const load = () => {
      if (embedded) {
        // 内嵌模式：概览快照已含语义/能力/审计；这里只做轻量刷新。
        Promise.all([transport.call('audit')]).then(([audit]) => { if (alive) setStatus((s) => ({ ...(s || {}), audit })); }).catch(() => {});
      } else {
        Promise.all([api('/api/dsh/status'), api('/api/dsh/audit'), api('/api/dsh/capabilities')]).then(([data, audit, capabilities]) => { if (alive) setStatus({ ...data, audit, capabilities }); }).catch(() => {});
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [dsh, embedded]);
  if (!dsh) return null;
  const capabilities = status?.capabilities || summary.capabilities || {};
  const semantic = status?.semantic || summary.semantic || {};
  const changeMode = async (event) => {
    try {
      if (embedded) {
        await transport.call('semanticMode', { mode: event.target.value });
        setStatus((s) => ({ ...(s || {}), semantic: { ...(s?.semantic || {}), configured_mode: event.target.value } }));
        fetchSummary({ compact: true }).then((next) => { if (next?.semantic) setStatus((s) => ({ ...(s || {}), semantic: next.semantic })); }).catch(() => {});
      } else {
        const result = await api('/api/dsh/semantic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: event.target.value }) });
        setStatus((s) => ({ ...s, semantic: result }));
      }
      showToast(t("语义模式已更新"));
    } catch (error) { showToast(apiErrorMessage(error)); }
  };
  const handleExport = async () => {
    if (embedded) {
      // 内嵌模式：导出走宿主认证通道并交付下载，而不是输出服务端路径。
      try {
        const buffer = await exportAudit('json');
        const blob = new Blob([buffer], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'rvguarder-audit-export.json';
        anchor.rel = 'noopener';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        showToast(t("审计导出已交付下载"));
      } catch (error) { showToast(apiErrorMessage(error)); }
      return;
    }
    try { const result = await exportAudit(); showToast(t("审计已导出到服务数据目录：") + JSON.stringify(result)); }
    catch (error) { showToast(apiErrorMessage(error)); }
  };
  const downloadFormat = async (format) => {
    try {
      const buffer = await downloadReport(format);
      const blob = new Blob([buffer], { type: format === 'pdf' ? 'application/pdf' : format === 'html' ? 'text/html' : 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `rvguarder-report.${format}`;
      anchor.rel = 'noopener';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      showToast(t("报告已交付下载"));
    } catch (error) { showToast(apiErrorMessage(error, t("报告尚未生成；请先运行扫描。"))); }
  };
  return (
    <section class="card" data-testid="dsh-host-panel">
      <div class="card-head"><h3>DSH · {summary.host.instance_id}</h3><span class={'badge ' + (summary.hook?.active ? 'ok' : 'warn')}>{summary.hook?.active ? t("插件已连接") : t("等待插件连接")}</span></div>
      {embedded && backendStatus && <p data-testid="deployment-status">{t('部署模式：')}{t(backendStatus.deployment?.mode === 'managed' ? '插件托管' : '外部服务')} · {t('启动状态：')}{t(({ starting: '启动中', ready: '已就绪', failed: '启动失败', stopped: '已停止' })[backendStatus.deployment?.state] || '离线')}{backendStatus.deployment?.reason ? ` · ${t('故障原因：')}${backendStatus.deployment.reason}` : ''}</p>}
      <p>Profile：{summary.host.profile} · SDK：{status?.hook?.sdk_version || summary.hook?.sdk_version || t("未握手")}{t("· 原生审批为唯一决策入口")}</p>
      {(status?.hook?.recovery_required || summary.hook?.recovery_required) && <p role="alert">{t("发现中断的决策或历史提交，服务已停止新授权；请先核对实际执行记录。")}</p>}
      <div data-testid="dsh-capabilities">
        <p>{t("宿主探针：")}{capabilities.probe_fresh ? t("有效") : t("缺失或过期")}{t("· 降级审计事件：")}{capabilities.degraded_events || 0}</p>
        {capabilities.audit_gap && <p role="alert">{t("存在旁路审计缺口，请核对宿主执行记录。")}</p>}
        {!!capabilities.unmapped?.length && <p>{t("未映射工具：")}{capabilities.unmapped.join('、')}{t("（按未知能力处理）")}</p>}
        <p>{t("受控字节证据：仅限配置了签名密钥的本地读取、复制和换行归一化；普通工具结果仅证明执行状态。")}</p>
        <p>{t("字节收据：")}{capabilities.evidence?.content_receipts || 0}{t("· 原生读取访问证据：")}{capabilities.evidence?.access_receipts || 0}</p>
        <p>{t("受控外发：默认禁用，仅允许精确 HTTPS 白名单和当前单次宿主授权；Windows ACL 与沙箱以实际探针结果为准。")}</p>
      </div>
      <label>{t("语义模式")}<select aria-label={t("DSH 语义模式")} value={semantic.configured_mode || 'auto'} onChange={changeMode}><option value="auto">{t("自动（LLM 可用时增强）")}</option><option value="local">{t("本地规则")}</option><option value="llm">{t("LLM（需要宿主密钥）")}</option></select></label>
      <p>LLM：{semantic.llm_enabled ? t("已配置，失败时退回本地分析") : t("未启用，使用本地分析")}{t("· 模型：")}{semantic.model || '—'}{t("· 最近增强：")}{semantic.last_llm_status || t("未运行")}</p>
      <button class="btn" onClick={handleExport}>{t("导出审计")}</button>
      <p>{t("扫描报告：")}{embedded
        ? ['json', 'html', 'pdf'].map((format) => <button key={format} class="btn" onClick={() => downloadFormat(format)}> {format.toUpperCase()} </button>)
        : ['json', 'html', 'pdf'].map((format) => <a key={format} href={'/api/dsh/reports/' + format} target="_blank" rel="noreferrer"> {format.toUpperCase()} </a>)}</p>
      {(status?.audit?.items || summary.audit?.recent || []).slice(0, 5).map((record, index) => <p key={index}>{t("审计：")}{record.event_type || record.record_type || t("事件")} · {record.timestamp || record.created_at || ''}</p>)}
    </section>
  );
}
