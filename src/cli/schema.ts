import { UsageError, assertFlags, EXIT, GLOBAL_FLAGS, type ExitCode, type ParsedArgs } from './args';
import { EXAMPLE_FLOW, FLOW_SCHEMA } from '../app/flow-schema';

export { EXAMPLE_FLOW, FLOW_SCHEMA } from '../app/flow-schema';

export function runSchema(parsed: ParsedArgs): ExitCode {
  assertFlags(parsed, [...GLOBAL_FLAGS]);
  const target = parsed.positionals[0];
  if (parsed.positionals.length > 1) {
    throw new UsageError(`Unexpected argument "${parsed.positionals[1]}".`);
  }

  if (target === undefined) {
    writeJson(FLOW_SCHEMA);
    return EXIT.success;
  }
  if (target === 'example') {
    writeJson(EXAMPLE_FLOW);
    return EXIT.success;
  }

  throw new UsageError(`Unknown schema target "${target}". Use "schema" or "schema example".`);
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
