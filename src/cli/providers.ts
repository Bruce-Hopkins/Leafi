import { assertFlags, assertNoPositionals, EXIT, GLOBAL_FLAGS, type ExitCode, type ParsedArgs } from './args';
import type { CommandContext } from './context';

export async function runProviders(parsed: ParsedArgs, context: CommandContext): Promise<ExitCode> {
  assertFlags(parsed, [...GLOBAL_FLAGS]);
  assertNoPositionals(parsed);

  const providers = await context.providers.list();
  process.stdout.write(`${JSON.stringify(providers, null, 2)}\n`);
  return EXIT.success;
}
