import {atomicJson} from './durable.js';
/** 完成事件先同步落盘再补交；每次前置决策先排空，故障保留事件。 */
import { existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { Completion, GuardCall } from './protocol.js';
import type { GuardClient } from './client.js';
export class Outbox {
  private items: Completion[];
  private draining?: Promise<void>;
  private readonly file: string;
  private readonly executionsFile: string;
  private executions: GuardCall[];
  readonly recoveryRequired: boolean;
  constructor(directory: string) {
    mkdirSync(directory,{recursive:true,mode:0o700});
    if (lstatSync(directory).isSymbolicLink()) throw new Error('Outbox directory must not be a symlink');
    this.file=join(directory,'completions.json');
    this.executionsFile=join(directory,'executions.json');
    if (existsSync(this.file) && lstatSync(this.file).isSymbolicLink()) throw new Error('Outbox must not be a symlink');
    this.items=existsSync(this.file) ? JSON.parse(readFileSync(this.file,'utf8')) as Completion[] : [];
    if (this.items.some(item=>item.call?.protocol && item.call.protocol!=='dsh-guard-v2')) throw new Error('Drain legacy completions with matching v1 plugin before upgrade');
    if (!Array.isArray(this.items)) throw new Error('Corrupt Guard completion outbox');
    if (existsSync(this.executionsFile) && lstatSync(this.executionsFile).isSymbolicLink()) throw new Error('Execution journal must not be a symlink');
    this.executions=existsSync(this.executionsFile) ? JSON.parse(readFileSync(this.executionsFile,'utf8')) as GuardCall[] : [];
    if (!Array.isArray(this.executions)) throw new Error('Corrupt Guard execution journal');
    this.executions=this.executions.filter(call=>!this.items.some(item=>JSON.stringify(item.call)===JSON.stringify(call)));
    this.recoveryRequired=this.executions.length>0;
    this.saveExecutions();
  }
  private saveExecutions() {
    atomicJson(this.executionsFile,this.executions);
  }
  begin(call: GuardCall) {
    this.executions.push(call);this.saveExecutions();
  }
  settle(call: GuardCall) {
    this.executions=this.executions.filter(item=>JSON.stringify(item)!==JSON.stringify(call));this.saveExecutions();
  }
  private save() {
    atomicJson(this.file,this.items);
  }
  push(item: Completion) {
    if (this.items.length>=10000) throw new Error('Guard completion outbox full');
    this.items.push(item); this.save();
  }
  flush(client: GuardClient): Promise<void> {
    if (this.draining) return this.draining.then(()=>this.items.length ? this.flush(client) : undefined);
    this.draining=this.drain(client).finally(()=>{this.draining=undefined;});
    return this.draining;
  }
  private async drain(client: GuardClient) {
    while(this.items.length) {
      const r=await client.post('result',this.items[0]);
      if (r.ok!==true) throw new Error('Completion acknowledgement missing');
      this.items.shift(); this.save();
    }
  }
}
