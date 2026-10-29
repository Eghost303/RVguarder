/**
 * rvguarderAdmin Remote 契约（客户端半）：手工构造的严格 codec 贡献，
 * 与宿主侧 management.ts 的 @Remote 方法一一对应。
 *
 * 使用 @deepseek-ai/dsh-typert-protocol/remote-info 的 createTypertRemoteInfo
 * 装配；zod 来自平台 seed。所有参数与结果都经严格校验，无通用代理。
 */
import { z as zod } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import type { ZodTypeAny } from 'zod';

const z = zod;

type Codec = { mode: 'strict'; typeSymbol: string; create: () => ZodTypeAny; jsonSchema: Record<string, unknown> };
type ParameterSpec = { name: string; description?: string; source: 'json'; codec: Codec };
type MethodSpec = { service: string; description: string; invocation: { kind: 'direct' }; parameters: ParameterSpec[]; result: Codec };

/** 严格 codec 描述符工厂（jsonSchema 供宿主侧参数校验参考）。 */
function strictCodec(typeSymbol: string, create: () => ZodTypeAny, jsonSchema: Record<string, unknown>): Codec {
  return { mode: 'strict', typeSymbol, create, jsonSchema };
}

/** 方法定义工厂（direct 调用；service 指向宿主 TypertRemoteService 键）。 */
function definition(description: string, parameters: ParameterSpec[], result: Codec): MethodSpec {
  return { service: 'rvguarderAdmin', description, invocation: { kind: 'direct' }, parameters, result };
}

/** 构造可被 ctx.remote.$mount 消费的贡献对象（RemoteInfo 实例）。 */
export function createRemoteContribution() {
  return createTypertRemoteInfo({
    package: 'dsh-rvguarder',
    methods: {
      'rvguarderAdmin/overview': definition(
        '概览：后端连接状态与脱敏摘要。',
        [],
        strictCodec('dsh-rvguarder#rvguarderAdmin/overview:result', () => z.object({ ok: z.literal(true) }).passthrough(), { type: 'object' }),
      ),
      'rvguarderAdmin/actionDetail': definition(
        '动作详情（只读）。',
        [
          { name: 'actionId', description: '动作编号。', source: 'json', codec: strictCodec('dsh-rvguarder#actionId', () => z.string().min(1).max(256), { type: 'string' }) },
        ],
        strictCodec('dsh-rvguarder#rvguarderAdmin/actionDetail:result', () => z.object({ ok: z.literal(true) }).passthrough(), { type: 'object' }),
      ),
      'rvguarderAdmin/policy': definition(
        '规则与策略版本（只读）。',
        [],
        strictCodec('dsh-rvguarder#rvguarderAdmin/policy:result', () => z.object({ ok: z.literal(true) }).passthrough(), { type: 'object' }),
      ),
      'rvguarderAdmin/rvStatus': definition(
        'RV 状态（只读）。',
        [],
        strictCodec('dsh-rvguarder#rvguarderAdmin/rvStatus:result', () => z.object({ ok: z.literal(true) }).passthrough(), { type: 'object' }),
      ),
      'rvguarderAdmin/rvToggle': definition(
        'RV 模式切换。',
        [
          { name: 'enabled', description: '是否启用 RV。', source: 'json', codec: strictCodec('dsh-rvguarder#enabled', () => z.boolean(), { type: 'boolean' }) },
        ],
        strictCodec('dsh-rvguarder#rvguarderAdmin/rvToggle:result', () => z.object({ ok: z.literal(true) }).passthrough(), { type: 'object' }),
      ),
      'rvguarderAdmin/semanticMode': definition(
        '语义模式设置 local/auto/llm/host-agent。',
        [
          { name: 'mode', description: '语义模式。', source: 'json', codec: strictCodec('dsh-rvguarder#mode', () => z.enum(['local', 'auto', 'llm', 'host-agent']), { type: 'string', enum: ['local', 'auto', 'llm', 'host-agent'] }) },
        ],
        strictCodec('dsh-rvguarder#rvguarderAdmin/semanticMode:result', () => z.object({ ok: z.literal(true) }).passthrough(), { type: 'object' }),
      ),
      'rvguarderAdmin/runScan': definition(
        '运行基线扫描。',
        [],
        strictCodec('dsh-rvguarder#rvguarderAdmin/runScan:result', () => z.object({ ok: z.literal(true) }).passthrough(), { type: 'object' }),
      ),
      'rvguarderAdmin/audit': definition(
        '审计记录与链完整性（只读）。',
        [],
        strictCodec('dsh-rvguarder#rvguarderAdmin/audit:result', () => z.object({ ok: z.literal(true) }).passthrough(), { type: 'object' }),
      ),
      'rvguarderAdmin/auditExport': definition(
        '审计导出下载（json/csv）。',
        [
          { name: 'format', description: '导出格式。', source: 'json', codec: strictCodec('dsh-rvguarder#format', () => z.enum(['json', 'csv']), { type: 'string', enum: ['json', 'csv'] }) },
        ],
        // 字节结果由附件通道解码为 Uint8Array；此处校验公共形状。
        strictCodec('dsh-rvguarder#rvguarderAdmin/auditExport:result', () => z.object({ bytes: z.instanceof(Uint8Array), filename: z.string(), mediaType: z.string() }), { type: 'object' }),
      ),
      'rvguarderAdmin/report': definition(
        '合规报告下载（json/html/pdf）。',
        [
          { name: 'format', description: '报告格式。', source: 'json', codec: strictCodec('dsh-rvguarder#reportFormat', () => z.enum(['json', 'html', 'pdf']), { type: 'string', enum: ['json', 'html', 'pdf'] }) },
        ],
        strictCodec('dsh-rvguarder#rvguarderAdmin/report:result', () => z.object({ bytes: z.instanceof(Uint8Array), filename: z.string(), mediaType: z.string() }), { type: 'object' }),
      ),
    },
  }, zod);
}
