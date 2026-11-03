import type { ProviderId } from '../domain/types';

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  envKey: string;
  models: string[];
}

export const PROVIDER_CATALOG: readonly ProviderDefinition[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    models: ['claude-haiku-5-5', 'claude-haiku-4-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
  },
  {
    id: 'google',
    label: 'Google',
    envKey: 'GOOGLE_API_KEY',
    models: ['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-pro'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    models: [
      'anthropic/claude-sonnet-5.5',
      'anthropic/claude-haiku-4.5',
      'openai/gpt-6.1-sol',
      'openai/gpt-6.1-sol-pro',
      'google/gemini-3.8-flash',
      'x-ai/grok-4.7',
      'deepseek/deepseek-v4.1-flash',
      'mistralai/mistral-medium-3-5',
    ],
  },
];
