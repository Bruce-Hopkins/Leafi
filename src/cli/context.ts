import type { RuntimeConfig } from '../config/runtime-config';
import type { FlowService } from '../app/flow-service';
import type { RunService } from '../app/run-service';
import type { ProviderService } from '../providers/provider-service';
import type { RunStore } from '../runtime/run-store';

/** Everything a CLI command may use. Built once in `main.ts`. */
export interface CommandContext {
  config: RuntimeConfig;
  flows: FlowService;
  runs: RunService;
  store: RunStore;
  providers: ProviderService;
}
