import { mkdir, readFile, appendFile } from 'fs/promises';
import { join } from 'path';
import type { ToolDefinition } from '../types.js';
import { buildIndex, searchMemory } from './search.js';
import type { MemoryIndex } from './search.js';

// ── Tool definitions ────────────────────────────────────────────────────────

export function getMemoryTools(): ToolDefinition[] {
  return [
    {
      name: 'memory_search',
      description:
        'Search long-term memory for relevant context. Use this BEFORE answering questions about past work, decisions, user preferences, or anything that might be stored in memory.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant memories',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'memory_save',
      description:
        'Save important information to long-term memory. Use this when the user shares preferences, makes decisions, or when you learn something worth remembering across sessions. Write concise, factual notes.',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The note to save to memory',
          },
          category: {
            type: 'string',
            description:
              'Optional category for the memory (e.g. "preference", "fact", "decision")',
          },
        },
        required: ['content'],
      },
    },
  ];
}

// ── Execution: memory_search ────────────────────────────────────────────────

// Cache the index so we don't rebuild embeddings on every search within a session
let cachedIndex: MemoryIndex | null = null;
let cachedWorkspace: string | null = null;

export async function executeMemorySearch(
  args: Record<string, unknown>,
  workspacePath: string,
  apiKey: string,
  embeddingModel?: string,
): Promise<string> {
  const query = args.query as string;
  const maxResults = (args.maxResults as number) ?? 5;

  if (!query || typeof query !== 'string') {
    return JSON.stringify({ error: 'query parameter is required and must be a string' });
  }

  try {
    // Rebuild index if workspace changed or first call
    if (!cachedIndex || cachedWorkspace !== workspacePath) {
      cachedIndex = await buildIndex(workspacePath, apiKey, embeddingModel);
      cachedWorkspace = workspacePath;
    }

    const results = await searchMemory(query, cachedIndex, apiKey, maxResults);

    if (results.length === 0) {
      return JSON.stringify({ results: [], message: 'No matching memories found.' });
    }

    return JSON.stringify(
      results.map((r) => ({
        content: r.content,
        filePath: r.filePath,
        lineStart: r.lineStart,
        score: r.score,
      })),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: `Memory search failed: ${message}` });
  }
}

// ── Execution: memory_save ──────────────────────────────────────────────────

function todayDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function executeMemorySave(
  args: Record<string, unknown>,
  workspacePath: string,
): Promise<string> {
  const content = args.content as string;
  const category = args.category as string | undefined;

  if (!content || typeof content !== 'string') {
    return JSON.stringify({ error: 'content parameter is required and must be a string' });
  }

  try {
    const memoryDir = join(workspacePath, 'memory');
    await mkdir(memoryDir, { recursive: true });

    const date = todayDate();
    const filePath = join(memoryDir, `${date}.md`);

    // Check if file exists; if not, create it with a date header
    let fileExists = false;
    try {
      await readFile(filePath, 'utf-8');
      fileExists = true;
    } catch {
      // File doesn't exist yet
    }

    const prefix = category ? `[${category}] ` : '';
    const entry = `- ${prefix}${content}\n`;

    if (!fileExists) {
      const header = `# ${date}\n\n`;
      await appendFile(filePath, header + entry, 'utf-8');
    } else {
      await appendFile(filePath, entry, 'utf-8');
    }

    // Invalidate the cached index so the next search picks up the new memory
    cachedIndex = null;
    cachedWorkspace = null;

    return JSON.stringify({ saved: true, filePath, date });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: `Memory save failed: ${message}` });
  }
}

// ── Convenience: reset index cache (useful for testing) ─────────────────────

export function resetMemoryCache(): void {
  cachedIndex = null;
  cachedWorkspace = null;
}
