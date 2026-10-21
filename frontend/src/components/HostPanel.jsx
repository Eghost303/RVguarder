import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../store';
import { api, apiErrorMessage, exportAudit } from '../api';

/** DSH 实例、语义模式和审计；状态只来自认证服务，不推测已连接。 */
export function HostPanel() {
  const summary = useStore((s) => s.summary);
  const showToast = useStore((s) => s.showToast);
  const [status, setStatus] = useState(null);
  const dsh = summary.host?.kind === 'dsh';
  useEffect(() => {
    if (!dsh) return;
    let alive = true;
    const load = () => Promise.all([api('/api/dsh/status'), api('/api/dsh/audit'), api('/api/dsh/capabilities')]).then(([data, audit, capabilities]) => { if (alive) setStatus({ ...data, audit, capabilities }); }).catch(() => {});
    load();
    const timer = setInterval(load, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [dsh]);
  if (!dsh) return null;
  const capabilities = status?.capabilities || summary.capabilities || {};
  const semantic = status?.semantic || summary.semantic || {};
  const changeMode = async (event) => {
    try {
      const result = await api('/api/dsh/semantic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: event.target.value }) });
      setStatus((s) => ({ ...s, semantic: result }));
      showToast('语义模式已更新');
    } catch (error) { showToast(apiErrorMessage(error)); }
  };
  const handleExport = async () => {
    try { const result = await exportAudit(); showToast('审计已导出到服务数据目录：' + JSON.stringify(result)); }
    catch (error) { showToast(apiErrorMessage(error)); }
  };
  return (
    <section class="card" data-testid="dsh-host-panel">
      <div class="card-head"><h3>DSH · {summary.host.instance_id}</h3><span class={'badge ' + (summary.hook?.active ? 'ok' : 'warn')}>{summary.hook?.active ? '插件已连接' : '等待插件连接'}</span></div>
      <p>Profile：{summary.host.profile} · SDK：{status?.hook?.sdk_version || '未握手'} · 原生审批为唯一决策入口</p>
      {(status?.hook?.recovery_required || summary.hook?.recovery_required) && <p role="alert">发现中断的决策或历史提交，服务已停止新授权；请先核对实际执行记录。</p>}
      <div data-testid="dsh-capabilities">
        <p>宿主探针：{capabilities.probe_fresh ? '有效' : '缺失或过期'} · 降级审计事件：{capabilities.degraded_events || 0}</p>
        {capabilities.audit_gap && <p role="alert">存在旁路审计缺口，请核对宿主执行记录。</p>}
        {!!capabilities.unmapped?.length && <p>未映射工具：{capabilities.unmapped.join('、')}（按未知能力处理）</p>}
        <p>受控字节证据：仅限配置了签名密钥的本地读取、复制和换行归一化；普通工具结果仅证明执行状态。</p>
        <p>字节收据：{capabilities.evidence?.content_receipts || 0} · 原生读取访问证据：{capabilities.evidence?.access_receipts || 0}</p>
        <p>受控外发：默认禁用，仅允许精确 HTTPS 白名单和当前单次宿主授权；Windows ACL 与沙箱以实际探针结果为准。</p>
      </div>
      <label>语义模式 <select aria-label="DSH 语义模式" value={semantic.configured_mode || 'auto'} onChange={changeMode}><option value="auto">自动（LLM 可用时增强）</option><option value="local">本地规则</option><option value="llm">LLM（需要宿主密钥）</option></select></label>
      <p>LLM：{semantic.llm_enabled ? '已配置，失败时退回本地分析' : '未启用，使用本地分析'} · 模型：{semantic.model || '—'} · 最近增强：{semantic.last_llm_status || '未运行'}</p>
      <button class="btn" onClick={handleExport}>导出审计</button>
      <p>扫描报告：{['json', 'html', 'pdf'].map((format) => <a key={format} href={'/api/dsh/reports/' + format} target="_blank" rel="noreferrer"> {format.toUpperCase()} </a>)}</p>
      {(status?.audit?.items || summary.audit?.recent || []).slice(0, 5).map((record, index) => <p key={index}>审计：{record.event_type || record.record_type || '事件'} · {record.timestamp || record.created_at || ''}</p>)}
    </section>
  );
}
