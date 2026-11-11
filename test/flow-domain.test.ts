import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGraph } from '../src/domain/graph-validation';
import { lintGraph } from '../src/domain/flow-lint';
import { checkOutput } from '../src/domain/output-schema';
import { parseFlowPayload } from '../src/runtime/flow-payload';
import { EXAMPLE_FLOW } from '../src/cli/schema';
import { FlowService } from '../src/app/flow-service';

test('the shipped example is structurally valid and lint-clean', () => {
  const graph = new FlowService().loadPayload(EXAMPLE_FLOW);
  assert.deepEqual(validateGraph(graph), []);
  assert.deepEqual(lintGraph(graph), []);
});

test('a cycle is reported', () => {
  const graph = new FlowService().loadPayload({
    nodes: [
      { id: 'a', label: 'A', provider: 'openai', model: 'gpt-4o-mini', prompt: 'a' },
      { id: 'b', label: 'B', provider: 'openai', model: 'gpt-4o-mini', prompt: 'b' },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b', condition: 'go' },
      { id: 'e2', source: 'b', target: 'a', condition: 'back' },
    ],
  });
  assert.ok(validateGraph(graph).some((issue) => issue.code === 'cycle'));
});

const loopNode = (id: string) => ({ id, label: id.toUpperCase(), provider: 'openai', model: 'gpt-4o-mini', prompt: id });

test('recursion is allowed only through an edge with a limit', () => {
  const flow = (limit?: number) =>
    new FlowService().loadPayload({
      nodes: ['w', 'r', 'f'].map(loopNode),
      edges: [
        { id: 'e1', source: 'w', target: 'r' },
        { id: 'e2', source: 'r', target: 'w', branch: 'revise', condition: 'needs work', ...(limit ? { maxTraversals: limit } : {}) },
        { id: 'e3', source: 'r', target: 'f', branch: 'done', condition: 'good enough' },
      ],
    });
  assert.ok(validateGraph(flow()).some((issue) => issue.code === 'cycle'));
  assert.deepEqual(validateGraph(flow(2)), []);
});

test('a node may recurse into itself when the edge is limited', () => {
  const build = (limit?: number) =>
    new FlowService().loadPayload({
      nodes: ['a', 'b'].map(loopNode),
      edges: [
        { id: 'e1', source: 'a', target: 'a', branch: 'again', condition: 'more to do', ...(limit ? { maxTraversals: limit } : {}) },
        { id: 'e2', source: 'a', target: 'b', branch: 'done', condition: 'finished' },
      ],
    });
  assert.ok(validateGraph(build()).some((issue) => issue.code === 'self-loop'));
  assert.deepEqual(validateGraph(build(3)), []);
});

test('an edge limit must be a positive whole number on a cycle, with an exit', () => {
  const nodes = ['a', 'b'].map(loopNode);
  const bad = new FlowService().loadPayload({
    nodes: [...nodes, loopNode('c')],
    edges: [
      { id: 'e1', source: 'a', target: 'b', maxTraversals: 2 },
      { id: 'e2', source: 'b', target: 'c', maxTraversals: 1.5 },
    ],
  });
  const codes = validateGraph(bad).map((issue) => issue.code);
  assert.ok(codes.includes('limit-not-recursive'));
  assert.ok(codes.includes('invalid-edge-limit'));

  const trapped = new FlowService().loadPayload({
    nodes,
    edges: [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'a', branch: 'x', condition: 'x', maxTraversals: 2 },
      { id: 'e3', source: 'b', target: 'a', branch: 'y', condition: 'y', maxTraversals: 2 },
    ],
  });
  assert.ok(validateGraph(trapped).some((issue) => issue.code === 'no-exit-edge'));
});

test('missing branch names are reported', () => {
  const graph = new FlowService().loadPayload({
    nodes: [
      { id: 'a', label: 'A', provider: 'openai', model: 'gpt-4o-mini', prompt: 'a' },
      { id: 'b', label: 'B', provider: 'openai', model: 'gpt-4o-mini', prompt: 'b' },
      { id: 'c', label: 'C', provider: 'openai', model: 'gpt-4o-mini', prompt: 'c' },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b', condition: 'yes' },
      { id: 'e2', source: 'a', target: 'c', condition: 'no' },
    ],
  });
  assert.ok(validateGraph(graph).some((issue) => issue.code === 'missing-branch'));
});

