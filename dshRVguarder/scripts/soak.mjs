/** 隔离的实际SDK+Python稳定性探针；默认2小时、每10秒一批，不调用在线模型。 */
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Context,Service} from '@deepseek-ai/cordis';
import {SystemPrompt} from '@deepseek-ai/dsh-system-prompt';
import {ToolRuntime} from '@deepseek-ai/dsh-tools';
import {apply} from '../dist/index.js';
const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,all)=>index%2?pairs:[...pairs,[value,all[index+1]]],[]));
const duration=Number(args['--duration-seconds']??7200),interval=Number(args['--interval-seconds']??10),concurrency=Number(args['--concurrency']??1);
if(!Number.isInteger(duration)||duration<1||duration>7200||!Number.isInteger(interval)||interval<1||interval>60||!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw new Error('Invalid bounded soak configuration');
const root=fileURLToPath(new URL('../../',import.meta.url)),temp=mkdtempSync(join(tmpdir(),'rvguarder-soak-')),workspace=join(temp,'workspace'),project=join(temp,'guard'),home=join(temp,'home');
mkdirSync(workspace);mkdirSync(join(home,'profiles','web'),{recursive:true});writeFileSync(join(home,'profiles','web','package.json'),JSON.stringify({dsh:{profile:{bundles:[]}}}));writeFileSync(join(workspace,'probe.txt'),'isolated soak bytes');
const child=spawn('python',['-m','clawRVguarder.hosts.dsh.server','--project-dir',project,'--dsh-home',home,'--workspace',workspace,'--semantic-mode','local','--port','0'],{cwd:root,env:{...process.env,DEEPSEEK_API_KEY:''},stdio:['ignore','pipe','pipe']});
let cleanup,failures=0,completed=0,maxBackendRss=0;const timings=[];let startupTimer;
try{
  const url=await new Promise((resolve,reject)=>{let text='';startupTimer=setTimeout(()=>reject(new Error('Soak backend startup timeout')),10000);child.once('exit',()=>reject(new Error('Soak backend exited')));child.stdout.on('data',chunk=>{text+=chunk;for(const line of text.split('\n'))try{const item=JSON.parse(line);if(item.url){clearTimeout(startupTimer);resolve(item.url);return;}}catch{}});child.stderr.on('data',()=>{});});
  const ctx=new Context();new SystemPrompt(ctx,{});new ToolRuntime(ctx,{});const cwd=new Service(ctx,'workingDirectory');cwd.ensure=async()=>workspace;
  const approval=new Service(ctx,'approval');approval.request=async()=>{throw new Error('Read-only soak must not require approval');};
  ctx.tools.register({name:'read',description:'Isolated real file read',parameters:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']},isConcurrencySafe:()=>true,
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute:async()=>readFileSync(join(workspace,'probe.txt'),'utf8')});
  cleanup=apply(ctx,{backendUrl:url,tokenFile:join(project,'runtime','dsh-token'),instanceId:'dsh-local',stateDir:join(temp,'plugin')});
  const agent={id:'soak-session'},start=performance.now();
  do{
    await Promise.all(Array.from({length:concurrency},async()=>{const before=performance.now();const result=await ctx.tools.execute({name:'read',arguments:{file_path:'probe.txt'},agent,callId:crypto.randomUUID(),signal:new AbortController().signal});timings.push(performance.now()-before);completed++;if(result.isError)failures++;}));
    try{const status=readFileSync('/proc/'+child.pid+'/status','utf8');maxBackendRss=Math.max(maxBackendRss,Number(status.match(/VmRSS:\s+(\d+)/)?.[1]??0));}catch{}
    const remaining=duration*1000-(performance.now()-start);if(remaining<=0)break;
    await new Promise(r=>setTimeout(r,Math.min(interval*1000,remaining)));
  }while(performance.now()-start<duration*1000);
  await cleanup();cleanup=undefined;const sorted=[...timings].sort((a,b)=>a-b);
  const report={duration_seconds:duration,interval_seconds:interval,concurrency,completed,failures,mean_ms:timings.reduce((a,b)=>a+b,0)/timings.length,p95_ms:sorted[Math.ceil(sorted.length*.95)-1],max_backend_rss_kib:maxBackendRss};
  if(args['--report'])writeFileSync(args['--report'],JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(report));if(failures)process.exitCode=2;
}finally{
  clearTimeout(startupTimer);if(cleanup)await cleanup();child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);setTimeout(()=>{child.kill('SIGKILL');r();},5000).unref();});rmSync(temp,{recursive:true,force:true});
}
