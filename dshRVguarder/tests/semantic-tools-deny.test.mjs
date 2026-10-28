import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../dist/semantic-tools-deny.js';

test('hides all inherited global tools and denies scoped tool execution', () => {
  const state = { restriction: undefined, presentationMode: undefined, guard: undefined };
  const ctx = {
    tools: {
      restrict(value) { state.restriction = value; return () => {}; },
      presentAs(value) { state.presentationMode = value; return () => {}; },
      guard(value) { state.guard = value; return () => {}; },
    },
  };

  apply(ctx);

  assert.deepEqual(state.restriction, { allow: [] });
  assert.equal(state.presentationMode, 'native');
  assert.equal(state.guard?.({ name: 'unexpected-scoped-tool' }), 'RVguarder semantic child tools are disabled');
});
