/** 创建独立 DSH web 测试 profile；拒绝覆盖任何已有 profile，不安装包或读取凭据。 */
import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join,resolve } from 'node:path';
const args=process.argv.slice(2),values={};
for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||!args[i+1])throw new Error('Expected --key value arguments');values[args[i].slice(2)]=args[i+1];}
const profile=values.profile||'rvguarder-dev',instanceId=values.instance||'dsh-dev';
if(!/^[a-zA-Z0-9_.-]{1,128}$/.test(profile)||['.','..','web','desktop'].includes(profile))throw new Error('Use a new dedicated test profile name');
if(!/^[a-zA-Z0-9_.-]{1,128}$/.test(instanceId))throw new Error('Invalid instance ID');
if(!values.token||!existsSync(values.token))throw new Error('Supply --token <existing backend token file>');
const backend=new URL(values.backend||'http://127.0.0.1:8781');
if(backend.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(backend.hostname)||backend.username||backend.password||backend.pathname!=='/'||backend.search||backend.hash)throw new Error('Backend must be a loopback origin');
const home=resolve(values.home||process.env.DSH_HOME||join(homedir(),'.dsh'));
const directory=join(home,'profiles',profile);
if(existsSync(directory))throw new Error('Refusing to overwrite existing profile: '+directory);
mkdirSync(directory,{recursive:true});
writeFileSync(join(directory,'package.json'),JSON.stringify({name:'rvguarder-profile-'+profile,private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}},dependencies:{}},null,2));
const config={backendUrl:backend.origin,instanceId,tokenFile:resolve(values.token),stateDir:resolve(values.state||join(homedir(),'.rvguarder','dsh-plugin',instanceId)),timeoutMs:5000,failMode:'closed'};
// JSON 是合法 YAML，明确使用本版本 patch DSL 的 insert/id 结构。
writeFileSync(join(directory,'cordis.patch.yml'),JSON.stringify([{insert:[{id:'rvguarder-dsh',name:'dsh-rvguarder',config}]}],null,2));
console.log(JSON.stringify({profile,directory,next:'Install the matching plugin tgz with dsh plugin --profile '+profile+' add <tgz>, then start this profile from your intended workspace.'}));
