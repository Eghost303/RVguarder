/** 仅在新建临时目录验证真实文件写入边界，禁止自定义命令或目标。 */
import {mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const install=process.argv[2];if(!install)throw new Error('Provide fixed DSH installation root');
const load=name=>import(pathToFileURL(join(install,'node_modules','@deepseek-ai',name,'lib','index.js')).href);
const {Context}=await load('cordis');const {LocalSandboxProvider}=await load('dsh-sandbox-local');
const root=mkdtempSync(join(tmpdir(),'rvguarder-boundary-')),workspace=join(root,'workspace');mkdirSync(workspace);
const inside=join(workspace,'inside.txt'),outside=join(root,'outside.txt');
const ctx=new Context();
try {
  new LocalSandboxProvider(ctx,{runnerCommand:[],runnerFailureSignatures:[],probeTimeoutMs:3000});
  const code="const fs=require('node:fs');fs.writeFileSync(process.argv[1],'inside');let denied=false;try{fs.writeFileSync(process.argv[2],'outside');}catch{denied=true;}process.stdout.write(JSON.stringify({inside:true,outside_denied:denied}));process.exit(denied?0:8);";
  const confined=await ctx.sandbox.confine([process.execPath,'-e',code,inside,outside],{mode:'workspace-write',workspaceRoot:workspace});
  const child=spawnSync(confined.argv[0],confined.argv.slice(1),{cwd:workspace,encoding:'utf8',timeout:20000,windowsHide:true});
  let observation;try{observation=JSON.parse(child.stdout);}catch{}
  const result={platform:process.platform,enforcement:confined.enforcement,exit_code:child.status,inside_written:existsSync(inside),outside_written:existsSync(outside),observation:observation??null};
  console.log(JSON.stringify(result));
  if(!result.inside_written||result.outside_written||child.status!==0)process.exitCode=2;
} catch(error){console.log(JSON.stringify({platform:process.platform,status:'unavailable',reason:String(error?.code||error?.name||'sandbox_error')}));process.exitCode=3;}
finally {await ctx.fiber.dispose();rmSync(root,{recursive:true,force:true});}
