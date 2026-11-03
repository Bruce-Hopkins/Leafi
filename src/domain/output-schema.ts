import type { OutputSchema } from './types';

/** A node gets this many complete_task attempts before the node fails. */
export const MAX_OUTPUT_ATTEMPTS = 3;

/**
 * Why `text` does not satisfy the node's output schema, in words the agent can
 * act on. Empty array means it complied. Lines are compared after trimming, so
 * blank separators do not count against a line budget.
 */
export function checkOutput(schema: OutputSchema, text: string): string[] {
  const violations: string[] = [];
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (schema.minLines !== undefined && lines.length < schema.minLines) {
    violations.push(`expected at least ${schema.minLines} non-empty line(s), got ${lines.length}`);
  }
  if (schema.maxLines !== undefined && lines.length > schema.maxLines) {
    violations.push(`expected at most ${schema.maxLines} non-empty line(s), got ${lines.length}`);
  }

  if (schema.linePattern) {
    const pattern = new RegExp(schema.linePattern);
    const failing = lines.find((line) => !pattern.test(line));
    if (failing !== undefined) {
      violations.push(`every non-empty line must match /${schema.linePattern}/; this one does not: ${truncate(failing)}`);
    }
  }

  for (const required of schema.mustContain ?? []) {
    if (!includesText(text, required)) {
      violations.push(`the output must contain "${required}"`);
    }
  }
  for (const forbidden of schema.mustNotContain ?? []) {
    if (includesText(text, forbidden)) {
      violations.push(`the output must not contain "${forbidden}"`);
    }
  }

  return violations;
}

/** A schema that cannot be enforced, or `undefined` when it is well formed. */
export function findInvalidOutputSchema(schema: OutputSchema): string | undefined {
  for (const field of ['minLines', 'maxLines'] as const) {
    const value = schema[field];
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      return `outputSchema.${field} must be a non-negative integer.`;
    }
  }
  if (schema.minLines !== undefined && schema.maxLines !== undefined && schema.minLines > schema.maxLines) {
    return 'outputSchema.minLines cannot exceed maxLines.';
  }
  for (const required of schema.mustContain ?? []) {
    if ((schema.mustNotContain ?? []).some((forbidden) => forbidden.toLowerCase() === required.toLowerCase())) {
      return `outputSchema requires "${required}" and forbids it at the same time; no output can satisfy this.`;
    }
  }
  if (schema.linePattern !== undefined) {
    try {
      new RegExp(schema.linePattern);
    } catch {
      return `outputSchema.linePattern is not a valid regular expression: ${schema.linePattern}`;
    }
  }
  return undefined;
}

/** The shape, as instructions a node's system prompt can carry. */
export function describeOutputSchema(schema: OutputSchema): string[] {
  const lines: string[] = [];

  if (schema.minLines !== undefined && schema.minLines === schema.maxLines) {
    lines.push(`Produce exactly ${schema.minLines} non-empty line(s).`);
  } else if (schema.minLines !== undefined || schema.maxLines !== undefined) {
    const bound =
      schema.minLines === undefined
        ? `at most ${schema.maxLines}`
        : schema.maxLines === undefined
          ? `at least ${schema.minLines}`
          : `between ${schema.minLines} and ${schema.maxLines}`;
    lines.push(`Produce ${bound} non-empty line(s).`);
  }

  if (schema.linePattern) {
    const hint = schema.linePatternHint ? ` (${schema.linePatternHint})` : '';
    lines.push(`Every non-empty line must match this regular expression: /${schema.linePattern}/${hint}`);
  }
  if (schema.mustContain?.length) {
    lines.push(`The output must contain: ${schema.mustContain.join(', ')}.`);
  }
  if (schema.mustNotContain?.length) {
    lines.push(`The output must not contain: ${schema.mustNotContain.join(', ')}.`);
  }

  lines.push('The runtime checks this the moment you call complete_task: if the output does not match, it is rejected and you get another try.');
  return lines;
}

export function hasOutputSchema(schema: OutputSchema | undefined): schema is OutputSchema {
  if (!schema) {
    return false;
  }
  return (
    schema.minLines !== undefined ||
    schema.maxLines !== undefined ||
    schema.linePattern !== undefined ||
    (schema.mustContain?.length ?? 0) > 0 ||
    (schema.mustNotContain?.length ?? 0) > 0
  );
}

function includesText(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle.toLowerCase());
}

function truncate(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}
