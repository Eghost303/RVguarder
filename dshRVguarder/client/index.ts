/**
 * RVguarder 浏览器客户端：设置页 settings.section 贡献 + 插件详情配置插槽，
 * 内部挂载独立 Preact Guard 界面（从内嵌模块导入）。
 *
 * 该模块只运行在浏览器；不引用 Node 文件系统、令牌读取或服务端执行代码。
 * Remote 命名空间 remote.rvguarderAdmin 由本插件 $mount 创建；
 * 插槽注册放在 ctx.inject 延迟注入里，命名空间就绪后自动激活，无循环依赖。
 */
import { createElement, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ClientContext } from './types.js';
import { mountEmbedded } from '../embedded/rvguarder-embedded.mjs';
import { createRemoteContribution } from './remote-contribution.js';

/** Cordis 服务名：slots/locale 注册 + 管理通道挂载。 */
export const inject = ['slots', 'locale', 'remote'];

const NS = 'rvguarder.settings';
const SETTINGS_SECTION_ID = 'rvguarder';
const ADMIN_SERVICE = 'remote.rvguarderAdmin';

const zh = {
  nav: 'RVguarder',
  openPanel: '打开 RVguarder 管理',
};
const en = {
  nav: 'RVguarder',
  openPanel: 'Open RVguarder management',
};

/** 管理命名空间方法面：固定业务方法 → RemoteResult。 */
type AdminNamespace = Record<string, ((...args: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: { code?: string; message?: string } }>) | undefined>;

export function apply(ctx: ClientContext) {
  try {
    applyInner(ctx);
  } catch (error) {
    console.error('[rvguarder-client] apply failed:', error);
    throw error;
  }
}

function applyInner(ctx: ClientContext) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rvguarder-client: dictionaries');
  const t = ctx.locale.bind(NS);

  // 挂载宿主管理通道的 Remote 契约（严格 codec；zod 来自平台 seed）。
  const contribution = createRemoteContribution();
  const mounted = ctx.remote.$mount(contribution);
  mounted.catch((error) => { console.error('[rvguarder-client] remote $mount failed:', error); });
  ctx.effect(() => () => { void mounted.then((dispose: () => Promise<void>) => { void dispose(); }).catch(() => {}); }, 'rvguarder-client: remote contribution');

  // 命名空间服务就绪后（$mount 完成时）注册设置页与插件详情插槽。
  ctx.inject([ADMIN_SERVICE], (nsCtx: ClientContext) => {
    const transportFor = () => {
      const namespace = nsCtx.get<AdminNamespace>(ADMIN_SERVICE);
      if (!namespace) return null;
      /** 调用并解包 RemoteResult：ok:false 时抛出带 code 的错误。 */
      const invoke = async (method: string, args: Record<string, unknown>) => {
        const result = await namespace[method]?.(...remoteArgs(method, args));
        if (!result || typeof result !== 'object') throw Object.assign(new Error('remote_call_failed'), { code: 'rvguarder/transport' });
        if (result.ok !== true) {
          const failure = Object.assign(new Error(result.error?.message || 'remote_call_failed'), { code: result.error?.code }) as Error & { code?: string; payload?: unknown };
          failure.payload = result.error;
          throw failure;
        }
        return result.value;
      };
      return {
        call: async (method: string, args: Record<string, unknown> = {}) => invoke(method, args),
        download: async (method: string, args: Record<string, unknown> = {}) => {
          const value = await invoke(method, args) as { bytes?: unknown; filename?: string; mediaType?: string } | undefined;
          if (!value?.bytes) throw new Error('管理通道未返回下载内容。');
          return new Uint8Array(value.bytes as ArrayBuffer).buffer;
        },
      };
    };

    // 设置页贡献：settings.section 是列表插槽；内容组件由本插件提供。
    nsCtx.slots.inject('settings.section', () => nsCtx.slots.register({
      name: 'settings.section',
      id: SETTINGS_SECTION_ID,
      order: 40,
      label: () => t('nav'),
      locale: NS,
      inject: () => ({ transport: transportFor, context: nsCtx }),
    }, RvguarderSettingsSection));

    // 插件详情配置插槽：按包名 key 定位，显示连接摘要与入口指引。
    nsCtx.slots.inject('plugins.bundle.config', () => nsCtx.slots.register({
      name: 'plugins.bundle.config',
      key: 'dsh-rvguarder',
      locale: NS,
      inject: () => ({ context: nsCtx }),
    }, RvguarderBundleConfig));
  });
}

