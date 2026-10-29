/** 用本机真实 DSH SDK 执行门禁、原生 ask、单调守卫与最终结果事件。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,mkdirSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Context,Service } from '@deepseek-ai/cordis';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime,defineTool } from '@deepseek-ai/dsh-tools';
import { apply } from '../dist/index.js';
import { Outbox } from '../dist/outbox.js';
import { GuardClient } from '../dist/client.js';
import {sdkVersion} from '../dist/sdk.js';
const protocol='dsh-guard-v2';

async function fixture(t,{kind='allow',answer='allowed-once',failMode='closed',semanticMode='auto',hostAgentServices=false}={}) {
  const temp=mkdtempSync(join(tmpdir(),'rvguarder-sdk-'));
  const workspace=join(temp,'workspace');mkdirSync(workspace);
  const tokenFile=join(temp,'token');writeFileSync(tokenFile,'x'.repeat(48));
  let fail=false;const events=[];
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req) raw+=chunk;
    const body=JSON.parse(raw||'{}');events.push([req.url,body]);
    if(req.headers['x-rvguarder-token']!=='x'.repeat(48)) {res.writeHead(401).end();return;}
    if(fail) {res.writeHead(503).end();return;}
    let response={ok:true};
    if(req.url.endsWith('/hello')) response={ok:true,protocol,instance_id:'test',recovery_required:false,semantic_mode:semanticMode};
    if(req.url.endsWith('/semantic/prepare')) response={available:true,request_id:'request-id-semantic-123456',prompt:'sanitized task',expires_at:Date.now()/1000+30};
    if(req.url.endsWith('/semantic/submit')) response={ok:true};
    if(req.url.endsWith('/before')) response={protocol,instance_id:'test',session_id:body.session_id,call_id:body.call_id,kind,reason:'rule evidence',action_id:body.call_id,policy_version:'1.2.0',expires_at:Date.now()/1000+300};
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(response));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const backendUrl='http://127.0.0.1:'+server.address().port;
  const ctx=new Context();new SystemPrompt(ctx,{});new ToolRuntime(ctx,{});
  let semanticSpec,semanticChildToolResult;
  if(hostAgentServices){
    const subagents=new Service(ctx,'subagents');let provider,childId;
    subagents.registerProvider=(value)=>{provider=value;return ()=>{provider=undefined;};};
    subagents.getProvider=(name)=>provider?.name===name?provider:undefined;
    subagents.startActivation=async(spec)=>{
      semanticSpec=spec;childId=spec.childId;
      semanticChildToolResult=await ctx.tools.execute({name:'probe',arguments:{},callId:'semantic-child-attempt',rootCallId:'semantic-child-attempt',agent:{id:childId},signal:new AbortController().signal});
      return {childId:spec.childId,result:Promise.resolve({stopReason:'completed',output:[{type:'text',text:JSON.stringify({version:'v3',engine:'llm',operation_candidates:[],facts:{},entities:{},constraints:{},uncertainties:[]})}]}),dispose:async()=>{}};
    };
    const presets=new Service(ctx,'agentPresets');let definition;
    presets.register=async(value)=>{definition=value;return async()=>{};};
    presets.resolve=async(id)=>({id});
    presets.inspectCompositions=()=>definition?[{id:definition.id,modules:[{moduleName:definition.plugins[0]?.name}],leakedServices:[]}]:[];
    const agents=new Service(ctx,'agents');
    agents.get=(id)=>id===childId?{id,ctx:{tools:{schemas:()=>[]},get(name){return name==='tools'?this.tools:undefined;}}}:undefined;
  }
  const cwd=new Service(ctx,'workingDirectory');cwd.ensure=async()=>workspace;
  const approval=new Service(ctx,'approval');approval.request=async()=>answer;
  let executions=0;
  ctx.tools.register(defineTool({name:'probe',description:'safe fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(){executions++;return 'ok';}}));
  const cleanup=apply(ctx,{backendUrl,tokenFile,instanceId:'test',stateDir:join(temp,'private'),failMode,timeoutMs:500});
  const agent={id:'session-test'};
  const invoke=(id='call',extra={})=>ctx.tools.execute({name:'probe',arguments:{},callId:id,agent,signal:new AbortController().signal,...extra});
  t.after(async()=>{await cleanup();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(temp,{recursive:true,force:true});});
  return {ctx,invoke,events,executions:()=>executions,fail:()=>{fail=true;},backendUrl,tokenFile,temp,semanticSpec:()=>semanticSpec,semanticChildToolResult:()=>semanticChildToolResult};
}

test('concurrent handshakes retain host-agent mode for every caller', async t => {
  const f = await fixture(t, { semanticMode: 'host-agent' });
  const client = new GuardClient(f.backendUrl, f.tokenFile);
  const before = f.events.filter(([path]) => path.endsWith('/hello')).length;
  await Promise.all(Array.from({ length: 10 }, () => client.hello('test')));
  assert.equal(client.semanticMode, 'host-agent');
  const after = f.events.filter(([path]) => path.endsWith('/hello')).length;
  // The plugin's independent startup heartbeat may also handshake once.
  assert.ok(after - before <= 2);
  await client.hello('test', true);
  assert.equal(client.semanticMode, 'host-agent');
});

test('real SDK executes allowed call, final event has no result content',async t=>{
  const f=await fixture(t);const result=await f.invoke();assert.equal(result.isError,false);assert.equal(f.executions(),1);
  assert.equal(f.events.find(([path])=>path.endsWith('/hello'))?.[1].sdk_version,sdkVersion);
  await f.invoke('barrier');
  const completion=f.events.find(([path,body])=>path.endsWith('/result')&&body.call.call_id==='call')?.[1];
  assert.equal(completion.succeeded,true);assert.equal(completion.dispatched,true);assert.equal(completion.result,undefined);
});
test('real SDK denial never reaches tool body',async t=>{
  const f=await fixture(t,{kind:'deny'});assert.equal((await f.invoke()).isError,true);assert.equal(f.executions(),0);
});

test('concurrent calls share one authenticated handshake without sharing decisions', async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => f.invoke('parallel-' + index)));
  assert.ok(results.every(result => !result.isError));
  assert.equal(f.events.filter(([path]) => path.endsWith('/hello')).length, 1);
  assert.equal(f.events.filter(([path]) => path.endsWith('/before')).length, 10);
  assert.equal(f.executions(), 10);
});

test('managed initialization failure keeps a real execution guard even with fail-open configured', async t => {
  const ctx = new Context(); new SystemPrompt(ctx, {}); new ToolRuntime(ctx, {});
  t.after(() => ctx.fiber.dispose());
  let executions = 0;
  ctx.tools.register(defineTool({ name: 'probe', description: 'startup boundary fixture', parameters: {}, output: { schema: { type: 'string' }, render: (_a, value) => [{ type: 'text', text: value }] }, execute() { executions++; return 'unexpected'; } }));
  // 无可信 profileContext 的环境必须保留拦截，不能因初始化抛错使插件整条卸载。
  apply(ctx, { backendMode: 'managed', failMode: 'open' });
  const result = await ctx.tools.execute({ name: 'probe', arguments: {}, callId: 'startup-failure', agent: { id: 'test' }, signal: new AbortController().signal });
  assert.equal(result.isError, true);
  assert.equal(executions, 0);
});
test('native ask approved then syncs dispatch before body',async t=>{
  const f=await fixture(t,{kind:'ask'});assert.equal((await f.invoke()).isError,false);assert.equal(f.executions(),1);
  assert.ok(f.events.some(([path])=>path.endsWith('/dispatch')));
});
test('native rejected ask does not dispatch or create success',async t=>{
  const f=await fixture(t,{kind:'ask',answer:'rejected'});assert.equal((await f.invoke()).isError,true);assert.equal(f.executions(),0);
  assert.equal(f.events.some(([path])=>path.endsWith('/dispatch')),false);
});
test('unavailable backend defaults closed',async t=>{
  const f=await fixture(t);f.fail();assert.equal((await f.invoke()).isError,true);assert.equal(f.executions(),0);
});
test('explicit fail-open preserves downstream policy',async t=>{
  const f=await fixture(t,{failMode:'open'});f.fail();assert.equal((await f.invoke()).isError,false);assert.equal(f.executions(),1);
});
test('guard blocks another listener bypassing our pre-execute',async t=>{
  const f=await fixture(t);
  f.ctx.on('tools/pre-execute',async()=>({kind:'allow'}),true);
  assert.equal((await f.invoke()).isError,true);assert.equal(f.executions(),0);
});
test('nested invocation propagates opaque root/call IDs',async t=>{
  const f=await fixture(t);
  f.ctx.tools.register(defineTool({name:'outer',description:'nested fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(_args,exec){
    const result=await f.ctx.tools.execute({name:'probe',arguments:{},agent:exec.agent,callId:'opaque:child',rootCallId:exec.rootCallId,parent:exec.token,signal:exec.signal});
    assert.equal(result.isError,false);return 'done';
  }}));
  await f.invoke('opaque:root',{name:'outer'});
  const body=f.events.find(([p,b])=>p.endsWith('/before')&&b.call_id==='opaque:child')[1];
  assert.equal(body.root_call_id,'opaque:root');assert.equal(body.parent_call_id,'opaque:root');assert.equal(body.call_id,'opaque:child');
});
test('outbox survives restart and failed acknowledgement',async t=>{
  const f=await fixture(t);const directory=join(f.temp,'recovery');
  const item={call:{call_id:'saved'},succeeded:false,dispatched:false};
  new Outbox(directory).push(item);f.fail();
  const restored=new Outbox(directory);
  await assert.rejects(restored.flush(new GuardClient(f.backendUrl,f.tokenFile,500)));
  assert.equal(JSON.parse(readFileSync(join(directory,'completions.json'),'utf8')).length,1);
});
test('client rejects nonlocal backend',()=>{
  assert.throws(()=>new GuardClient('http://example.com','unused'));
});
test('outbox detects execution interrupted before final result',async t=>{
  const f=await fixture(t);const directory=join(f.temp,'interrupted');
  new Outbox(directory).begin({session_id:'s',call_id:'inflight'});
  assert.equal(new Outbox(directory).recoveryRequired,true);
});
test('persisted completion reconciles an interrupted execution marker',async t=>{
  const f=await fixture(t);const directory=join(f.temp,'settled');
  const call={session_id:'s',call_id:'settled'};const outbox=new Outbox(directory);
  outbox.begin(call);outbox.push({call,dispatched:true,succeeded:true});
  assert.equal(new Outbox(directory).recoveryRequired,false);
});
test('host-agent mode prepares sanitized delegation and falls back when DSH child services are absent',async t=>{
  const f=await fixture(t,{semanticMode:'host-agent'});
  assert.equal((await f.invoke()).isError,false);
  const prepare=f.events.find(([path])=>path.endsWith('/semantic/prepare'));
  const before=f.events.find(([path])=>path.endsWith('/before'));
  assert.ok(prepare);
  assert.equal(prepare[1].arguments?.secret,undefined);
  assert.equal(before[1].host_semantic_request_id,undefined);
  assert.equal(f.events.some(([path])=>path.endsWith('/semantic/submit')),false);
});
test('host-agent delegation uses the pre-restricted DSH child and binds only its request ID',async t=>{
  const f=await fixture(t,{semanticMode:'host-agent',hostAgentServices:true});
  assert.equal((await f.invoke()).isError,false);
  const spec=f.semanticSpec();
  const prepare=f.events.find(([path])=>path.endsWith('/semantic/prepare'));
  const submit=f.events.find(([path])=>path.endsWith('/semantic/submit'));
  const before=f.events.find(([path])=>path.endsWith('/before'));
  const dispatch=f.events.find(([path])=>path.endsWith('/dispatch'));
  assert.deepEqual(spec.request.prompt,[{type:'text',text:'sanitized task'}]);
  assert.match(spec.request.agentPreset,/^rvguarder-semantic-only-test$/);
  assert.equal(spec.request.agentOptions,undefined);
  assert.equal(spec.delivery,'caller');
  assert.equal(prepare[1].arguments?.secret,undefined);
  assert.ok(submit[1].response.includes('"version":"v3"'));
  assert.equal(before[1].host_semantic_request_id,'request-id-semantic-123456');
  assert.equal(dispatch[1].host_semantic_request_id,'request-id-semantic-123456');
  assert.equal(f.semanticChildToolResult().isError,true);
  assert.equal(f.events.filter(([path])=>path.endsWith('/semantic/prepare')).length,1,'semantic child tools must not recursively delegate');
  assert.equal(f.events.filter(([path])=>path.endsWith('/before')).length,1,'semantic child tools must never reach the Guard backend');
});
