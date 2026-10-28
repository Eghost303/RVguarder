/** DSH 0.2.1-rc.2/rc.3 适配插件：原生审批、单调守卫与持久完成事件。 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolExecution,ToolExecutionResult,PreToolDecision } from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-working-directory';
import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { GuardClient, BridgeUnavailable } from './client.js';
import {ControlledTools} from './controlled.js';
import {acquireLease} from './lease.js';
import {DegradedOutbox} from './durable.js';
import {hostProbe} from './probe.js';
import { Outbox } from './outbox.js';
import { protocol,type GuardCall,type GuardDecision } from './protocol.js';
import {HostSemanticDelegator} from './host-semantic.js';
export const name='dsh-rvguarder';
export const inject=['tools','workingDirectory'];
export interface Config { backendUrl:string; tokenFile:string; instanceId:string; stateDir?:string; timeoutMs?:number; failMode?:'closed'|'open'; evidenceKeyFile?:string; egressAllowlist?:string[]; egressCaFile?:string; }
interface Pending { call:GuardCall; decision:GuardDecision; dispatched:boolean; }
/** 注册真实 SDK 事件；策略引擎只保留在共享 Python 核心。 */
export function apply(ctx:Context,config:Config) {
  if (!config?.instanceId || !/^[a-zA-Z0-9_.-]{1,128}$/.test(config.instanceId)) throw new Error('Invalid Guard instanceId');
  if (config.failMode!==undefined && !['closed','open'].includes(config.failMode)) throw new Error('Invalid failMode');
  const timeout=config.timeoutMs??5000;
  if (!Number.isInteger(timeout)||timeout<100||timeout>30000) throw new Error('Invalid timeoutMs');
  const failOpen=config.failMode==='open';
  const stateDir=resolve(config.stateDir??join(homedir(),'.rvguarder','dsh-plugin',config.instanceId));
  const client=new GuardClient(config.backendUrl,config.tokenFile,timeout);
  const release=acquireLease(stateDir);
  let outbox:Outbox;let degraded:DegradedOutbox;
  try {outbox=new Outbox(stateDir);degraded=new DegradedOutbox(stateDir);}catch(error){release();throw error;}
  let controlled:ControlledTools|undefined;
  try{if(config.evidenceKeyFile)controlled=new ControlledTools(ctx,config.evidenceKeyFile,config.egressAllowlist??[],config.egressCaFile);}catch(error){release();throw error;}
  const hostSemantic=new HostSemanticDelegator(ctx,config.instanceId);
  const pending=new Map<object,Pending>();
  const bypassed=new WeakSet<object>();
  const identities=new Map<object,GuardCall>();
  const degradedCalls=new Map<object,GuardCall>();
  let failure:unknown=outbox.recoveryRequired ? new Error("Unconfirmed execution from previous process") : undefined;
  async function ready() {
    if(failure) throw new Error('Guard persistence failure requires reconciliation');
    await outbox.flush(client); await client.hello(config.instanceId);
    await degraded.flush(client).catch(()=>{process.emitWarning("RVguarder degraded audit pending");});
  }
  ctx.on('tools/pre-execute',async(exec,next):Promise<PreToolDecision>=>{
    try {
      if(exec.signal.aborted) return {kind:'cancel'};
      if(!exec.agent||!exec.callId||!exec.rootCallId||!exec.arguments||typeof exec.arguments!=='object'||Array.isArray(exec.arguments)) throw new Error('Missing trusted DSH call identity');
      const cwd=await ctx.workingDirectory.ensure(exec.agent,exec.signal);
      const original=exec.agent.session?.header.cwd || cwd;
      for(const root of [cwd,original]) {
        const local=relative(resolve(root),realpathSync(stateDir));
        if(local===''||(!local.startsWith('..')&&!isAbsolute(local))) throw new Error('Outbox must be outside Agent workspace');
      }
      const call:GuardCall={protocol,instance_id:config.instanceId,session_id:String(exec.agent.id),agent_id:String(exec.agent.id),call_id:String(exec.callId),root_call_id:String(exec.rootCallId),tool_name:exec.name,cwd,arguments:exec.arguments as Record<string,unknown>};
      if(exec.parent){const parent=identities.get(exec.parent);if(!parent)throw new Error('Missing trusted parent execution');call.parent_call_id=parent.call_id;}
      const parentAgent=exec.agent.session?.header.parentSession;
      if(parentAgent)call.parent_agent_id=String(parentAgent);
      identities.set(exec.token,call);
      controlled?.prepare(exec.token,call);
      await ready();
      if(client.semanticMode==='host-agent') {
        try {
          const prepared=await client.prepareSemantic(call,exec.signal);
          if(prepared.available&&prepared.request_id&&prepared.prompt&&!exec.signal.aborted) {
            const response=await hostSemantic.run(prepared.prompt,exec.agent,exec.signal,timeout);
            if(response&&!exec.signal.aborted&&await client.submitSemantic(prepared.request_id,call,response,exec.signal)) {
              call.host_semantic_request_id=prepared.request_id;
            }
          }
        } catch { if(exec.signal.aborted)return {kind:'cancel'}; }
      }
      const decision=await client.before(call,exec.signal);
      controlled?.bind(exec.token,decision);
      pending.set(exec.token,{call,decision,dispatched:false});
      if(decision.kind==='deny') return {kind:'deny',reason:decision.reason};
      const downstream=await next();
      if(downstream.kind==='deny'||downstream.kind==='cancel') return downstream;
      if(decision.kind==='ask') {
        const reason=[decision.reason,downstream.kind==='ask'?downstream.reason:''].filter(Boolean).join('\n');
        return {kind:'ask',reason,displayReason:{en:reason,zh:reason,'zh-CN':reason}};
      }
      return downstream;
    } catch(error) {
      if(exec.signal.aborted) return {kind:'cancel'};
      if(failOpen&&!failure&&error instanceof BridgeUnavailable&&!pending.has(exec.token)) {
        const call=identities.get(exec.token);if(!call)return {kind:'deny',reason:'Missing trusted context'};
        bypassed.add(exec.token);degradedCalls.set(exec.token,call);
        degraded.push({instance_id:config.instanceId,session_id:call.session_id,call_id:call.call_id,tool_name:call.tool_name,time:Date.now()/1000,stage:'bypass',reason:'bridge_unavailable'});
        return next();
      }
      return {kind:'deny',reason:'RVguarder 决策服务或可信上下文不可用；已按 fail-closed 拒绝。'};
    }
  });
  ctx.tools.guard((exec:Readonly<ToolExecution>)=>{
    if(failure) return 'RVguarder 完成日志故障，需核对历史后恢复。';
    const item=pending.get(exec.token);
    if(item?.decision.kind==='deny') return item.decision.reason;
    if(item&&item.decision.expires_at*1000>=Date.now()) return;
    if(failOpen&&bypassed.has(exec.token)) return;
    return 'RVguarder 未确认此调用或决策已过期。';
  });
  ctx.on('tools/execute',async(exec,next)=>{
    const item=pending.get(exec.token);
    if(item) {
      try { outbox.begin(item.call); }
      catch(error) { failure=error;throw error; }
      const ack=await client.post('dispatch',item.call,exec.signal);
      if(ack.ok!==true) throw new Error('Guard dispatch acknowledgement missing');
      controlled?.permitted(exec.token,ack.permit);
      item.dispatched=true;
    }
    return next();
  });
  ctx.on('tools/result',(exec:Readonly<ToolExecution>,result:Readonly<ToolExecutionResult>)=>{
    const call=degradedCalls.get(exec.token);degradedCalls.delete(exec.token);
    if(call)degraded.push({instance_id:config.instanceId,session_id:call.session_id,call_id:call.call_id,tool_name:call.tool_name,time:Date.now()/1000,stage:'result',reason:'bridge_unavailable',succeeded:result.isError===false});
    identities.delete(exec.token);
    const item=pending.get(exec.token);pending.delete(exec.token);
    const nativeReceipt=result.isError===false?controlled?.observeNative(exec.token,result.content):undefined;
    const receipt=controlled?.finish(exec.token) || nativeReceipt;
    if(!item) return;
    try {
      outbox.push({call:item.call,dispatched:item.dispatched,succeeded:item.dispatched&&result.isError===false,...(result.isError===false&&receipt?{evidence:receipt}:{})});
      outbox.settle(item.call);
      void outbox.flush(client).catch(()=>{});
    } catch(error) {failure=error;}
  });
  let stopped=false;let heartbeatRun:Promise<void>|undefined;
  const heartbeat=()=>{
    if(stopped)return Promise.resolve();if(heartbeatRun)return heartbeatRun;
    heartbeatRun=(async()=>{await ready();await client.hello(config.instanceId,true);const hostAgent=await hostSemantic.readyCapabilities();if(!stopped)await client.post('probe',hostProbe(ctx,config.instanceId,stateDir,degraded.gap,hostAgent));})().finally(()=>{heartbeatRun=undefined;});
    return heartbeatRun;
  };
  const timer=setInterval(()=>{void heartbeat().catch(()=>{});},15000);timer.unref();
  void heartbeat().catch(()=>{});
  return ctx.effect(()=>async()=>{stopped=true;clearInterval(timer);try{await heartbeatRun?.catch(()=>{});await outbox.flush(client).catch(()=>{});await degraded.flush(client).catch(()=>{});}finally{await hostSemantic.close();controlled?.close();release();}}, 'rvguarder-shutdown');
}
