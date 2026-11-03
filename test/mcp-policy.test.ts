import assert from 'node:assert/strict';
import test from 'node:test';
import { FlowService } from '../src/app/flow-service';
import { assertFlowAllowed, PolicyError, type McpPolicy } from '../src/mcp/policy';

const DENY_ALL: McpPolicy = {
  allowBash: false,
  allowWrite: false,
  allowWeb: false,
  allowEmail: false,
  allowBrowser: false,
  allowFlowPaths: true,
  maxConcurrentRuns: 1,
  maxFlowBytes: 1024,
  maxResultBytes: 1024,
};

function graphWith(permissions: Record<string, boolean>) {
  return new FlowService().loadPayload({
    nodes: [
      {
        id: 'a',
        label: 'A',
        provider: 'openai',
        model: 'gpt-4o-mini',
        prompt: 'a',
        permissions,
      },
    ],
    edges: [],
  });
}

test('read-only flows are allowed by a deny-all policy', () => {
  assert.doesNotThrow(() => assertFlowAllowed(graphWith({ read: true }), DENY_ALL));
});

test('dangerous permissions are named when denied', () => {
  assert.throws(
    () => assertFlowAllowed(graphWith({ bash: true, write: true }), DENY_ALL),
    (error: unknown) => error instanceof PolicyError && /requests bash/.test(error.message),
  );
});

test('an explicit allow lets the permission through', () => {
  assert.doesNotThrow(() => assertFlowAllowed(graphWith({ bash: true }), { ...DENY_ALL, allowBash: true }));
});