test('permissions and coordinates default safely', () => {
  const payload = parseFlowPayload({
    nodes: [{ provider: 'openai', label: 'A', model: 'gpt-4o-mini', prompt: 'a' }],
    edges: [],
  });
  assert.deepEqual(payload.nodes[0]?.permissions, {
    read: false,
    write: false,
    bash: false,
    web: false,
    email_read: false,
    mcp: false,
  });
  assert.deepEqual(payload.nodes[0]?.position, { x: 0, y: 0 });
});

test('a shared write is allowed on mutually exclusive branches', () => {
  const graph = new FlowService().loadPayload({
    nodes: [
      { id: 's', label: 'Split', provider: 'openai', model: 'gpt-4o-mini', prompt: 'choose a branch' },
      { id: 'a', label: 'A', provider: 'openai', model: 'gpt-4o-mini', prompt: 'write out.md', permissions: { write: true } },
      { id: 'b', label: 'B', provider: 'openai', model: 'gpt-4o-mini', prompt: 'write out.md', permissions: { write: true } },
    ],
    edges: [
      { id: 'e1', source: 's', target: 'a', branch: 'high', condition: 'score > 10' },
      { id: 'e2', source: 's', target: 'b', branch: 'low', condition: 'score <= 10' },
    ],
  });

  assert.ok(!lintGraph(graph).some((warning) => warning.code === 'concurrent-write'));
});

test('concurrent writers still warn when both can run', () => {
  const graph = new FlowService().loadPayload({
    nodes: [
      { id: 'a', label: 'A', provider: 'openai', model: 'gpt-4o-mini', prompt: 'write out.md', permissions: { write: true } },
      { id: 'b', label: 'B', provider: 'openai', model: 'gpt-4o-mini', prompt: 'write out.md', permissions: { write: true } },
    ],
    edges: [],
  });

  assert.ok(lintGraph(graph).some((warning) => warning.code === 'concurrent-write'));
});

test('json-via-web-fetch does not tell a bash-less node to grant bash', () => {
  const graph = new FlowService().loadPayload({
    nodes: [
      {
        id: 'a',
        label: 'Fetch',
        provider: 'openai',
        model: 'gpt-4o-mini',
        prompt: 'Use web_fetch on https://example.com/api/search and list the titles.',
        permissions: { web: true },
      },
    ],
    edges: [],
  });
  const warning = lintGraph(graph).find((candidate) => candidate.code === 'json-via-web-fetch');

  assert.ok(warning);
  assert.doesNotMatch(warning.hint, /grant bash/i);
  assert.match(warning.hint, /query parameters/);
});

test('downstream-reads-input says that inputs replaces predecessor handoffs', () => {
  const graph = new FlowService().loadPayload({
    nodes: [
      { id: 'a', label: 'Plan', provider: 'openai', model: 'gpt-4o-mini', prompt: 'plan the work' },
      {
        id: 'b',
        label: 'Write',
        provider: 'openai',
        model: 'gpt-4o-mini',
        prompt: 'Read the run input and write the answer.',
      },
    ],
    edges: [{ id: 'e1', source: 'a', target: 'b', condition: 'planned' }],
  });
  const warning = lintGraph(graph).find((candidate) => candidate.code === 'downstream-reads-input');

  assert.ok(warning);
  assert.match(warning.hint, /replaces the default predecessor handoffs/);
});

test('output schema violations are actionable', () => {
  assert.deepEqual(
    checkOutput({ maxLines: 1 }, 'one\ntwo'),
    ['expected at most 1 non-empty line(s), got 2'],
  );
  assert.deepEqual(checkOutput({ mustNotContain: ['cannot'] }, 'I CANNOT do that'), [
    'the output must not contain "cannot"',
  ]);
});
