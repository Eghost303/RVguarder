import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSemanticDelegator } from '../dist/host-semantic.js';

function fakeContext({ tools = [], stopReason = 'completed', output = [{ type: 'text', text: '{"version":"v3"}' }], neverSettles = false } = {}) {
  const state = { provider: undefined, definition: undefined, disposed: 0, starts: 0, activationDisposed: 0, spec: undefined };
  const subagents = {
    registerProvider(provider) { state.provider = provider; return () => { state.provider = undefined; }; },
    getProvider(name) { return state.provider?.name === name ? state.provider : undefined; },
    async startActivation(spec) {
      state.starts++;
      state.spec = spec;
      return {
        childId: 'semantic-child',
        result: neverSettles ? new Promise(() => {}) : Promise.resolve({ stopReason, output }),
        async dispose() { state.activationDisposed++; },
      };
    },
  };
  const presets = {
    async register(definition) { state.definition = definition; return async () => { state.disposed++; }; },
    async readDocument(id) { return { agentPreset: id, content: state.definition?.plugins.length === 0 ? '[]' : '[{}]' }; },
  };
  const agents = { get(id) { return id === 'semantic-child' ? { ctx: { get(name) { return name === 'tools' ? { schemas: () => tools } : undefined; } } } : undefined; } };
  const ctx = { subagents, agentPresets: presets, get(name) { return ({ subagents, agentPresets: presets, agents })[name]; } };
  return { ctx, state };
}

test('uses the active parent route with a private empty preset and caller-owned result', async () => {
  const { ctx, state } = fakeContext();
  const adapter = new HostSemanticDelegator(ctx, 'instance-a');
  const parent = { id: 'active-parent' };
  const prompt = 'sanitized semantic request';
  const response = await adapter.run(prompt, parent, new AbortController().signal, 1000);

  assert.equal(response, '{"version":"v3"}');
  assert.deepEqual(state.definition.plugins, []);
  assert.equal(state.spec.provider, 'rvguarder-semantic');
  assert.equal(state.spec.request.parent, parent);
  assert.deepEqual(state.spec.request.prompt, [{ type: 'text', text: prompt }]);
  assert.equal(state.spec.request.agentOptions, undefined);
  assert.equal(state.spec.delivery, 'caller');
  assert.equal(state.activationDisposed, 1);
  assert.equal(adapter.capabilities().effective_tools_empty, true);
  await adapter.close();
  assert.equal(state.disposed, 1);
  assert.equal(state.provider, undefined);
});

test('refuses a child with any effective tools and releases its activation', async () => {
  const { ctx, state } = fakeContext({ tools: [{ name: 'bash' }] });
  const adapter = new HostSemanticDelegator(ctx, 'instance-b');
  const response = await adapter.run('safe prompt', { id: 'parent' }, new AbortController().signal, 1000);

  assert.equal(response, undefined);
  assert.equal(state.activationDisposed, 1);
  assert.equal(adapter.capabilities().isolated_preset_ready, false);
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
