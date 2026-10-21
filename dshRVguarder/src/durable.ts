/** 独立降级事件队列，不参与成功历史或授权；落盘失败只告警。 */
import {existsSync,readFileSync,writeFileSync,renameSync,openSync,fsyncSync,closeSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {GuardClient} from './client.js';
export interface DegradedEvent {id:string;instance_id:string;session_id:string;call_id:string;tool_name:string;time:number;stage:'bypass'|'result'|'audit_gap';succeeded?:boolean;reason:string;}
export function atomicJson(path:string,value:unknown) {
  const tmp=path+'.tmp';
  if((existsSync(path)&&lstatSync(path).isSymbolicLink())||(existsSync(tmp)&&lstatSync(tmp).isSymbolicLink())) throw new Error('Symlink in private state');
  const fd=openSync(tmp,'w',0o600);
  try {writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);} finally {closeSync(fd);}
  renameSync(tmp,path);
}
export class DegradedOutbox {
  private file:string;private items:DegradedEvent[];private draining?:Promise<void>;
  gap=false;
  constructor(directory:string){this.file=join(directory,'degraded.json');if(existsSync(this.file)&&lstatSync(this.file).isSymbolicLink())throw new Error('Invalid degraded journal');this.items=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):[];if(!Array.isArray(this.items))throw new Error('Corrupt degraded journal');}
  push(event:Omit<DegradedEvent,'id'>){try{if(this.items.length>=10000)throw new Error('Degraded journal full');this.items.push({...event,id:randomUUID()});atomicJson(this.file,this.items);}catch{this.gap=true;process.emitWarning('RVguarder fail-open audit gap: private journal unavailable');}}
  flush(client:GuardClient):Promise<void>{if(this.draining)return this.draining;this.draining=this.drain(client).finally(()=>{this.draining=undefined;});return this.draining;}
  private async drain(client:GuardClient){while(this.items.length){const ack=await client.post('degraded',this.items[0]);if(ack.ok!==true)throw new Error('Missing audit acknowledgement');this.items.shift();atomicJson(this.file,this.items);}}
}
