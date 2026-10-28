import type { Context } from '@deepseek-ai/cordis';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { sdkVersion } from './sdk.js';

const PROVIDER_NAME = 'rvguarder-semantic';
const PRESET_PREFIX = 'rvguarder-semantic-only';
const PRESET_PLUGIN = 'dsh-rvguarder/semantic-tools-deny';
const MAX_RESPONSE_BYTES = 16 * 1024;
const require = createRequire(import.meta.url);
const OPTIONAL_PACKAGES = [
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-agent-preset-registry',
  '@deepseek-ai/dsh-subagent-spawn-in-process',
];

function hostRuntimeRequire(): ReturnType<typeof createRequire> {
  try {
    return process.argv[1] ? createRequire(process.argv[1]) : require;
  } catch {
    return require;
  }
}

function optionalPackagesMatchSdk(runtimeRequire: ReturnType<typeof createRequire>): boolean {
  try {
    return OPTIONAL_PACKAGES.every((name) => runtimeRequire(`${name}/package.json`).version === sdkVersion);
  } catch {
    return false;
  }
}

export interface HostSemanticCapabilities {
  subagents_available: boolean;
  preset_registry_available: boolean;
  provider_available: boolean;
  isolated_preset_ready: boolean;
  effective_tools_empty: boolean;
  provider_reason?: string;
}

type AnyContext = Context & Record<string, any>;

/** Owns DSH child-agent registration and one-shot, tool-free semantic runs. */
export class HostSemanticDelegator {
  private readonly ctx: AnyContext;
  private readonly runtimeRequire = hostRuntimeRequire();
  private initRun?: Promise<void>;
  private subagents: any;
  private presets: any;
  private providerName = PROVIDER_NAME;
  private presetId = '';
  private releaseProvider?: () => Promise<void>;
  private releasePreset?: () => Promise<void>;
  private readonly activeSemanticChildIds = new Set<string>();
  private semanticChildGuardReady = false;
  private toolIsolationFailed = false;
  private caps: HostSemanticCapabilities = {
    subagents_available: false,
    preset_registry_available: false,
    provider_available: false,
    isolated_preset_ready: false,
    effective_tools_empty: false,
    provider_reason: 'not_checked',
  };

