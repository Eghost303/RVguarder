/** 受控文件操作与精确白名单外发：签名实际处理字节，不从普通工具文本推断血缘。 */
import type {Context} from '@deepseek-ai/cordis';
import {constants,openSync,closeSync,readFileSync,readSync,writeFileSync,fstatSync,realpathSync,existsSync,fsyncSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {request as httpsRequest} from 'node:https';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import type {GuardCall,GuardDecision} from './protocol.js';
const operations:Record<string,string>={rvguard_read:'file.read',rvguard_copy:'file.write',rvguard_transform:'file.write'};
export function canonical(value:unknown):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
}
function readBounded(fd:number):Buffer {
  const bytes=Buffer.alloc(262145);let size=0;
  while(size<bytes.length){const count=readSync(fd,bytes,size,bytes.length-size,null);if(!count)break;size+=count;}
  if(size>262144)throw new Error('Controlled resource exceeds snapshot budget');
  return bytes.subarray(0,size);
}
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
interface Entry {call:GuardCall;bytes:Buffer;root:string;source:Record<string,unknown>;proposal:Record<string,unknown>;binding?:{principal_id:string;task_id:string};receipt?:Record<string,unknown>;permit?:{grant_id:string;snapshot_id:string};}
/** 只允许工作区内完整小文件；路径逃逸、符号链接和变更均拒绝。 */
export class ControlledTools {
  private entries=new Map<object,Entry>();private key:Buffer;private disposers:Array<()=>boolean|void>=[];
  constructor(ctx:Context,keyFile:string,private allowlist:readonly string[]=[],private caFile?:string) {
    this.key=readFileSync(keyFile);if(this.key.length!==32)throw new Error('Invalid controlled evidence key');
    for(const url of allowlist){const parsed=new URL(url);if(parsed.protocol!=='https:'||!parsed.hostname||parsed.username||parsed.password||parsed.hash||parsed.hostname.includes('*')||parsed.href!==url)throw new Error('Invalid exact HTTPS allowlist');}
    const names=[...Object.keys(operations),...(allowlist.length?['rvguard_send']:[])];
    for(const name of names) {
      const properties:Record<string,unknown>={file_path:{type:'string'}};const required=['file_path'];
      if(name==='rvguard_send'){properties.url={type:'string',enum:allowlist};required.push('url');}
      else if(name!=='rvguard_read'){properties.destination={type:'string'};required.push('destination');}
      if(name==='rvguard_transform'){properties.transform={type:'string',enum:['normalize_newlines']};required.push('transform');}
      this.disposers.push(ctx.tools.register({name,description:'RVguarder controlled complete-file operation (max 256 KiB); '+name,
        parameters:{type:'object',properties,required,additionalProperties:false},isConcurrencySafe:()=>name==='rvguard_read',
        output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async(_args,exec)=>this.run(exec.token,exec.signal)}));
    }
  }
  private signed(payload:Record<string,unknown>){return {payload,signature:createHmac('sha256',this.key).update(canonical(payload)).digest('hex')};}
  private path(root:string,value:unknown,output=false):{path:string;id:string} {
    if(typeof value!=='string'||!value||isAbsolute(value)||value.includes('\\')||value.split('/').some(p=>p==='..'||p==='.'||!p)||value.includes(':'))throw new Error('Controlled path must be canonical workspace-relative');
    const path=resolve(root,value);const rel=relative(root,path);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('Controlled path outside workspace');
    let current=root;
    for(const part of rel.split(sep)){current=resolve(current,part);if(!existsSync(current)){if(output&&current===path)break;throw new Error('Missing controlled resource');}if(realpathSync(current)!==current)throw new Error('Controlled resource symlink/reparse path');}
    return {path,id:'workspace:'+value};
  }
  prepare(token:object,call:GuardCall):void {
    if(call.tool_name==='read'){
      // 普通 read 只观察访问前后的版本；不声称这些字节进入模型。
      try{this.prepareNative(token,call);}catch{/* 不支持的路径不产生访问收据，普通门禁继续。 */}
      return;
    }
    if(!operations[call.tool_name]&&call.tool_name!=='rvguard_send')return;
    if(call.tool_name==='rvguard_send'&&!this.allowlist.includes(String(call.arguments.url)))throw new Error('Destination outside exact host HTTPS allowlist');
    if(this.entries.size>=64)throw new Error('Controlled snapshot budget exhausted');
    const root=realpathSync(call.cwd),source=this.path(root,call.arguments.file_path);
    const fd=openSync(source.path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let bytes:Buffer;
    try{const info=fstatSync(fd);if(!info.isFile()||info.size>262144)throw new Error('Controlled resource must be bounded regular file');bytes=readBounded(fd);if(bytes.length>262144)throw new Error('Resource grew beyond limit');}finally{closeSync(fd);}
    const version={namespace:'workspace',resource_id:source.id,sha256:hash(bytes),size_bytes:bytes.length,full_resource:true,offset:0};
    const destination=call.tool_name==='rvguard_send'?call.arguments.url:call.arguments.destination;
    if(destination!==undefined&&call.tool_name!=='rvguard_send')this.path(root,destination,true);
    if(call.tool_name==='rvguard_transform'&&call.arguments.transform!=='normalize_newlines')throw new Error('Unsupported controlled transform');
    const now=Date.now();const proposal={purpose:'dsh_snapshot_v2',snapshot_id:randomUUID(),instance_id:call.instance_id,session_id:call.session_id,agent_id:call.agent_id,
      call_id:call.call_id,root_call_id:call.root_call_id,tool_name:call.tool_name,arguments_sha256:hash(canonical(call.arguments)),source:version,destination:destination??null,issued_at_ms:now,expires_at_ms:now+300000};
    call.proposal=this.signed(proposal);this.entries.set(token,{call,bytes,root,source:version,proposal});
  }
  private prepareNative(token:object,call:GuardCall){
    if(this.entries.size>=64)return;
    const root=realpathSync(call.cwd),source=this.path(root,call.arguments.file_path);
    const fd=openSync(source.path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let bytes:Buffer;
    try{if(!fstatSync(fd).isFile())return;bytes=readBounded(fd);}finally{closeSync(fd);}
    const version={namespace:'workspace',resource_id:source.id,sha256:hash(bytes),size_bytes:bytes.length,full_resource:true,offset:0};
    this.entries.set(token,{call,bytes,root,source:version,proposal:{arguments_sha256:hash(canonical(call.arguments))}});
  }
  observeNative(token:object,content:unknown):Record<string,unknown>|undefined{
    const item=this.entries.get(token);if(item?.call.tool_name!=='read'||!item.binding)return;
    try{
      const source=this.path(item.root,item.call.arguments.file_path);const fd=openSync(source.path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let same=false;
      try{same=fstatSync(fd).isFile()&&hash(readBounded(fd))===item.source.sha256;}finally{closeSync(fd);}
      const rendered=Buffer.from(canonical(content));if(!same||rendered.length>262144)return;
      const now=Date.now();return this.signed({format_version:1,receipt_id:randomUUID(),issuer:'dsh-controlled-v2',...item.binding,
        agent_id:item.call.agent_id,session_id:item.call.session_id,run_id:item.call.root_call_id,tool_call_id:item.call.call_id,tool_name:'read',operation_family:'file.read',
        arguments_sha256:item.proposal.arguments_sha256,kind:'read_access',observation:'observed_before_after',accessed_resource:item.source,
        details_content_sha256:hash(rendered),details_content_size_bytes:rendered.length,inputs:[],outputs:[],issued_at_ms:now,expires_at_ms:now+300000,success:true});
    }catch{return;}
  }
  bind(token:object,decision:GuardDecision){const item=this.entries.get(token);if(item){if(!decision.evidence_binding)throw new Error('Missing trusted evidence binding');item.binding=decision.evidence_binding;}}
  permitted(token:object,value:unknown){const item=this.entries.get(token);if(item&&value&&typeof value==='object'&&'grant_id' in value&&'snapshot_id' in value)item.permit=value as {grant_id:string;snapshot_id:string};}
  private async send(item:Entry,signal:AbortSignal):Promise<number>{
    const url=String(item.call.arguments.url);
    if(!this.allowlist.includes(url)||!item.permit||item.permit.snapshot_id!==item.proposal.snapshot_id)throw new Error('Missing exact allowlisted host permit');
    return new Promise((resolve,reject)=>{
      const req=httpsRequest(new URL(url),{method:'POST',signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]),timeout:5000,ca:this.caFile?readFileSync(this.caFile):undefined,
        headers:{'Content-Type':'application/octet-stream','Content-Length':item.bytes.length}},res=>{
          res.resume();res.once('error',reject);res.once('end',()=>{const status=res.statusCode??0;if(status<200||status>=300)reject(new Error('Destination did not acknowledge success; redirects are not followed'));else resolve(status);});
        });
      req.once('timeout',()=>req.destroy(new Error('Controlled send timed out; do not retry automatically')));req.once('error',reject);req.end(item.bytes);
    });
  }
  private async run(token:object,signal:AbortSignal) {
    const item=this.entries.get(token);if(!item?.binding)throw new Error('Controlled snapshot not prepared');
    signal.throwIfAborted();if(Date.now()>Number(item.proposal.expires_at_ms))throw new Error('Snapshot expired');
    const current=this.path(item.root,item.call.arguments.file_path);
    const fd=openSync(current.path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let same=false;
    try{const st=fstatSync(fd);same=st.isFile()&&st.size===item.bytes.length&&hash(readBounded(fd))===item.source.sha256;}finally{closeSync(fd);}
    if(!same)throw new Error('Controlled resource changed after approval');
    const outputs:Array<Record<string,unknown>>=[];let result:Record<string,unknown>={};const name=item.call.tool_name;let kind='read';
    if(name==='rvguard_read')result={encoding:'base64',data:item.bytes.toString('base64')};
    else if(name==='rvguard_send'){kind='egress';result={status:await this.send(item,signal)};}
    else{
      kind=name==='rvguard_copy'?'copy':'transform';
      const bytes=kind==='copy'?item.bytes:Buffer.from(new TextDecoder('utf-8',{fatal:true}).decode(item.bytes).replace(/\r\n?/g,'\n'));
      const dest=this.path(item.root,item.call.arguments.destination,true);
      const output=openSync(dest.path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);
      try{signal.throwIfAborted();writeFileSync(output,bytes);fsyncSync(output);}finally{closeSync(output);}
      outputs.push({namespace:'workspace',resource_id:dest.id,sha256:hash(bytes),size_bytes:bytes.length,full_resource:true,offset:0});result={destination:item.call.arguments.destination,size_bytes:bytes.length};
    }
    const now=Date.now();item.receipt=this.signed({format_version:1,receipt_id:randomUUID(),issuer:'dsh-controlled-v2',...item.binding,
      agent_id:item.call.agent_id,session_id:item.call.session_id,run_id:item.call.root_call_id,tool_call_id:item.call.call_id,tool_name:name,operation_family:name==='rvguard_send'?'network.egress':operations[name],
      arguments_sha256:item.proposal.arguments_sha256,kind,inputs:[item.source],outputs,issued_at_ms:now,expires_at_ms:now+300000,success:true});
    return result;
  }
  finish(token:object):Record<string,unknown>|undefined{const item=this.entries.get(token);this.entries.delete(token);if(!item)return;item.bytes.fill(0);return item.receipt;}
  close(){for(const token of this.entries.keys())this.finish(token);for(const dispose of this.disposers)dispose();this.key.fill(0);}
}
