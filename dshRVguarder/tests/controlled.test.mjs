/** 实际 SDK + 实际 Python 核心，本地临时文件；不调用在线模型或外部目标。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer as createHttpsServer} from 'node:https';
import {once} from 'node:events';
import {spawn,spawnSync} from 'node:child_process';
import {Context,Service} from '@deepseek-ai/cordis';
import {childSessionMeta} from '@deepseek-ai/dsh-subagent';
import {SessionStore} from '@deepseek-ai/dsh-session';
import {SystemPrompt} from '@deepseek-ai/dsh-system-prompt';
import {ToolRuntime} from '@deepseek-ai/dsh-tools';
import {NodePtcRuntime} from '@deepseek-ai/dsh-ptc-runtime-node';
import {LocalFileSystem} from '@deepseek-ai/dsh-fs-local';
import {LocalSubprocessRuntime} from '@deepseek-ai/dsh-subprocess-local';
import {LocalSandboxProvider} from '@deepseek-ai/dsh-sandbox-local';
import {apply} from '../dist/index.js';
import {acquireLease} from '../dist/lease.js';
import {DegradedOutbox} from '../dist/durable.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const python=process.env.RVGUARDER_PYTHON||'python';
async function fixture(t,{ptc=false,egress}={}){
  const temp=mkdtempSync(join(tmpdir(),'rvguarder-controlled-')),workspace=join(temp,'workspace'),home=join(temp,'home'),profile=join(home,'profiles','web'),project=join(temp,'guard');
  mkdirSync(workspace);mkdirSync(profile,{recursive:true});writeFileSync(join(profile,'package.json'),JSON.stringify({dsh:{profile:{bundles:[]}}}));
  writeFileSync(join(workspace,'source.txt'),'hello\r\nworld');
  const prepared=spawnSync(python,['-X','utf8','-c','from pathlib import Path; import sys; from clawRVguarder.storage.private_files import ensure_private_directory; ensure_private_directory(Path(sys.argv[1]))',join(project,'runtime')],{cwd:root,encoding:'utf8'});
  assert.equal(prepared.status,0,prepared.stderr);
  if(egress){writeFileSync(join(project,'runtime','dsh-evidence.json'),JSON.stringify({egress_allowlist:[egress.url]}),{mode:0o600});}
  const child=spawn(python,['-X','utf8','-m','clawRVguarder.hosts.dsh.server','--project-dir',project,'--dsh-home',home,'--workspace',workspace,'--port','0','--semantic-mode','local'],{cwd:root,env:{...process.env,DEEPSEEK_API_KEY:''},stdio:['ignore','pipe','pipe']});
  let cleanup;let stderr='';let timingBuffer='';child.stderr.on('data',b=>{
    stderr+=b;
    if(process.env.RVGUARDER_DSH_TIMING_OUTPUT){
      timingBuffer+=b;
      while(timingBuffer.includes('\n')){const end=timingBuffer.indexOf('\n');const line=timingBuffer.slice(0,end);timingBuffer=timingBuffer.slice(end+1);try{const item=JSON.parse(line);if(['dsh.bridge.lock','dsh.bridge.phase'].includes(item.event))appendFileSync(process.env.RVGUARDER_DSH_TIMING_OUTPUT,JSON.stringify(item)+'\n');}catch{}}
    }
  });
  t.after(async()=>{try{if(cleanup)await cleanup();}finally{if(process.platform==='win32'){spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}else{child.kill('SIGTERM');}await new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);setTimeout(()=>{child.kill('SIGKILL');r();},5000).unref();});rmSync(temp,{recursive:true,force:true,maxRetries:20,retryDelay:100});}});
  const url=await new Promise((resolve,reject)=>{let raw='';const timer=setTimeout(()=>reject(new Error('Backend startup timeout: '+stderr)),10000);child.once('exit',()=>{clearTimeout(timer);reject(new Error('Backend exited: '+stderr));});child.stdout.on('data',b=>{raw+=b;for(const line of raw.split('\n'))try{const data=JSON.parse(line);if(data.url){clearTimeout(timer);resolve(data.url);return;}}catch{}});});
  const ctx=new Context();new SystemPrompt(ctx,{});new SessionStore(ctx);new ToolRuntime(ctx,{mode:ptc?'ptc':'native'});
  if(ptc){
    new LocalFileSystem(ctx,{cwd:workspace,diffBasisMaxBytes:1048576});new LocalSubprocessRuntime(ctx);
    new LocalSandboxProvider(ctx,{probeTimeoutMs:1500,runnerCommand:[],runnerFailureSignatures:[]});
    const policy=new Service(ctx,'sandboxPolicy');policy.defaultMode='workspace-write';policy.resolve=()=>({mode:'workspace-write',workspaceRoot:workspace});
    new NodePtcRuntime(ctx,{executionMode:'per-call',timeoutMs:10000,maxTimeoutMs:10000,maxOutputBytes:1048576,maxOldGenerationSizeMb:128,maxMessageBytes:1048576,maxPendingCalls:8,graceMs:1000});
  }const cwd=new Service(ctx,'workingDirectory');cwd.ensure=async()=>workspace;
  ctx.tools.register({name:'read',description:'Native read fixture on declared source',parameters:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']},output:{schema:{type:'string'},render:(_a,value)=>[{type:'text',text:value}]},execute:async(args)=>{assert.equal(args.file_path,'source.txt');return readFileSync(join(workspace,'source.txt'),'utf8');}});
  let beforeApproval,lastCall;ctx.on('tools/pre-execute',async(exec,next)=>{lastCall={agent:String(exec.agent.id),session:String(exec.agent.id),run:String(exec.rootCallId),call:String(exec.callId)};return next();});
  const approval=new Service(ctx,'approval');approval.request=async()=>{await beforeApproval?.();return 'allowed-once';};
  cleanup=apply(ctx,{backendUrl:url,tokenFile:join(project,'runtime','dsh-token'),instanceId:'dsh-local',stateDir:join(temp,'plugin'),evidenceKeyFile:join(project,'runtime','authorization','content-signing.key'),...(egress?{egressAllowlist:[egress.url],egressCaFile:egress.caFile}:{})});
  const agent={id:'session-1',ctx,session:ctx.sessions.create('session-1',{meta:{cwd:workspace}})};
  const execute=(name,args,id=crypto.randomUUID())=>ctx.tools.execute({name,arguments:args,agent,callId:id,signal:new AbortController().signal});
  const token=readFileSync(join(project,'runtime','dsh-token'),'utf8').trim();
  const api=async(path)=>{const response=await fetch(url+'api/'+path,{headers:{'x-rvguarder-token':token}});assert.ok(response.ok);return response.json();};
  const grant=(revoke=false)=>{
    const args=['-m','clawRVguarder.hosts.dsh.grant_cli','--project-dir',project,'--workspace',workspace];
    const issued=spawnSync(python,[...args,'issue','--agent',lastCall.agent,'--session',lastCall.session,'--task','session:'+lastCall.session,'--run',lastCall.run,'--call',lastCall.call,'--path','source.txt','--recipient',egress.url],{cwd:root,encoding:'utf8'});
    assert.equal(issued.status,0,issued.stderr);const id=JSON.parse(issued.stdout).id;
    if(revoke){const result=spawnSync(python,[...args,'revoke','--grant-id',id],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
    return id;
  };
  return {ctx,agent,execute,workspace,api,grant,onApproval:fn=>beforeApproval=fn};
}
test('actual backend accepts controlled read and copy byte receipts',async t=>{
  const f=await fixture(t);
  const read=await f.execute('rvguard_read',{file_path:'source.txt'});assert.equal(read.isError,false,JSON.stringify(read));
  assert.equal(Buffer.from(read.value.data,'base64').toString(),'hello\r\nworld');
  const copy=await f.execute('rvguard_copy',{file_path:'source.txt',destination:'copy.txt'});assert.equal(copy.isError,false,JSON.stringify(copy));
  assert.equal(readFileSync(join(f.workspace,'copy.txt'),'utf8'),'hello\r\nworld');
  await f.execute('rvguard_read',{file_path:'copy.txt'});
  const summary=await f.api('summary');const items=summary.actions.items;
  assert.ok(items.some(a=>a.event?.metadata?.dsh_content_history?.witnesses?.some(w=>w.kind==='copy')));
});
test('actual backend accepts deterministic transform of actual bytes',async t=>{
  const f=await fixture(t);const result=await f.execute('rvguard_transform',{file_path:'source.txt',destination:'normalized.txt',transform:'normalize_newlines'});
  assert.equal(result.isError,false,JSON.stringify(result));assert.equal(readFileSync(join(f.workspace,'normalized.txt'),'utf8'),'hello\nworld');
});
test('approval-time resource modification prevents controlled copy',async t=>{
  const f=await fixture(t);f.onApproval(()=>writeFileSync(join(f.workspace,'source.txt'),'changed'));
  const result=await f.execute('rvguard_copy',{file_path:'source.txt',destination:'copy.txt'});
  assert.equal(result.isError,true);assert.match(JSON.stringify(result),/changed after approval/);
});
test('controlled traversal and symlinks cannot create byte receipts',async t=>{
  const f=await fixture(t);assert.equal((await f.execute('rvguard_read',{file_path:'../private'})).isError,true);
  if(process.platform==='win32'){
    const real=join(f.workspace,'real');mkdirSync(real);writeFileSync(join(real,'source.txt'),'test');
    symlinkSync(real,join(f.workspace,'link'),'junction');
    assert.equal((await f.execute('rvguard_read',{file_path:'link/source.txt'})).isError,true);
  }else{
    symlinkSync(join(f.workspace,'source.txt'),join(f.workspace,'link.txt'));
    assert.equal((await f.execute('rvguard_read',{file_path:'link.txt'})).isError,true);
  }
});
test('plugin lease rejects another owner and releases cleanly',t=>{
  const temp=mkdtempSync(join(tmpdir(),'rvguarder-lease-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const release=acquireLease(temp);assert.throws(()=>acquireLease(temp),/already owned/);release();acquireLease(temp)();
});
test('degraded outbox survives restart and replays idempotent events',async t=>{
  const temp=mkdtempSync(join(tmpdir(),'rvguarder-degraded-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const outbox=new DegradedOutbox(temp);outbox.push({instance_id:'test',session_id:'s',call_id:'c',tool_name:'probe',time:Date.now()/1000,stage:'bypass',reason:'bridge_unavailable'});
  let calls=0;await assert.rejects(outbox.flush({post:async()=>{throw new Error('offline');}}));
  await new DegradedOutbox(temp).flush({post:async(path,event)=>{assert.equal(path,'degraded');assert.equal(event.call_id,'c');calls++;return {ok:true};}});
  assert.equal(calls,1);assert.deepEqual(JSON.parse(readFileSync(join(temp,'degraded.json'),'utf8')),[]);
});

test('real Node PTC scheduler routes inner controlled reads through Guard',async t=>{
  const f=await fixture(t,{ptc:true});
  const result=await f.execute('run_code',{code:"const values = await Promise.all([tools.rvguard_read({file_path:'source.txt'}),tools.rvguard_read({file_path:'source.txt'})]);return values.length;",description:'Read isolated fixture twice'});
  if(result.isError && /SANDBOX_UNAVAILABLE|no usable sandbox|sandbox.unavailable/i.test(JSON.stringify(result))){t.skip('Real sandbox unavailable; PTC is not accepted as verified on this machine');return;}
  assert.equal(result.isError,false,JSON.stringify(result));
  // A native call after the transport is rejected by the real PTC presentation.
  assert.equal((await f.execute('rvguard_read',{file_path:'source.txt'})).isError,true);
  const summary=await f.api('summary');const inner=summary.actions.items.filter(a=>a.event?.metadata?.dsh?.tool_name==='rvguard_read');
  assert.equal(inner.length,2);assert.ok(inner.every(a=>a.event.metadata.dsh.parent_call_id));
});

async function localDestination(t){
  const dir=mkdtempSync(join(tmpdir(),'rvguarder-tls-')),key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
  const created=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-keyout',key,'-out',cert],{encoding:'utf8'});
  assert.equal(created.status,0,created.stderr);const received=[];
  const server=createHttpsServer({key:readFileSync(key),cert:readFileSync(cert)},async(req,res)=>{const data=[];for await(const chunk of req)data.push(chunk);received.push(Buffer.concat(data));res.writeHead(200).end('accepted');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
  return {url:'https://127.0.0.1:'+server.address().port+'/approved',caFile:cert,received};
}
test('exact allowlisted HTTPS and one-call host grant send actual snapshot bytes',async t=>{
  const target=await localDestination(t),f=await fixture(t,{egress:target});
  f.onApproval(()=>f.grant());
  const result=await f.execute('rvguard_send',{file_path:'source.txt',url:target.url});
  assert.equal(result.isError,false,JSON.stringify(result));assert.equal(target.received.length,1);assert.equal(target.received[0].toString(),'hello\r\nworld');
});
test('missing or revoked host grants stop before any HTTPS body',async t=>{
  const target=await localDestination(t),f=await fixture(t,{egress:target});
  assert.equal((await f.execute('rvguard_send',{file_path:'source.txt',url:target.url})).isError,true);assert.equal(target.received.length,0);
  f.onApproval(()=>f.grant(true));
  assert.equal((await f.execute('rvguard_send',{file_path:'source.txt',url:target.url})).isError,true);assert.equal(target.received.length,0);
});
test('empty allowlist has no send tool and different exact path is denied',async t=>{
  const f=await fixture(t);assert.equal(f.ctx.tools.get('rvguard_send'),undefined);
  const target=await localDestination(t),enabled=await fixture(t,{egress:target});
  assert.equal((await enabled.execute('rvguard_send',{file_path:'source.txt',url:target.url+'/different'})).isError,true);assert.equal(target.received.length,0);
});

test('native read access evidence is recorded separately from byte lineage',async t=>{
  const f=await fixture(t);assert.equal((await f.execute('read',{file_path:'source.txt'})).isError,false);
  await f.execute('rvguard_read',{file_path:'source.txt'});
  const caps=await f.api('dsh/capabilities');assert.equal(caps.evidence.access_receipts,1);
});

test('SDK delegation metadata preserves parent linkage without sharing child authority',async t=>{
  const f=await fixture(t);const child={id:'child-session',ctx:f.ctx,session:f.ctx.sessions.create('child-session',{meta:childSessionMeta(f.agent,1,false)})};
  const result=await f.ctx.tools.execute({name:'rvguard_read',arguments:{file_path:'source.txt'},agent:child,callId:'child-read',signal:new AbortController().signal});
  assert.equal(result.isError,false,JSON.stringify(result));
  const summary=await f.api('summary');const action=summary.actions.items.find(a=>a.event?.metadata?.dsh?.agent_id==='child-session');
  assert.equal(action.event.metadata.dsh.parent_agent_id,'session-1');assert.equal(action.event.metadata.trusted_identity.agent_id,'dsh-agent:child-session');
});
test('ten parallel controlled calls retain unique identities and byte receipts',async t=>{
  const f=await fixture(t);const results=await Promise.all(Array.from({length:10},()=>f.execute('rvguard_read',{file_path:'source.txt'})));
  assert.ok(results.every(r=>r.isError===false),JSON.stringify(results));
  await f.execute('rvguard_read',{file_path:'source.txt'});
  const caps=await f.api('dsh/capabilities');assert.ok(caps.evidence.content_receipts>=10);
});
