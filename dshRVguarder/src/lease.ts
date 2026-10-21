/** 插件实例目录独占；崩溃后的锁只在确认原 PID 已退出时回收。 */
import {mkdirSync,readFileSync,writeFileSync,rmSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
export function acquireLease(directory:string):()=>void {
  mkdirSync(directory,{recursive:true,mode:0o700});
  if(lstatSync(directory).isSymbolicLink()) throw new Error('State directory must not be symlink');
  const path=join(directory,'owner.lock');
  const take=()=>{mkdirSync(path,{mode:0o700});writeFileSync(join(path,'pid'),String(process.pid),{mode:0o600,flag:'wx'});};
  try {take();} catch(error) {
    if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error;
    if(lstatSync(path).isSymbolicLink()) throw new Error('Invalid plugin owner lock');
    const pid=Number(readFileSync(join(path,'pid'),'utf8'));
    if(!Number.isInteger(pid)||pid<=0) throw new Error('Invalid plugin owner PID; reconcile before startup');
    try {process.kill(pid,0);throw new Error('DSH plugin state directory already owned');}
    catch(check) {if((check as NodeJS.ErrnoException).code!=='ESRCH') throw check;}
    throw new Error('Previous plugin owner exited; inspect outbox and explicitly remove stale owner.lock before restart');
  }
  let released=false;
  return ()=>{if(!released){released=true;rmSync(path,{recursive:true});}};
}
