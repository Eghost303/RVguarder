/** 将指定 DSH 安装中的 SDK 暴露给本地开发；不修改 DSH 安装。 */
import { readFileSync,existsSync,mkdirSync,symlinkSync,lstatSync } from 'node:fs';
import { resolve,join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const installation=process.argv[2]||process.env.DSH_INSTALL_ROOT;
if(!installation) throw new Error('Usage: node scripts/link-sdk.mjs <DSH installation root>');
const root=resolve(installation);
const metadata=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
if(metadata.name!=='@deepseek-ai/dsh'||metadata.version!=='0.2.1-rc.2') throw new Error('Expected DSH 0.2.1-rc.2 installation');
const source=join(root,'node_modules','@deepseek-ai');
const target=resolve(dirname(fileURLToPath(import.meta.url)),'../node_modules/@deepseek-ai');
mkdirSync(dirname(target),{recursive:true});
if(existsSync(target)) {
  if(!lstatSync(target).isSymbolicLink()) throw new Error('SDK target already exists; refusing to overwrite installed packages');
  console.log('SDK link already present; check installation path before building.');
} else {symlinkSync(source,target,process.platform==='win32'?'junction':'dir');console.log('Linked SDK for DSH '+metadata.version);}
