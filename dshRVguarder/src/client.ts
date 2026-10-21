/** 认证本机 HTTP 通道，有界等待与上下文校验，不重跑工具。 */
import { readFileSync } from 'node:fs';
import { protocol, type GuardCall, type GuardDecision } from './protocol.js';
export class BridgeUnavailable extends Error {}
export class GuardClient {
  private helloAt=0;
  readonly base: string;
  readonly token: string;
  constructor(base: string, tokenFile: string, readonly timeoutMs = 5000) {
    const url = new URL(base);
    if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Guard backend must use a loopback HTTP origin');
    this.base = url.origin;
    this.token = readFileSync(tokenFile,'utf8').trim();
    if (this.token.length < 32) throw new Error('Invalid Guard token');
  }
  async post(path: string, body: unknown, signal?: AbortSignal): Promise<Record<string,unknown>> {
    let response: Response;
    try { response = await fetch(this.base+'/api/dsh/'+path, { method:'POST', redirect:'error',
      headers:{'Content-Type':'application/json','x-rvguarder-token':this.token}, body:JSON.stringify(body),
      signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs) }); } catch { this.helloAt=0;throw new BridgeUnavailable('Guard connection unavailable'); }
    if (response.status >= 500) {this.helloAt=0;throw new BridgeUnavailable('Guard service unavailable');}
    if (!response.ok) throw new Error(`Guard bridge returned HTTP ${response.status}`);
    const result = await response.json() as Record<string,unknown>;
    if (!result || typeof result !== 'object') throw new Error('Invalid Guard response');
    return result;
  }
  async hello(instanceId: string,force=false) {
    if(!force && Date.now()-this.helloAt<15000)return;
    const r = await this.post('hello',{protocol,instance_id:instanceId,sdk_version:'0.2.1-rc.2'});
    if (r.protocol !== protocol || r.instance_id !== instanceId || r.recovery_required !== false) throw new Error('Guard handshake rejected or requires recovery');
    this.helloAt=Date.now();
  }
  async before(call: GuardCall, signal: AbortSignal): Promise<GuardDecision> {
    const r = await this.post('before',call,signal);
    if (r.protocol !== protocol || r.instance_id !== call.instance_id || r.session_id !== call.session_id || r.call_id !== call.call_id || !['allow','ask','deny'].includes(String(r.kind)) || typeof r.reason !== 'string' || typeof r.action_id !== 'string' || typeof r.policy_version !== 'string' || typeof r.expires_at !== 'number' || !Number.isFinite(r.expires_at) || r.expires_at*1000 < Date.now()) throw new Error('Guard decision context/protocol/expiry mismatch');
    return r as unknown as GuardDecision;
  }
}
