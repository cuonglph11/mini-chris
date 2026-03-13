import { buildIndex, searchMemory as searchMemoryRaw } from './search.js';
import type { MemorySearchResult } from '../types.js';

export { injectWorkspaceContext } from './inject.js';
export { appendToMemory, appendToDailyLog, syncMemory } from './persist.js';
export { buildIndex } from './search.js';
export {
  DEFAULT_FLUSH_CONFIG,
  shouldFlushMemory,
  buildFlushPrompt,
} from './flush.js';
export type { FlushConfig } from './flush.js';
export { getMemoryTools, executeMemorySearch, executeMemorySave, resetMemoryCache } from './tools.js';

/**
 * Convenience wrapper: builds the embedding index then searches it.
 */
export async function searchMemory(
  query: string,
  workspace: string,
  apiKey: string,
  embeddingModel?: string,
): Promise<MemorySearchResult[]> {
  const index = await buildIndex(workspace, apiKey, embeddingModel);
  return searchMemoryRaw(query, index, apiKey);
}
