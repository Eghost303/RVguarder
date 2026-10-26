/** 将指定 DSH 安装中的 SDK 暴露给本地开发；不修改 DSH 安装。 */
import { readFileSync,existsSync,mkdirSync,symlinkSync,lstatSync } from 'node:fs';
import { resolve,join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const installation=process.argv[2]||process.env.DSH_INSTALL_ROOT;
if(!installation) throw new Error('Usage: node scripts/link-sdk.mjs <DSH installation root>');
const root=resolve(installation);
const metadata=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
if(!['@deepseek-ai/dsh','@deepseek-ai/dsh-desktop-runtime'].includes(metadata.name)||!['0.2.1-rc.2','0.2.1-rc.3'].includes(metadata.version)) throw new Error('Expected DSH rc.2/rc.3 installation or extracted desktop SDK');
const source=join(root,'node_modules','@deepseek-ai');
for(const name of ['cordis','dsh-tools','dsh-agent','dsh-working-directory']) {
  const sdk=JSON.parse(readFileSync(join(source,name,'package.json'),'utf8'));
  if(sdk.version!==(name==='cordis'?'4.0.5':metadata.version))throw new Error('SDK version mismatch: '+name);
}
const target=resolve(dirname(fileURLToPath(import.meta.url)),'../node_modules/@deepseek-ai');
mkdirSync(dirname(target),{recursive:true});
if(existsSync(target)) {
  if(!lstatSync(target).isSymbolicLink()) throw new Error('SDK target already exists; refusing to overwrite installed packages');
  const {realpathSync}=await import('node:fs');
  if(realpathSync(target)!==realpathSync(source))throw new Error('SDK link points to another installation; remove only this development link before relinking');
  console.log('SDK link already matches DSH '+metadata.version);
} else {symlinkSync(source,target,process.platform==='win32'?'junction':'dir');console.log('Linked SDK for DSH '+metadata.version);}