  constructor(ctx: Context, instanceId: string) {
    this.ctx = ctx as AnyContext;
    const safeId = instanceId.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 64);
    this.presetId = `${PRESET_PREFIX}-${safeId}`;
    try {
      const tools = this.ctx.get('tools') ?? this.ctx.tools;
      if (typeof tools?.guard === 'function') {
        tools.guard((exec: any) => {
          const agentId = exec?.agent?.id;
          return typeof agentId === 'string' && this.activeSemanticChildIds.has(agentId)
            ? 'RVguarder semantic child tools are disabled'
            : undefined;
        });
        this.semanticChildGuardReady = true;
      }
    } catch {
      // Host-agent mode remains unavailable unless its global child guard is installed.
    }
    void this.ensureReady();
  }

  /** Return only finite runtime capability flags for the authenticated probe. */
  capabilities(): HostSemanticCapabilities {
    return { ...this.caps };
  }

  /** Identify semantic child Agents so the pre-execute hook can stop recursion. */
  isSemanticChild(agentId: unknown): boolean {
    return typeof agentId === 'string' && this.activeSemanticChildIds.has(agentId);
  }

  /** Wait until optional DSH services and the isolated preset have been checked. */
  async readyCapabilities(): Promise<HostSemanticCapabilities> {
    await this.ensureReady();
    return this.capabilities();
  }

  /** Start an isolated child on the active DSH route and return bounded text. */
  async run(prompt: string, parent: unknown, signal: AbortSignal, timeoutMs: number): Promise<string | undefined> {
    await this.ensureReady();
    if (!this.caps.isolated_preset_ready || !this.semanticChildGuardReady || this.toolIsolationFailed
      || !this.subagents || !parent || signal.aborted) return undefined;
    const boundedTimeout = Math.max(100, Math.min(2000, Math.floor(timeoutMs / 2)));
    const childSignal = AbortSignal.any([signal, AbortSignal.timeout(boundedTimeout)]);
    const childId = randomUUID();
    this.activeSemanticChildIds.add(childId);
    let activation: any;
    try {
      activation = await this.subagents.startActivation({
        childId,
        provider: this.providerName,
        label: 'RVguarder semantic analysis',
        request: {
          parent,
          prompt: [{ type: 'text', text: prompt }],
          agentPreset: this.presetId,
        },
        signal: childSignal,
        delivery: 'caller',
      });

      const agents = this.ctx.get('agents');
      const child = agents?.get?.(activation.childId);
      const tools = child?.ctx?.get?.('tools') ?? child?.ctx?.tools;
      const schemas = typeof tools?.schemas === 'function' ? tools.schemas(child) : undefined;
      if (!Array.isArray(schemas) || schemas.length !== 0) {
        this.toolIsolationFailed = true;
        this.caps.effective_tools_empty = false;
        this.caps.isolated_preset_ready = false;
        this.caps.provider_reason = 'effective_tools_nonempty';
        return undefined;
      }
      this.caps.effective_tools_empty = true;

      const timeout = new Promise<never>((_resolve, reject) => {
        if (childSignal.aborted) reject(new Error('semantic_child_aborted'));
        else childSignal.addEventListener('abort', () => reject(new Error('semantic_child_aborted')), { once: true });
      });
      const result = await Promise.race([activation.result, timeout]);
      if (result?.stopReason !== 'completed' || signal.aborted) return undefined;
      const text = Array.isArray(result.output)
        ? result.output
          .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
          .map((block: any) => block.text)
          .join('\n')
        : '';
      if (!text || Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) return undefined;
      return text;
    } catch {
      return undefined;
    } finally {
      if (activation) await activation.dispose().catch(() => {});
      this.activeSemanticChildIds.delete(childId);
    }
  }

  /** Release the registry-owned tool-restricted preset during plugin shutdown. */
  async close(): Promise<void> {
    await this.initRun?.catch(() => {});
    if (this.releaseProvider) {
      const release = this.releaseProvider;
      this.releaseProvider = undefined;
      await Promise.resolve(release()).catch(() => {});
    }
    if (this.releasePreset) {
      const release = this.releasePreset;
      this.releasePreset = undefined;
      await release().catch(() => {});
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.toolIsolationFailed) return;
    if (this.caps.isolated_preset_ready) return;
    if (!this.initRun) {
      this.initRun = this.initialize().finally(() => { this.initRun = undefined; });
    }
    await this.initRun;
  }

  private async initialize(): Promise<void> {
    try {
      this.subagents = this.ctx.get('subagents');
      this.presets = this.ctx.get('agentPresets');
      if (!this.semanticChildGuardReady) {
        this.caps.provider_reason = 'semantic_tool_guard_unavailable';
        return;
      }
      this.caps.subagents_available = !!this.subagents && typeof this.subagents.startActivation === 'function';
      this.caps.preset_registry_available = !!this.presets
        && typeof this.presets.register === 'function'
        && typeof this.presets.resolve === 'function'
        && typeof this.presets.inspectCompositions === 'function';
      if (!this.caps.subagents_available || !this.caps.preset_registry_available) {
        this.caps.provider_reason = !this.caps.subagents_available ? 'subagent_services_unavailable' : 'preset_registry_unavailable';
        return;
      }
      if (!optionalPackagesMatchSdk(this.runtimeRequire)) {
        this.caps.provider_reason = 'sdk_package_version_mismatch';
        return;
      }

      let provider = this.subagents.getProvider?.(this.providerName);
      if (!provider) {
        const packageName = '@deepseek-ai/dsh-subagent-spawn-in-process';
        let providerPath: string;
        try {
          providerPath = this.runtimeRequire.resolve(packageName);
        } catch {
          this.caps.provider_reason = 'spawn_provider_module_unavailable';
          return;
        }
        let spawnProvider: { apply?: (ctx: Context, config: { providerName: string }) => void };
        try {
          spawnProvider = await import(pathToFileURL(providerPath).href) as typeof spawnProvider;
        } catch {
          this.caps.provider_reason = 'spawn_provider_load_failed';
          return;
        }
        if (typeof spawnProvider.apply !== 'function') {
          this.caps.provider_reason = 'spawn_provider_apply_missing';
          return;
        }
        const providerService = Object.create(this.subagents) as Record<string, any>;
        providerService.registerProvider = (definition: unknown) => {
          const release = this.subagents.registerProvider(definition);
          if (typeof release === 'function') this.releaseProvider = release;
          return release;
        };
        const providerContext = new Proxy(this.ctx, {
          get: (target, property, receiver) => property === 'subagents'
            ? providerService
            : Reflect.get(target, property, receiver),
        });
        try {
          spawnProvider.apply(providerContext as Context, { providerName: this.providerName });
        } catch {
          this.caps.provider_reason = 'provider_registration_failed';
          return;
        }
        provider = this.subagents.getProvider?.(this.providerName);
      }
      this.caps.provider_available = !!provider
        && provider.capabilities?.agentPreset === true
        && provider.inheritsParentContext === false
        && typeof provider.prepareContinuable === 'function';
      if (!this.caps.provider_available) {
        this.caps.provider_reason = provider && provider.inheritsParentContext !== false
          ? 'provider_inherits_parent_context'
          : 'provider_registration_or_capability_missing';
        return;
      }

      try {
        this.releasePreset = await this.presets.register({
          id: this.presetId,
          name: 'RVguarder semantic only',
          description: 'Tool-restricted child composition for bounded semantic analysis.',
          plugins: [{ id: 'semantic-tools-deny', name: PRESET_PLUGIN }],
        });
      } catch {
        this.caps.provider_reason = 'semantic_tool_preset_registration_failed';
        return;
      }
      try {
        const resolved = await this.presets.resolve(this.presetId);
        const composition = this.presets.inspectCompositions().find((item: any) => item.id === this.presetId);
        const modules = Array.isArray(composition?.modules) ? composition.modules : [];
        const pluginActive = modules.length === 1 && modules[0]?.moduleName === PRESET_PLUGIN;
        const noLeakedServices = Array.isArray(composition?.leakedServices) && composition.leakedServices.length === 0;
        this.caps.isolated_preset_ready = !resolved?.broken && pluginActive && noLeakedServices;
        this.caps.effective_tools_empty = this.caps.isolated_preset_ready;
        if (!this.caps.isolated_preset_ready) {
          this.caps.provider_reason = 'semantic_tool_preset_not_active';
          const release = this.releasePreset;
          this.releasePreset = undefined;
          await release?.().catch(() => {});
          return;
        }
        this.caps.provider_reason = 'ready';
      } catch {
        this.caps.provider_reason = 'semantic_tool_preset_verification_failed';
        const release = this.releasePreset;
        this.releasePreset = undefined;
        await release?.().catch(() => {});
      }
    } catch {
      // Optional DSH services stay optional: report unavailable and keep the hook loaded.
      this.caps = {
        subagents_available: this.caps.subagents_available,
        preset_registry_available: this.caps.preset_registry_available,
        provider_available: false,
        isolated_preset_ready: false,
        effective_tools_empty: false,
        provider_reason: 'provider_initialization_failed',
      };
    }
  }
}
