/** 宿主运行时探针：不导出配置、环境变量或密钥。 */
import type {Context} from '@deepseek-ai/cordis';
import {userInfo} from 'node:os';
import {spawnSync} from 'node:child_process';
import {sdkVersion} from './sdk.js';
import type {HostSemanticCapabilities} from './host-semantic.js';
export function hostProbe(ctx:Context,instanceId:string,stateDir:string,auditGap:boolean,hostAgent?:HostSemanticCapabilities) {
  const facts:Array<{key:string;state:string;evidence:string}>=[];
  const username=userInfo().username;
  facts.push({key:'ACCOUNT',state:process.platform==='win32'?'unknown':process.getuid?.()===0?'risk':'verified',evidence:process.platform==='win32'?'Windows token elevation requires native boundary probe':`uid=${process.getuid?.()};user=${username}`});
  facts.push({key:'APPROVAL',state:ctx.get('approval')?'unknown':'risk',evidence:ctx.get('approval')?'Native approval service registered; responder semantics tested separately':'Native approval service missing'});
  for(const key of ['PORTS','SANDBOX','WINDOWS','PLUGINS'])facts.push({key,state:'unknown',evidence:'Requires observed listener/sandbox boundary or package integrity verification'});
  if(process.platform==='win32') {
    const groups=spawnSync('whoami.exe',['/groups','/fo','csv','/nh'],{encoding:'utf8',timeout:3000,windowsHide:true});
    facts[0]={key:'ACCOUNT',state:groups.status===0?(/S-1-16-(12288|16384)/.test(groups.stdout)?'risk':'verified'):'unknown',evidence:groups.status===0?'Native Windows integrity-group query; elevated token classified as risk':'Native Windows identity query unavailable'};
    const acl=spawnSync('icacls.exe',[stateDir],{encoding:'utf8',timeout:3000,windowsHide:true});
    // icacls success proves availability, not exclusive ownership; do not misclassify as pass.
    facts.push({key:'PERMISSIONS',state:acl.status===0?'unknown':'unsupported',evidence:acl.status===0?'Windows ACL queried; effective access and restricted-token boundary not yet proven':'Windows ACL query unavailable'});
  }
  const sandbox=ctx.get('sandbox');
  const sandboxFact=facts.find(f=>f.key==='SANDBOX');
  if(sandboxFact)sandboxFact.evidence=sandbox?'Native sandbox provider registered; enforcement boundary still requires actual execution probe':'Native sandbox provider missing';
  return {instance_id:instanceId,sdk_version:sdkVersion,platform:process.platform,observed_at:Date.now()/1000,
    tools:ctx.tools.schemas().map(t=>t.name),facts,audit_gap:auditGap,
    host_agent:hostAgent??{subagents_available:false,preset_registry_available:false,provider_available:false,isolated_preset_ready:false,effective_tools_empty:false,provider_reason:'not_checked'}};
}
