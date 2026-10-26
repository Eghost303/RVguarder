/** Windows 原生 Node + 已安装 DSH SDK + 真实 Python 服务的隔离桥接测试；不启动日常 profile。 */
import { pathToFileURL } from 'node:url';
import { join,basename,dirname } from 'node:path';
import { mkdtempSync,rmSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { apply } from '../dist/index.js';
import {sdkVersion} from '../dist/sdk.js';
const [sdkRoot,backendUrl,tokenFile,workspace,evidenceKeyFile]=process.argv.slice(2);
if(!workspace)throw new Error('Usage: windows-smoke.mjs <DSH installation> <backendURL> <tokenFile> <workspace>');
const load=name=>import(pathToFileURL(join(sdkRoot,'node_modules','@deepseek-ai',name,'lib','index.js')).href);
const {Context,Service}=await load('cordis');const {SystemPrompt}=await load('dsh-system-prompt');const {ToolRuntime,defineTool}=await load('dsh-tools');
const state=mkdtempSync(join(tmpdir(),'rvguarder-native-smoke-'));
const ctx=new Context();new SystemPrompt(ctx,{});new ToolRuntime(ctx,{});
const cwd=new Service(ctx,'workingDirectory');cwd.ensure=async()=>workspace;
const approval=new Service(ctx,'approval');let asked=0;approval.request=async()=>{asked++;return 'allowed-once';};
let bodies=0;
for(const name of ['read','write','bash'])ctx.tools.register(defineTool({name,description:'isolated no-I/O probe',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(){bodies++;return 'synthetic success; no host file operations';}}));
const cleanup=apply(ctx,{backendUrl,tokenFile,instanceId:'dsh-windows-smoke',stateDir:state,...(evidenceKeyFile?{evidenceKeyFile}:{})});
const agent={id:'windows-smoke-'+randomUUID()};
const invoke=(name,args)=>ctx.tools.execute({name,arguments:args,callId:randomUUID(),agent,signal:new AbortController().signal});
try {
 const read=await invoke('read',{file_path:'rvguarder-probe.txt'});assert.equal(read.isError,false,JSON.stringify(read));
 const write=await invoke('write',{file_path:'rvguarder-probe.txt',content:'synthetic'});assert.equal(write.isError,false,JSON.stringify(write));assert.ok(asked>0);
 const before=bodies;const deny=await invoke('bash',{command:'rm -rf /'});assert.equal(deny.isError,true);assert.equal(bodies,before);
 const timings=[];
 for(let i=0;i<20;i++){const started=performance.now();const result=await invoke('read',{file_path:'benchmark.txt'});assert.equal(result.isError,false);timings.push(performance.now()-started);}
 if(evidenceKeyFile){
  if(!basename(dirname(workspace)).startsWith('rvguarder-v2-'))throw new Error('Controlled smoke requires isolated temporary workspace');
  writeFileSync(join(workspace,'controlled-source.txt'),'native Windows bytes\r\n');
  const source=await invoke('rvguard_read',{file_path:'controlled-source.txt'});assert.equal(source.isError,false,JSON.stringify(source));
  const copy=await invoke('rvguard_copy',{file_path:'controlled-source.txt',destination:'controlled-copy.txt'});assert.equal(copy.isError,false,JSON.stringify(copy));
  assert.equal(readFileSync(join(workspace,'controlled-copy.txt'),'utf8'),'native Windows bytes\r\n');
 }
 await cleanup();
 const sorted=[...timings].sort((a,b)=>a-b);
 const benchmark={samples:timings.length,mean_ms:Number((timings.reduce((a,b)=>a+b,0)/timings.length).toFixed(2)),p95_ms:Number(sorted[Math.ceil(sorted.length*.95)-1].toFixed(2))};
 console.log(JSON.stringify({platform:process.platform,node:process.version,sdk:sdkVersion,read:'allow',write:'native-ask-approved',destructiveCommand:'denied-before-body',syntheticToolBodies:bodies,controlledLocalBytes:evidenceKeyFile?'verified':'not-tested',localSdkRoundtrip:benchmark}));
} finally {await cleanup();rmSync(state,{recursive:true,force:true});}
