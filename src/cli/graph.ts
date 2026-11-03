import { renderFlow, type RenderFormat } from '../app/flow-renderer';
import {
  assertFlags,
  assertNoPositionals,
  EXIT,
  GLOBAL_FLAGS,
  readOptionalFlag,
  requireFlag,
  UsageError,
  type ExitCode,
  type ParsedArgs,
} from './args';
import type { CommandContext } from './context';

const FORMATS: readonly RenderFormat[] = ['ascii', 'mermaid', 'dot'];

export async function runGraph(parsed: ParsedArgs, context: CommandContext): Promise<ExitCode> {
  assertFlags(parsed, ['graph', 'format', ...GLOBAL_FLAGS]);
  assertNoPositionals(parsed);

  const requested = readOptionalFlag(parsed, 'format') ?? 'ascii';
  if (!(FORMATS as readonly string[]).includes(requested)) {
    throw new UsageError(`--format must be one of: ${FORMATS.join(', ')}.`);
  }

  const graph = await context.flows.loadPath(requireFlag(parsed, 'graph'));
  process.stdout.write(`${renderFlow(graph, requested as RenderFormat)}\n`);
  return EXIT.success;
}
