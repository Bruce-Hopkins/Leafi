import { cancelRunTool } from './tools/cancel-run';
import { getExampleFlowTool } from './tools/get-example-flow';
import { getFlowSchemaTool } from './tools/get-flow-schema';
import { getRunEventsTool } from './tools/get-run-events';
import { getRunTool } from './tools/get-run';
import { listProvidersTool } from './tools/list-providers';
import { listRunsTool } from './tools/list-runs';
import { renderFlowTool } from './tools/render-flow';
import { startRunTool } from './tools/start-run';
import { validateFlowTool } from './tools/validate-flow';

/** The one list. Adding a tool is one file and one line here. */
export const TOOLS = [
  getFlowSchemaTool,
  getExampleFlowTool,
  validateFlowTool,
  renderFlowTool,
  listProvidersTool,
  startRunTool,
  getRunTool,
  getRunEventsTool,
  cancelRunTool,
  listRunsTool,
] as const;