/** 读取宿主语言（zh/en 简化映射）。 */
function ctxLocaleLanguage(ctx: ClientContext): string {
  try {
    const snapshot = ctx.locale?.getSnapshot?.();
    const language = snapshot?.active;
    if (typeof language === 'string') return language.startsWith('en') ? 'en' : 'zh';
  } catch { /* 语言读取失败按默认 zh */ }
  return 'zh';
}

/** 内嵌 Remote 方法的位置参数表（与 management.ts 签名一一对应）。 */
function remoteArgs(method: string, args: Record<string, unknown>): unknown[] {
  switch (method) {
    case 'actionDetail': return [args.actionId];
    case 'rvToggle': return [args.enabled === true];
    case 'semanticMode': return [args.mode];
    case 'auditExport': return [args.format];
    case 'report': return [args.format];
    default: return [];
  }
}

/** 设置页插槽注入面。 */
interface SettingsSectionProps {
  transport?: () => { call(method: string, args?: Record<string, unknown>): Promise<unknown>; download(method: string, args?: Record<string, unknown>): Promise<unknown> } | null;
  language?: string;
  context?: ClientContext;
}

/** 插件详情插槽注入面。 */
interface BundleConfigProps { context?: ClientContext }

/**
 * React 外层容器：只管理一个 div 节点；Preact 全部渲染在容器内部。
 * 挂载/卸载经 useEffect 清理，React StrictMode 双挂载亦安全（幂等 dispose）。
 */
function RvguarderSettingsSection(props: SettingsSectionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<ReturnType<typeof mountEmbedded> | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const language = useSyncExternalStore(
    listener => props.context?.locale.subscribe?.(listener) ?? (() => {}),
    () => props.context ? ctxLocaleLanguage(props.context) : (props.language || 'zh'),
  );
  const theme = useSyncExternalStore(
    listener => props.context?.on?.('theme/change', listener) ?? (() => {}),
    () => props.context?.get<{getTheme(): {colorScheme?: string}}>('theme')?.getTheme().colorScheme === 'dark' ? 'dark' : 'light',
  );
  const appearance = useRef({ language, theme }); appearance.current = { language, theme };
  useEffect(() => { handleRef.current?.update({ language, theme }); }, [language, theme]);
  useEffect(() => {
    const node = containerRef.current;
    if (!node || !props.transport) return;
    const transport = props.transport();
    if (!transport) return;
    let disposed = false;
    let handle: ReturnType<typeof mountEmbedded> | undefined;
    // 持久化范围来自宿主确认的实际实例，关闭后的旧响应不能再次挂载。
    void transport.call('overview').then((value) => {
      if (disposed) return;
      const instanceId = (value as { backend?: { instanceId?: unknown } })?.backend?.instanceId;
      if (typeof instanceId !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}$/.test(instanceId)) throw new Error('管理通道未提供有效实例身份。');
      setError('');
      handle = mountEmbedded(node, { transport, instanceId, language: appearance.current.language, initialView: 'overview' });
      handleRef.current = handle; handle.update(appearance.current);
    }).catch((error: unknown) => {
      if (!disposed) setError(error instanceof Error ? error.message : 'Management unavailable');
    });
    return () => { disposed = true; handle?.dispose(); handleRef.current = null; };
  }, [props.transport, retry]);
  return createElement('div', null,
    createElement('div', { ref: containerRef, className: 'rvguarder-settings-host', 'data-testid': 'rvguarder-settings-section' }),
    error ? createElement('div', { role: 'alert' }, error, createElement('button', { onClick: () => setRetry(value => value + 1) }, language === 'en' ? 'Reconnect' : '重新连接')) : null);
}

/** 插件详情配置区域：连接摘要 + 指引（同一管理组件打开）。 */
function RvguarderBundleConfig(props: BundleConfigProps) {
  const language = useSyncExternalStore(listener => props.context?.locale.subscribe?.(listener) ?? (() => {}), () => props.context ? ctxLocaleLanguage(props.context) : 'zh');
  return createElement('div', { className: 'rvguarder-bundle-config', 'data-testid': 'rvguarder-bundle-config' },
    createElement('p', null, language === 'en' ? 'Manage Guard in Settings → RVguarder.' : '在“设置 → RVguarder”中管理 Guard 状态、调用记录、规则与审计。'),
  );
}
