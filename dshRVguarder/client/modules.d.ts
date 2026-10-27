/** 前端内嵌构建产物的形状声明（esbuild 经 scripts/build-client.mjs 打入）。 */
declare module '*/rvguarder-embedded.mjs' {
  export function mountEmbedded(container: HTMLElement, options: {
    transport: { call(method: string, args?: Record<string, unknown>): Promise<unknown>; download(method: string, args?: Record<string, unknown>): Promise<unknown> };
    instanceId?: string;
    language?: string;
    initialView?: string;
  }): { dispose(): void };
}
/** @deepseek-ai/dsh-typert-protocol/remote-info 的客户端形状（打包进客户端）。 */
declare module '@deepseek-ai/dsh-typert-protocol/remote-info' {
  export function createTypertRemoteInfo(spec: {
    package: string;
    methods: Record<string, {
      service: string;
      description?: string;
      invocation: { kind: 'direct' };
      parameters: Array<{ name: string; description?: string; source: 'json'; codec: Record<string, unknown> }>;
      result: Record<string, unknown>;
    }>;
  }, zod: unknown): { package: string; descriptors: unknown[]; methods: Record<string, unknown> };
}
