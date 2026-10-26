/** 从实际解析的宿主 SDK 读取版本；不伪造握手版本或接受未经验证的新版本。 */
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const versions=['@deepseek-ai/dsh-tools','@deepseek-ai/dsh-agent','@deepseek-ai/dsh-working-directory'].map(name=>require(name+'/package.json').version as string);
if(!versions.every(version=>version===versions[0])||!['0.2.1-rc.2','0.2.1-rc.3'].includes(versions[0]))throw new Error('Unsupported or mixed DSH SDK versions');
export const sdkVersion=versions[0];
