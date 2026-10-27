/** 浏览器客户端环境声明：宿主客户端 Cordis 上下文的结构类型（不依赖 SDK 类型解析）。 */

/** 宿主客户端 Cordis 上下文；只声明本插件实际使用的成员面。 */
export interface ClientContext {
  effect(effect: () => unknown, label?: string): unknown;
  inject(services: string[], callback: (ctx: ClientContext) => unknown): unknown;
  locale: {
    register(ns: string, dict: { zh: Record<string, string>; en: Record<string, string> }): unknown;
    bind(ns: string): (key: string) => string;
    getSnapshot?(): { language?: string };
    resolveText?(text: unknown): string;
  };
  slots: {
    inject(slot: string, register: () => unknown): unknown;
    register(options: Record<string, unknown>, component: unknown): unknown;
  };
  remote: {
    $mount(contribution: unknown): Promise<() => Promise<void>>;
    $on(event: string, listener: (...args: unknown[]) => void): unknown;
  };
  get<T = unknown>(key: string): T | undefined;
}
