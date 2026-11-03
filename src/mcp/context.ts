import type { RuntimeConfig } from '../config/runtime-config';
import type { FlowService } from '../app/flow-service';
import type { RunService } from '../app/run-service';
import type { ProviderService } from '../providers/provider-service';
import type { RunStore } from '../runtime/run-store';
import type { McpLogger } from './logger';
import type { McpPolicy } from './policy';
import type { McpResults } from './results';
import type { RunManager } from './run-manager';

/** Every dependency an MCP tool may use, assembled once in `main.ts`. */
export interface McpContext {
  config: RuntimeConfig;
  flows: FlowService;
  runs: RunService;
  runManager: RunManager;
  store: RunStore;
  providers: ProviderService;
  policy: McpPolicy;
  logger: McpLogger;
  results: McpResults;
}
