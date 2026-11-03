import { validateFlow } from '../app/flow-validation';
import {
  assertFlags,
  assertNoPositionals,
  EXIT,
  GLOBAL_FLAGS,
  readBooleanFlag,
  requireFlag,
  type ExitCode,
  type ParsedArgs,
} from './args';
import type { CommandContext } from './context';

export async function runValidate(parsed: ParsedArgs, context: CommandContext): Promise<ExitCode> {
  assertFlags(parsed, ['graph', 'strict', ...GLOBAL_FLAGS]);
  assertNoPositionals(parsed);

  const graph = await context.flows.loadPath(requireFlag(parsed, 'graph'));
  const validation = validateFlow(graph, context.config);
  const strict = readBooleanFlag(parsed, 'strict');

  writeJson(validation);
  if (!validation.ok || (strict && validation.warnings.length > 0)) {
    return EXIT.invalidInput;
  }
  return EXIT.success;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
