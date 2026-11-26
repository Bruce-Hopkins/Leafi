import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { RequestId, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpContext } from './context';
import { withToolErrors } from './errors';
import type { AskPerson } from './permission-request';
import { TOOLS } from './registry';
import { registerResources } from './resources';
import { isMilestone, RUN_EVENTS_CAPABILITY, RUN_NOTIFICATION, settledParams, summarize, type RunNotificationParams } from './run-notifications';
import type { ToolCall } from './tools/types';
import { VERSION } from '../version';

/** How long a question to the person may wait for an answer before it counts as a refusal. */
export const ASK_TIMEOUT_MS = 5 * 60 * 1000;

export function createMcpServer(context: McpContext): McpServer {
  const server = new McpServer({ name: 'leafi', version: VERSION });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (input: unknown, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) =>
        withToolErrors(() => tool.handle(input as never, context, toolCall(server, extra)), context),
    );
  }

  registerResources(server);
  server.server.oninitialized = () => {
    if (pushesRunEvents(server)) {
      pushRunEvents(server, context);
    }
  };
  return server;
}

function toolCall(server: McpServer, extra: RequestHandlerExtra<ServerRequest, ServerNotification>): ToolCall {
  const token = extra._meta?.progressToken;
  let sent = 0;
  return {
    ask: askPerson(server, extra.requestId),
    signal: extra.signal,
    pluginDelivery: pushesRunEvents(server),
    ...(token !== undefined
      ? {
          progress: (message: string) => {
            sent += 1; // progress must increase with each notification
            return extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: sent, message } });
          },
        }
      : {}),
  };
}

/** Whether the client is a leafi plugin that draws run progress itself. */
function pushesRunEvents(server: McpServer): boolean {
  return server.server.getClientCapabilities()?.experimental?.[RUN_EVENTS_CAPABILITY] !== undefined;
}

/**
 * Sends a plugin each milestone of every run, and once more when a run's
 * record is final. Over stdio a server has one client, so every run here is
 * that client's. The text is written by the runtime, never node output.
 */
function pushRunEvents(server: McpServer, context: McpContext): void {
  const labels = new Map<string, string>();
  const send = (params: RunNotificationParams): void => {
    // Not a standard MCP notification, so the SDK's typed notification() cannot name it.
    void (server.server as unknown as { notification(n: { method: string; params: RunNotificationParams }): Promise<void> })
      .notification({ method: RUN_NOTIFICATION, params })
      .catch((error: unknown) => context.logger.error('Could not push a run event to the plugin', error));
  };
  context.runManager.feed.subscribe({
    event(event) {
      const label = event.payload.label;
      if (event.nodeId && typeof label === 'string') {
        labels.set(`${event.runId}:${event.nodeId}`, label);
      }
      if (isMilestone(event)) {
        send({ runId: event.runId, kind: 'event', event: summarize(event, event.nodeId ? labels.get(`${event.runId}:${event.nodeId}`) : undefined) });
      }
    },
    settled(run) {
      for (const key of labels.keys()) {
        if (key.startsWith(`${run.id}:`)) {
          labels.delete(key);
        }
      }
      send(settledParams(run));
    },
  });
}

/**
 * The client's form questions, tied to the tool call that asks, or nothing
 * when the client did not say it can show them. A client that advertises a
 * bare `elicitation: {}` supports forms; the SDK reads it that way.
 */
function askPerson(server: McpServer, requestId: RequestId): AskPerson | undefined {
  if (!server.server.getClientCapabilities()?.elicitation?.form) {
    return undefined;
  }
  return (params) => server.server.elicitInput(params, { relatedRequestId: requestId, timeout: ASK_TIMEOUT_MS });
}
