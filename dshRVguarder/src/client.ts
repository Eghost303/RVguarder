/** 认证本机 HTTP 通道，有界等待与上下文校验，不重跑工具。 */
import { readFileSync } from 'node:fs';
import { protocol, type GuardCall, type GuardDecision } from './protocol.js';
import {sdkVersion} from './sdk.js';
export class BridgeUnavailable extends Error {}
export class GuardClient {
  private helloAt=0;
  semanticMode:'auto'|'local'|'llm'|'host-agent'='auto';
  private helloRun?: Promise<void>;
  readonly base: string;
  readonly token: string;
  constructor(base: string, tokenFile: string, readonly timeoutMs = 5000) {
    const url = new URL(base);
    if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Guard backend must use a loopback HTTP origin');
    this.base = url.origin;
    this.token = readFileSync(tokenFile,'utf8').trim();
    if (this.token.length < 32) throw new Error('Invalid Guard token');
  }
  async post(path: string, body: unknown, signal?: AbortSignal, budgetMs = this.timeoutMs): Promise<Record<string,unknown>> {
    const started = performance.now();
    let response: Response;
    try { response = await fetch(this.base+'/api/dsh/'+path, { method:'POST', redirect:'error',
      headers:{'Content-Type':'application/json','x-rvguarder-token':this.token}, body:JSON.stringify(body),
      signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(budgetMs)]) : AbortSignal.timeout(budgetMs) }); } catch { this.helloAt=0;throw new BridgeUnavailable('Guard connection unavailable'); }
    if (response.status >= 500) {this.helloAt=0;throw new BridgeUnavailable('Guard service unavailable');}
    if (!response.ok) throw new Error(`Guard bridge returned HTTP ${response.status}`);
    const result = await response.json() as Record<string,unknown>;
    if (process.env.RVGUARDER_DSH_TIMINGS === '1') console.error(JSON.stringify({ event: 'dsh.bridge.http', stage: path, elapsed_ms: Math.round((performance.now() - started) * 100) / 100 }));
    if (!result || typeof result !== 'object') throw new Error('Invalid Guard response');
    return result;
  }
  async hello(instanceId: string,force=false) {
    if(this.helloRun) return this.helloRun;
    if(!force && Date.now()-this.helloAt<5000)return;
    this.helloRun=(async()=>{
      const r = await this.post('hello',{protocol,instance_id:instanceId,sdk_version:sdkVersion});
      if (r.protocol !== protocol || r.instance_id !== instanceId || r.recovery_required !== false) throw new Error('Guard handshake rejected or requires recovery');
      if(['auto','local','llm','host-agent'].includes(String(r.semantic_mode))) this.semanticMode=r.semantic_mode as GuardClient['semanticMode'];
      this.helloAt=Date.now();
    })().finally(()=>{this.helloRun=undefined;});
    return this.helloRun;
  }
  async before(call: GuardCall, signal: AbortSignal): Promise<GuardDecision> {
    const r = await this.post('before',call,signal);
    if (r.protocol !== protocol || r.instance_id !== call.instance_id || r.session_id !== call.session_id || r.call_id !== call.call_id || !['allow','ask','deny'].includes(String(r.kind)) || typeof r.reason !== 'string' || typeof r.action_id !== 'string' || typeof r.policy_version !== 'string' || typeof r.expires_at !== 'number' || !Number.isFinite(r.expires_at) || r.expires_at*1000 < Date.now()) throw new Error('Guard decision context/protocol/expiry mismatch');
    return r as unknown as GuardDecision;
  }
  async prepareSemantic(call: GuardCall, signal: AbortSignal): Promise<{available:boolean;reason?:string;request_id?:string;prompt?:string;expires_at?:number}> {
    const r = await this.post('semantic/prepare',call,signal);
    if(r.available!==true) return {available:false,reason:typeof r.reason==='string'?r.reason:'unavailable'};
    if(typeof r.request_id!=='string'||r.request_id.length<16||r.request_id.length>128||typeof r.prompt!=='string'||typeof r.expires_at!=='number'||r.expires_at*1000<Date.now()) throw new Error('Invalid host semantic preparation');
    return {available:true,request_id:r.request_id,prompt:r.prompt,expires_at:r.expires_at};
  }
  async submitSemantic(requestId:string,call:GuardCall,response:string,signal:AbortSignal):Promise<boolean> {
    if(Buffer.byteLength(response,'utf8')>16*1024) return false;
    const r=await this.post('semantic/submit',{request_id:requestId,call,response},signal);
    return r.ok===true;
  }
}
