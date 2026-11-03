import type { RuntimeConfig } from '../config/runtime-config';
import { minimumGraph, type FlowMinimum } from '../domain/flow-estimate';
import { lintGraph, type LintWarning } from '../domain/flow-lint';
import { validateGraph } from '../domain/graph-validation';
import type { Graph, ValidationIssue } from '../domain/types';

export interface FlowValidation {
  ok: boolean;
  issues: ValidationIssue[];
  warnings: LintWarning[];
  minimum?: FlowMinimum;
}

/** Validation, lint and the minimum the flow implies; no model calls and no network. */
export function validateFlow(graph: Graph, config: RuntimeConfig): FlowValidation {
  const issues = validateGraph(graph);
  const warnings = issues.length === 0 ? lintGraph(graph) : [];
  const minimum = issues.length === 0 ? minimumGraph(graph, config) : undefined;

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    ...(minimum ? { minimum } : {}),
  };
}
