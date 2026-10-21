/** 版本化宿主桥接协议；身份来自 DSH 执行上下文。 */
export const protocol = 'dsh-guard-v2' as const;
export interface GuardCall {
  protocol: typeof protocol; instance_id: string; session_id: string; agent_id: string;
  parent_call_id?:string; parent_agent_id?:string;
  call_id: string; root_call_id: string; tool_name: string; cwd: string; arguments: Record<string, unknown>; proposal?:Record<string,unknown>;
}
export interface GuardDecision {
  protocol: typeof protocol; instance_id: string; session_id: string; call_id: string;
  evidence_binding?:{principal_id:string;task_id:string};
  kind: 'allow' | 'ask' | 'deny'; reason: string; action_id: string; policy_version: string; expires_at: number;
}
export interface Completion { call: GuardCall; succeeded: boolean; dispatched: boolean; evidence?:Record<string,unknown>; }
