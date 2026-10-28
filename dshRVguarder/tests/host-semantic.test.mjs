import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSemanticDelegator } from '../dist/host-semantic.js';
import { apply as applySemanticToolsDeny } from '../dist/semantic-tools-deny.js';

function fakeContext({ tools = [], parentMode = 'native', stopReason = 'completed', output = [{ type: 'text', text: '{"version":"v3"}' }], neverSettles = false, provider } = {}) {
  const state = { provider, definition: undefined, disposed: 0, starts: 0, activationDisposed: 0, spec: undefined,
    restriction: undefined, presentationMode: undefined, presetGuard: undefined, globalGuard: undefined,
    schemasScope: undefined, childId: undefined };
  const scopedTools = {
    restrict(value) { state.restriction = value; return () => {}; },
    presentAs(value) { state.presentationMode = value; return () => {}; },
    guard(value) { state.presetGuard = value; return () => {}; },
  };
  const toolsService = {
    guard(value) { state.globalGuard = value; return () => {}; },
  };
  const subagents = {
    registerProvider(value) { state.provider = value; return () => { state.provider = undefined; }; },
    getProvider(name) { return state.provider?.name === name ? state.provider : undefined; },
    async startActivation(spec) {
      state.starts++;
      state.spec = spec;
      state.childId = spec.childId;
      assert.deepEqual(state.restriction, { allow: [] }, 'preset restriction must be active before the first prompt is admitted');
      assert.equal(state.presentationMode, 'native', 'PTC presentation transport must be absent before the first prompt');
      assert.equal(state.presetGuard?.({}), 'RVguarder semantic child tools are disabled');
      assert.equal(state.globalGuard?.({ agent: { id: spec.childId } }), 'RVguarder semantic child tools are disabled');
      return {
        childId: spec.childId,
        result: neverSettles ? new Promise(() => {}) : Promise.resolve({ stopReason, output }),
        async dispose() { state.activationDisposed++; },
      };
    },
  };
  const presets = {
    async register(definition) {
      state.definition = definition;
      applySemanticToolsDeny({ tools: scopedTools });
      return async () => { state.disposed++; };
    },
    async resolve(id) { return { id }; },
    inspectCompositions() {
      return state.definition ? [{ id: state.definition.id, modules: [{ moduleName: state.definition.plugins[0]?.name }], leakedServices: [] }] : [];
    },
  };
  const agents = { get(id) { return id === state.childId ? { id, ctx: { get(name) { return name === 'tools' ? { schemas(scope) {
    state.schemasScope = scope;
    return parentMode === 'ptc' && state.presentationMode !== 'native' ? [{ name: 'run_code' }, ...tools] : tools;
  } } : undefined; } } } : undefined; } };
  const ctx = { subagents, agentPresets: presets, tools: toolsService,
    get(name) { return ({ subagents, agentPresets: presets, agents, tools: toolsService })[name]; } };
  return { ctx, state };
}

test('hides PTC transport before start while using the active parent route with a restricted child', async () => {
  const { ctx, state } = fakeContext({ parentMode: 'ptc' });
  const adapter = new HostSemanticDelegator(ctx, 'instance-a');
  const parent = { id: 'active-parent' };
  const prompt = 'sanitized semantic request';
  const response = await adapter.run(prompt, parent, new AbortController().signal, 1000);

  assert.equal(response, '{"version":"v3"}');
  assert.deepEqual(state.definition.plugins, [{ id: 'semantic-tools-deny', name: 'dsh-rvguarder/semantic-tools-deny' }]);
  assert.equal(state.presentationMode, 'native');
  assert.equal(typeof state.spec.childId, 'string');
  assert.equal(state.spec.provider, 'rvguarder-semantic');
  assert.equal(state.spec.request.parent, parent);
  assert.deepEqual(state.spec.request.prompt, [{ type: 'text', text: prompt }]);
  assert.equal(state.spec.request.agentOptions, undefined);
  assert.equal(state.spec.delivery, 'caller');
  assert.equal(state.schemasScope.id, state.childId);
  assert.equal(state.activationDisposed, 1);
  assert.equal(adapter.capabilities().effective_tools_empty, true);
  assert.equal(adapter.isSemanticChild(state.childId), false, 'the global deny guard must stop tracking after dispose');
  await adapter.close();
  assert.equal(state.disposed, 1);
  assert.equal(state.provider, undefined);
});

test('does not report a provider that inherits parent context as host-agent capable', async () => {
  const incompatible = {
    name: 'rvguarder-semantic',
    capabilities: { agentPreset: true },
    inheritsParentContext: true,
    prepareContinuable() {},
  };
  const { ctx, state } = fakeContext({ provider: incompatible });
  const adapter = new HostSemanticDelegator(ctx, 'instance-incompatible');

  const capabilities = await adapter.readyCapabilities();
  assert.equal(capabilities.provider_available, false);
  assert.equal(capabilities.provider_reason, 'provider_inherits_parent_context');
  assert.equal(await adapter.run('safe prompt', { id: 'parent' }, new AbortController().signal, 1000), undefined);
  assert.equal(state.starts, 0);
  await adapter.close();
});

test('does not report a preset that failed to activate its restriction plugin', async () => {
  const { ctx, state } = fakeContext();
  ctx.agentPresets.inspectCompositions = () => [{ id: state.definition?.id, modules: [], leakedServices: [] }];
  const adapter = new HostSemanticDelegator(ctx, 'instance-disabled-preset');

  const capabilities = await adapter.readyCapabilities();
  assert.equal(capabilities.isolated_preset_ready, false);
  assert.equal(capabilities.effective_tools_empty, false);
  assert.equal(capabilities.provider_reason, 'semantic_tool_preset_not_active');
  assert.equal(await adapter.run('safe prompt', { id: 'parent' }, new AbortController().signal, 1000), undefined);
  assert.equal(state.starts, 0);
  await adapter.close();
});

test('refuses a child with any effective tools and releases its activation', async () => {
  const { ctx, state } = fakeContext({ tools: [{ name: 'bash' }] });
  const adapter = new HostSemanticDelegator(ctx, 'instance-b');
  const response = await adapter.run('safe prompt', { id: 'parent' }, new AbortController().signal, 1000);

  assert.equal(response, undefined);
  assert.equal(state.activationDisposed, 1);
  assert.equal(adapter.capabilities().isolated_preset_ready, false);
  assert.equal((await adapter.readyCapabilities()).provider_reason, 'effective_tools_nonempty', 'runtime isolation failure must remain sticky');
  await adapter.close();
});

test('timeout, cancellation, non-completion, and oversized output fall back without a response', async (t) => {
  for (const options of [
    { neverSettles: true },
    { stopReason: 'error' },
    { output: [{ type: 'text', text: 'x'.repeat(16 * 1024 + 1) }] },
  ]) {
    const { ctx, state } = fakeContext(options);
    const adapter = new HostSemanticDelegator(ctx, `instance-${state.starts}`);
    assert.equal(await adapter.run('safe prompt', { id: 'parent' }, new AbortController().signal, 100), undefined);
    assert.equal(state.activationDisposed, 1);
    await adapter.close();
  }

  const { ctx, state } = fakeContext({ neverSettles: true });
  const adapter = new HostSemanticDelegator(ctx, 'instance-cancel');
  const controller = new AbortController();
  const run = adapter.run('safe prompt', { id: 'parent' }, controller.signal, 1000);
  setTimeout(() => controller.abort(), 10);
  assert.equal(await run, undefined);
  assert.equal(state.activationDisposed, 1);
  await adapter.close();
});
