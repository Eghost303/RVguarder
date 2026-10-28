import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../store';
import { api, apiErrorMessage, exportAudit, setDshSemanticMode } from '../api';

const DSH_HOST_AGENT_STATUS = {
  ready: '可用',
  probe_unavailable: '等待新的宿主能力探针',
  subagents_unavailable: 'DSH 子代理服务不可用',
  subagent_services_unavailable: 'DSH 子代理服务不可用',
  preset_registry_unavailable: 'DSH agent preset registry 不可用',
  sdk_package_version_mismatch: 'DSH 子代理组件版本不匹配',
  spawn_provider_module_unavailable: '未找到 DSH 同版本子代理 provider',
  spawn_provider_load_failed: 'DSH 子代理 provider 加载失败',
  spawn_provider_apply_missing: 'DSH 子代理 provider 接口不完整',
  provider_registration_failed: 'DSH 子代理 provider 注册失败',
  provider_registration_or_capability_missing: 'DSH 子代理 provider 缺少本地 Agent 路由能力',
  provider_inherits_parent_context: 'DSH 子代理 provider 不支持独立工具 preset',
  semantic_tool_guard_unavailable: '无法安装宿主子代理工具拒绝守卫',
  semantic_tool_preset_registration_failed: '无法注册语义子代理限制 preset',
  semantic_tool_preset_not_active: '语义子代理限制插件未激活',
  semantic_tool_preset_verification_failed: '无法验证语义子代理限制 preset',
  isolated_preset_unavailable: '语义子代理限制 preset 不可用',
  effective_tools_nonempty: '子代理运行时仍能看到工具，委派已关闭',
  tool_free_child_unverified: '无法确认子代理没有工具',
  provider_initialization_failed: 'DSH 子代理初始化失败',
  not_checked: '等待宿主能力检查',
};

const DSH_HOST_AGENT_FALLBACK = {
  no_child_response: '子代理未返回结果',
  invalid_response: '子代理返回格式无效',
  response_too_large: '子代理返回内容超出限制',
};

function hostAgentLabel(code) {
  return DSH_HOST_AGENT_STATUS[code] || code || '未知状态';
}

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
  const hostAgentAvailable = semantic.host_agent_available === true || capabilities.host_agent?.available === true;
  const hostAgentReason = semantic.host_agent_reason || capabilities.host_agent?.reason || 'probe_unavailable';
  const delegateStatus = semantic.last_delegate_status || 'not_run';
  const delegateReason = DSH_HOST_AGENT_FALLBACK[semantic.last_delegate_reason] || semantic.last_delegate_reason;
  const changeMode = async (event) => {
    try {
      await setDshSemanticMode(event.target.value);
      const [confirmed, currentCapabilities] = await Promise.all([api('/api/dsh/status'), api('/api/dsh/capabilities')]);
      setStatus((s) => ({ ...s, ...confirmed, capabilities: currentCapabilities }));
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
      <label>语义模式 <select aria-label="DSH 语义模式" value={semantic.configured_mode || 'auto'} onChange={changeMode}><option value="auto">自动（LLM 可用时增强）</option><option value="local">本地规则</option><option value="llm">LLM（需要宿主密钥）</option><option value="host-agent" disabled={!hostAgentAvailable}>宿主子代理（使用当前 DSH 模型路由）</option></select></label>
      {!hostAgentAvailable && <p>宿主子代理暂不可用：{hostAgentLabel(hostAgentReason)}</p>}
      {semantic.configured_mode === 'host-agent'
        ? <p>子代理状态：{hostAgentLabel(semantic.provider_status || (hostAgentAvailable ? 'ready' : hostAgentReason))} · 最近委派：{delegateStatus === 'success' ? '成功' : delegateStatus === 'fallback' ? '已回退到本地分析' : delegateStatus === 'not_used' ? '未使用' : '未运行'}{delegateReason ? ` · 回退原因：${DSH_HOST_AGENT_FALLBACK[semantic.last_delegate_reason] || delegateReason}` : ''}</p>
        : <p>LLM：{semantic.llm_enabled ? '已配置，失败时退回本地分析' : '未启用，使用本地分析'} · 模型：{semantic.model || '—'} · 最近增强：{semantic.last_llm_status || '未运行'}</p>}
      <button class="btn" onClick={handleExport}>导出审计</button>
      <p>扫描报告：{['json', 'html', 'pdf'].map((format) => <a key={format} href={'/api/dsh/reports/' + format} target="_blank" rel="noreferrer"> {format.toUpperCase()} </a>)}</p>
      {(status?.audit?.items || summary.audit?.recent || []).slice(0, 5).map((record, index) => <p key={index}>审计：{record.event_type || record.record_type || '事件'} · {record.timestamp || record.created_at || ''}</p>)}
    </section>
  );
}
