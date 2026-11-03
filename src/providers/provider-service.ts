import type { RuntimeConfig } from '../config/runtime-config';
import type { ProviderInfo } from '../domain/types';
import { fetchModels } from './model-catalog';
import type { ProviderDefinition } from './provider-catalog';

const CACHE_TTL_MS = 5 * 60 * 1000;
const FALLBACK_TTL_MS = 60 * 1000;

/** The provider list for `providers` and for MCP clients. */
export class ProviderService {
  private readonly cache = new Map<string, { models: string[]; expiresAt: number }>();

  constructor(private readonly config: RuntimeConfig) {}

  async list(): Promise<ProviderInfo[]> {
    return Promise.all(
      this.config.availableProviders().map(async (definition) => ({
        id: definition.id,
        label: definition.label,
        models: await this.modelsFor(definition),
      })),
    );
  }

  private async modelsFor(definition: ProviderDefinition): Promise<string[]> {
    const cached = this.cache.get(definition.id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.models;
    }

    try {
      const listed = await fetchModels(definition, this.config.apiKeyFor(definition.id));
      if (listed.length > 0) {
        const models = orderModels(listed, definition.models);
        this.cache.set(definition.id, { models, expiresAt: Date.now() + CACHE_TTL_MS });
        return models;
      }
    } catch {
      // Fall through to the static catalog.
    }

    this.cache.set(definition.id, { models: definition.models, expiresAt: Date.now() + FALLBACK_TTL_MS });
    return definition.models;
  }
}

/** Keeps the catalog's known-good models first so a default selection stays sensible. */
function orderModels(models: string[], preferred: string[]): string[] {
  const unique = [...new Set(models)];
  const known = preferred.filter((model) => unique.includes(model));
  const rest = unique.filter((model) => !known.includes(model));
  return [...known, ...rest];
}
