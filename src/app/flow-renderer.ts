import { outgoingEdges } from '../domain/graph-utils';
import type { AgentNode, Graph, GraphEdge } from '../domain/types';

export type RenderFormat = 'ascii' | 'mermaid' | 'dot';

export function renderFlow(graph: Graph, format: RenderFormat): string {
  switch (format) {
    case 'mermaid':
      return renderMermaid(graph);
    case 'dot':
      return renderDot(graph);
    case 'ascii':
      return renderAscii(graph);
  }
}

function renderAscii(graph: Graph): string {
  if (graph.nodes.length === 0) {
    return '(empty flow)';
  }

  const levels = nodeLevels(graph);
  const lines: string[] = [`${graph.name} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`, ''];

  for (const [nodeId, level] of levels) {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      continue;
    }
    const indent = '  '.repeat(level);
    const audience = node.audience === 'person' ? '  (person reads this)' : '';
    lines.push(`${indent}[${node.label} · ${node.model}]${audience}`);
    for (const edge of outgoingEdges(graph, node.id)) {
      lines.push(`${indent}  ${edgeArrow(edge)} [${labelOf(graph, edge.target)}]`);
    }
  }

  return lines.join('\n');
}

function renderMermaid(graph: Graph): string {
  const lines = ['flowchart TD'];
  for (const node of graph.nodes) {
    lines.push(`  ${mermaidId(node)}["${escapeMermaid(node.label)}<br/>${escapeMermaid(node.model)}"]`);
  }
  for (const edge of graph.edges) {
    const source = graph.nodes.find((candidate) => candidate.id === edge.source);
    const target = graph.nodes.find((candidate) => candidate.id === edge.target);
    if (!source || !target) {
      continue;
    }
    const label = edgeLabel(edge);
    lines.push(
      `  ${mermaidId(source)} -->${label ? `|"${escapeMermaid(label)}"|` : ''} ${mermaidId(target)}`,
    );
  }
  return lines.join('\n');
}

function renderDot(graph: Graph): string {
  const lines = ['digraph flow {', '  rankdir=TB;'];
  for (const node of graph.nodes) {
    lines.push(`  "${dotId(node.id)}" [label="${escapeDot(node.label)}\\n${escapeDot(node.model)}"];`);
  }
  for (const edge of graph.edges) {
    const label = edgeLabel(edge);
    lines.push(
      `  "${dotId(edge.source)}" -> "${dotId(edge.target)}"${label ? ` [label="${escapeDot(label)}"]` : ''};`,
    );
  }
  lines.push('}');
  return lines.join('\n');
}

/** Longest-path layering, which makes entries start at the left and joins settle late. */
function nodeLevels(graph: Graph): Map<string, number> {
  const levels = new Map<string, number>();
  const visiting = new Set<string>();

  const levelOf = (nodeId: string): number => {
    const known = levels.get(nodeId);
    if (known !== undefined) {
      return known;
    }
    visiting.add(nodeId);
    const incoming = graph.edges.filter((edge) => edge.target === nodeId && edge.maxTraversals === undefined);
    const level =
      incoming.length === 0
        ? 0
        : Math.max(
            ...incoming.map((edge) => (visiting.has(edge.source) ? 0 : levelOf(edge.source) + 1)),
          );
    visiting.delete(nodeId);
    levels.set(nodeId, level);
    return level;
  };

  for (const node of graph.nodes) {
    levelOf(node.id);
  }
  return levels;
}

function edgeArrow(edge: GraphEdge): string {
  const label = edgeLabel(edge);
  return label ? `--(${label})-->` : '-->';
}

function edgeLabel(edge: GraphEdge): string {
  const branch = edge.branch?.trim();
  const condition = edge.condition?.trim();
  const text = branch && condition ? `${branch}: ${condition}` : branch || condition || '';
  if (edge.maxTraversals === undefined) {
    return text;
  }
  const limit = `↺ at most ${edge.maxTraversals}×`;
  return text ? `${text} (${limit})` : limit;
}

function labelOf(graph: Graph, nodeId: string): string {
  return graph.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function mermaidId(node: AgentNode): string {
  return `n_${node.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function escapeMermaid(text: string): string {
  return text.replace(/"/g, '&quot;');
}

function dotId(text: string): string {
  return text.replace(/["\\]/g, '\\$&');
}

function escapeDot(text: string): string {
  return text.replace(/["\\]/g, '\\$&');
}
