/**
 * 旧 RVguarder 测试 profile 迁移：plain dependency + insert/id 启用 → bundle 层。
 * - 只修改 RVguarder 自己的条目和 bundle 选择；其他插件与用户配置保持不动。
 * - 先备份将修改的文件（package.json / cordis.patch.yml）。
 * - 未知形状报告具体差异，不整份覆盖；重复迁移幂等（已迁移则无副作用）。
 * - 不重建令牌、不更换实例身份、不清空完成历史。
 */
import { existsSync,mkdirSync,copyFileSync,readFileSync,writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join,resolve } from 'node:path';

const args=process.argv.slice(2),values={};
for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||!args[i+1])throw new Error('Expected --key value arguments');values[args[i].slice(2)]=args[i+1];}
const profile=values.profile||'rvguarder-dev';
if(!/^[a-zA-Z0-9_.-]{1,128}$/.test(profile)||['.','..','web','desktop'].includes(profile))throw new Error('Invalid profile name');
if(!values.token||!existsSync(values.token))throw new Error('Supply --token <existing backend token file>');
const backend=new URL(values.backend||'http://127.0.0.1:8781');
if(backend.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(backend.hostname)||backend.username||backend.password||backend.pathname!=='/'||backend.search||backend.hash)throw new Error('Backend must be a loopback origin');
const home=resolve(values.home||process.env.DSH_HOME||join(homedir(),'.dsh'));
const directory=join(home,'profiles',profile);
if(!existsSync(join(directory,'package.json')))throw new Error('Profile does not exist: '+directory);

/** 只读旧 patch 层中的 RVguarder insert 条目；返回 {patches, rvgEntry, index} 或抛差异说明。 */
function readOldPatch() {
  const patchPath=join(directory,'cordis.patch.yml');
  if(!existsSync(patchPath)) return {patches:[],rvgEntry:null,index:-1};
  const raw=readFileSync(patchPath,'utf8');
  let patches;
  try { patches=JSON.parse(raw); } catch { patches=null; }
  if(!Array.isArray(patches)) throw new Error('旧 cordis.patch.yml 不是可解析的 JSON 数组（YAML 用户请手工核对）；为避免误改拒绝迁移。');
  let index=-1, rvgEntry=null;
  for(let i=0;i<patches.length;i++){
    const patch=patches[i];
    if(!patch||typeof patch!=='object'||Array.isArray(patch)) throw new Error('patch 项 '+i+' 不是对象；拒绝迁移。');
    // id 定向覆盖（新形态）：记录位置供幂等判断，不进入 insert 解析。
    if(patch.id==='rvguarder-dsh'&&!Array.isArray(patch.insert)){ index=i; rvgEntry=patch; continue; }
    if(Array.isArray(patch.insert)&&patch.insert.some(row=>row&&row.id==='rvguarder-dsh')){
      if(patch.insert.length!==1) throw new Error('rvguarder 条目所在 patch 的 insert 数组不是恰好 1 项；请人工核对。');
      rvgEntry=patch.insert[0]; index=i;
    }
  }
  return {patches,rvgEntry,index};
}

const manifestPath=join(directory,'package.json');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const {patches,rvgEntry,index}=readOldPatch();

// 幂等：bundle 已选中且 patch 已是 id 定向覆盖 → 直接报告无副作用。
const alreadyBundle=(manifest.dsh?.profile?.bundles||[]).includes('dsh-rvguarder');
const alreadyOverridden=index>=0&&rvgEntry&&rvgEntry.config&&rvgEntry.name==='dsh-rvguarder'&&!Array.isArray(patches[index]?.insert);
if(alreadyBundle&&alreadyOverridden){ console.log(JSON.stringify({profile,migrated:false,reason:'already-bundle'})); process.exit(0); }

// 提取旧实例绑定：不重建令牌、不更换身份。
const oldConfig=(rvgEntry&&rvgEntry.config)||null;
const instanceId=(oldConfig&&oldConfig.instanceId)||values.instance||'dsh-dev';
if(!/^[a-zA-Z0-9_.-]{1,128}$/.test(instanceId))throw new Error('Invalid instance ID from old config');
const tokenFile=(oldConfig&&oldConfig.tokenFile)||resolve(values.token);
const stateDir=(oldConfig&&oldConfig.stateDir)||resolve(values.state||join(homedir(),'.rvguarder','dsh-plugin',instanceId));
const backendUrl=(oldConfig&&oldConfig.backendUrl)||backend.origin;
const timeoutMs=(oldConfig&&oldConfig.timeoutMs)||5000;
const failMode=(oldConfig&&oldConfig.failMode)||'closed';
if(failMode!=='closed'&&failMode!=='open')throw new Error('旧配置 failMode 非法：'+String(failMode));

// 备份（带时间戳，不覆盖既有备份）。
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backupDir=join(directory,'.rvguarder-migration-'+stamp);
mkdirSync(backupDir,{recursive:true});
copyFileSync(manifestPath,join(backupDir,'package.json'));
const patchPath=join(directory,'cordis.patch.yml');
if(existsSync(patchPath)) copyFileSync(patchPath,join(backupDir,'cordis.patch.yml'));

// 1) bundle 选择加入 dsh-rvguarder（保留其他 bundle 与字段）。
manifest.dsh=manifest.dsh||{};
manifest.dsh.profile=manifest.dsh.profile||{};
manifest.dsh.profile.bundles=[...new Set([...(manifest.dsh.profile.bundles||[]),'dsh-rvguarder'])];
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');

// 2) 用户层 patch：移除旧 insert 条目，写入两个 id 定向 config 覆盖。
const coreConfig={backendUrl,instanceId,tokenFile,stateDir,timeoutMs,failMode};
const adminConfig={backendUrl,instanceId,tokenFile,timeoutMs:8000};
let next;
if(index>=0){ next=[...patches]; next.splice(index,1,{id:'rvguarder-dsh',name:'dsh-rvguarder',config:coreConfig}); }
else { next=[...patches,{id:'rvguarder-dsh',name:'dsh-rvguarder',config:coreConfig}]; }
next.push({id:'rvguarder-admin',name:'dsh-rvguarder/admin',config:adminConfig});
// 去重：admin 覆盖若已存在则替换。
const seenAdmin=next.filter(p=>p&&p.id==='rvguarder-admin');
if(seenAdmin.length>1) next=next.filter(p=>!(p&&p.id==='rvguarder-admin')).concat(seenAdmin[seenAdmin.length-1]);
writeFileSync(patchPath,JSON.stringify(next,null,2)+'\n');

console.log(JSON.stringify({profile,migrated:true,backupDir,instanceId,bundleAdded:'dsh-rvguarder',rows:['rvguarder-dsh','rvguarder-admin'],tokenReused:true,historyPreserved:true,
  next:'在队列排空后用同一 profile 重新安装新 tgz（dsh plugin --profile '+profile+' add <tgz>），再重启该 profile。'}));
