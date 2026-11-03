import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import type { ToolOutput } from '../tool-output';
import { connectMcpClient, isRecord, type McpToolInfo } from './mcp-client';

/**
 * The browser tools a node can hold by default. They are the read-and-navigate
 * set: enough to open a feed, extract its posts, and dismiss a consent banner,
 * without paying for the console, network, performance and memory tools' schemas
 * on every iteration.
 */
export const DEFAULT_BROWSER_TOOLS = [
  'new_page',
  'navigate_page',
  'take_snapshot',
  'evaluate_script',
  'list_pages',
  'wait_for',
  'click',
  'type_text',
  'press_key',
] as const;

export interface BrowserToolkitOptions {
  /** The MCP launcher command, e.g. `npx -y chrome-devtools-mcp@1.10.1 --headless`. */
  command: string;
  /** The data directory that holds the server's private home. */
  dataDir: string;
  timeoutMs: number;
  /** The node's output budget; oversized results are saved for it to read on from. */
  output: ToolOutput;
  /** Tool names to bind. Anything else the server offers is not shown to the model. */
  allowlist: readonly string[];
  signal?: AbortSignal;
}

export interface BrowserToolkit {
  schemas: StructuredToolInterface[];
  /** Runs a browser tool, or returns undefined when `name` is not one of ours. */
  execute(name: string, args: Record<string, unknown>): Promise<string | undefined>;
  /** Stops the MCP server and the browser it launched. Safe when no tool ran. */
  dispose(): Promise<void>;
}

const DESCRIPTION_LIMIT = 600;
/** The tools whose results run long; only they carry the output-budget sentence. */
const LONG_RESULT_TOOLS = new Set(['take_snapshot', 'evaluate_script']);
const COMPACT_HINT = 'next time extract less, e.g. with evaluate_script returning a compact array';

/**
 * Binds a browser MCP server's tools to a node. The permission decides whether
 * this exists at all; the allowlist decides which of the server's tools the
 * model ever sees, so a node cannot reach past its own contract.
 */
export async function createBrowserToolkit(options: BrowserToolkitOptions): Promise<BrowserToolkit> {
  const client = await connectMcpClient({
    command: options.command,
    dataDir: options.dataDir,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });

  const permitted = client.tools.filter((candidate) => options.allowlist.includes(candidate.name));
  const schemas = permitted.map((candidate) => bindTool(candidate, options.output.describe()));
  const allowed = new Set(permitted.map((candidate) => candidate.name));

  return {
    schemas,
    async execute(name, args) {
      if (!allowed.has(name)) {
        return undefined;
      }
      try {
        const text = await client.callTool(name, args);
        return await options.output.cap(name, text, { hint: COMPACT_HINT });
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    dispose: () => client.close(),
  };
}

/** The server's tools, named, so a flow can be checked against what it offers. */
export async function listBrowserTools(options: {
  command: string;
  dataDir: string;
  timeoutMs: number;
}): Promise<McpToolInfo[]> {
  const client = await connectMcpClient(options);
  try {
    return client.tools;
  } finally {
    await client.close();
  }
}

function bindTool(info: McpToolInfo, budget: string): StructuredToolInterface {
  const properties = isRecord(info.inputSchema.properties) ? info.inputSchema.properties : {};
  const required = requiredNames(info.inputSchema);

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, property] of Object.entries(properties)) {
    const field = toZod(property);
    shape[name] = required.includes(name) ? field : field.optional();
  }

  return tool(async () => '', {
    name: info.name,
    description: LONG_RESULT_TOOLS.has(info.name) ? `${clip(info.description)} ${budget}` : clip(info.description),
    schema: z.object(shape),
  });
}

/** JSON Schema → Zod, for the types MCP tool inputs actually use. */
function toZod(schema: unknown): z.ZodTypeAny {
  const field = coreType(schema);
  const description = isRecord(schema) && typeof schema.description === 'string' ? schema.description : undefined;
  return description ? (field.describe(clip(description)) as z.ZodTypeAny) : field;
}

function coreType(schema: unknown): z.ZodTypeAny {
  if (!isRecord(schema)) {
    return z.unknown();
  }

  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union)) {
    const branches = union.map((branch) => toZod(branch));
    return branches.length > 0 ? z.union(branches as [z.ZodTypeAny, ...z.ZodTypeAny[]]) : z.unknown();
  }

  const values = schema.enum;
  if (Array.isArray(values) && values.length > 0 && values.every((value) => typeof value === 'string')) {
    return z.enum(values as [string, ...string[]]);
  }

  switch (schema.type) {
    case 'string':
      return z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(toZod(schema.items));
    case 'object':
      return isRecord(schema.properties) ? objectType(schema) : z.record(z.string(), z.unknown());
    default:
      return z.unknown();
  }
}

function objectType(schema: Record<string, unknown>): z.ZodTypeAny {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = requiredNames(schema);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, property] of Object.entries(properties)) {
    const field = toZod(property);
    shape[name] = required.includes(name) ? field : field.optional();
  }
  return z.object(shape);
}

function requiredNames(schema: Record<string, unknown>): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === 'string')
    : [];
}

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > DESCRIPTION_LIMIT ? `${trimmed.slice(0, DESCRIPTION_LIMIT)}…` : trimmed;
}

