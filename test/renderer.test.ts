import assert from 'node:assert/strict';
import test from 'node:test';
import { FlowService } from '../src/app/flow-service';
import { renderFlow } from '../src/app/flow-renderer';
import { EXAMPLE_FLOW } from '../src/cli/schema';

test('ascii, mermaid and dot all include both nodes', () => {
  const graph = new FlowService().loadPayload(EXAMPLE_FLOW);
  for (const format of ['ascii', 'mermaid', 'dot'] as const) {
    const rendered = renderFlow(graph, format);
    assert.match(rendered, /Planner/);
    assert.match(rendered, /Fixer/);
    assert.match(rendered, /gpt-4o-mini/);
    assert.match(rendered, /claude-haiku|claude-sonnet/);
  }
});
