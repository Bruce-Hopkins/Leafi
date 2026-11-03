import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import type { RuntimeConfig } from '../config/runtime-config';
import type { AgentNode } from '../domain/types';
import { NodeFailureError } from '../graph/node-failure';
import { ReasoningRelay } from './reasoning-relay';

/**
 * Every provider gets its address explicitly. Left unset, the LangChain clients
 * read `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `LANGSMITH_GATEWAY` and similar
 * from the environment, and would send the user's key wherever those point.
 */
export const PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
  openrouter: 'https://openrouter.ai/api/v1',
} as const;

export class ModelFactory {
  constructor(private readonly config: RuntimeConfig) {}

  create(node: AgentNode): BaseChatModel {
    const apiKey = this.config.apiKeyFor(node.provider);
    if (!apiKey) {
      throw new NodeFailureError(
        `No API key is configured for provider "${node.provider}". Add one to the environment and retry.`,
        node.id,
      );
    }

    switch (node.provider) {
      case 'openai':
        // The standard tier, named outright: a project default of flex or fast
        // would otherwise bill at rates the run's list-price cost does not use.
        return new ChatOpenAI({
          model: node.model,
          apiKey,
          service_tier: 'default',
          configuration: { baseURL: PROVIDER_BASE_URLS.openai },
        });
      case 'anthropic':
        return new ChatAnthropic({ model: node.model, apiKey, anthropicApiUrl: PROVIDER_BASE_URLS.anthropic });
      case 'google':
        return new ChatGoogleGenerativeAI({ model: node.model, apiKey, baseUrl: PROVIDER_BASE_URLS.google });
      case 'openrouter':
        // The relay carries the model's reasoning from step to step, as OpenRouter asks.
        return new ChatOpenAI({
          model: node.model,
          apiKey,
          configuration: { baseURL: PROVIDER_BASE_URLS.openrouter, fetch: new ReasoningRelay().fetch },
        });
      default:
        throw new NodeFailureError(`Unknown provider "${String(node.provider)}".`, node.id);
    }
  }
}
