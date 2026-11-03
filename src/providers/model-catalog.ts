import type { ProviderDefinition } from './provider-catalog';

const FETCH_TIMEOUT_MS = 5000;
const OPENAI_CHAT_PREFIX = /^(gpt-|o1|o3|o4|chatgpt)/;

/**
 * Queries a provider's own model endpoint and returns the chat-capable ids.
 * Throws on any failure so the caller can fall back to the static catalog. All
 * request URLs are fixed provider endpoints; only headers carry credentials.
 */
export async function fetchModels(definition: ProviderDefinition, apiKey: string | undefined): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    switch (definition.id) {
      case 'openai':
        return chatModelIds(await fetchJson('https://api.openai.com/v1/models', {
          headers: { authorization: `Bearer ${apiKey ?? ''}` },
        }, controller.signal));
      case 'anthropic':
        return idList(await fetchJson('https://api.anthropic.com/v1/models?limit=1000', {
          headers: { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' },
        }, controller.signal));
      case 'google':
        return googleModelIds(await fetchJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
          headers: { 'x-goog-api-key': apiKey ?? '' },
        }, controller.signal));
      case 'openrouter':
        return idList(await fetchJson('https://openrouter.ai/api/v1/models', {}, controller.signal)).sort();
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { ...init, signal });
  if (!response.ok) {
    throw new Error(`The model list request failed with status ${response.status}.`);
  }
  return (await response.json()) as unknown;
}

function idList(body: unknown): string[] {
  return arrayField(body, 'data').flatMap((entry) => {
    const id = stringField(entry, 'id');
    return id ? [id] : [];
  });
}

function chatModelIds(body: unknown): string[] {
  return idList(body)
    .filter((id) => OPENAI_CHAT_PREFIX.test(id))
    .sort();
}

function googleModelIds(body: unknown): string[] {
  return arrayField(body, 'models').flatMap((entry) => {
    const name = stringField(entry, 'name');
    if (!name || !stringArrayField(entry, 'supportedGenerationMethods').includes('generateContent')) {
      return [];
    }
    return [name.replace(/^models\//, '')];
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayField(value: unknown, key: string): unknown[] {
  const field = asRecord(value)?.[key];
  return Array.isArray(field) ? field : [];
}

function stringField(value: unknown, key: string): string | undefined {
  const field = asRecord(value)?.[key];
  return typeof field === 'string' && field.trim().length > 0 ? field : undefined;
}

function stringArrayField(value: unknown, key: string): string[] {
  const field = asRecord(value)?.[key];
  return Array.isArray(field) ? field.filter((entry): entry is string => typeof entry === 'string') : [];
}
