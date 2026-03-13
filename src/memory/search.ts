import { readFile } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { glob } from 'glob';
import { LocalIndex } from 'vectra';
import OpenAI from 'openai';
import type { MemorySearchResult } from '../types.js';
import { proxyFetch } from '../net.js';
import { getCopilotSessionToken, COPILOT_HEADERS } from '../copilot-auth.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MemoryChunk {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  hash: string;
}

export interface MemoryIndex {
  vectraIndex: LocalIndex | null;
  chunks: MemoryChunk[];
  provider: 'openai' | 'copilot' | 'ollama' | 'keyword';
  embedFn: EmbedFn | null;
  apiKey: string;
  model: string;
}

type EmbedFn = (text: string) => Promise<number[]>;

// ── Hashing ──────────────────────────────────────────────────────────────────

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ── Chunking ─────────────────────────────────────────────────────────────────

function splitIntoChunks(text: string, filePath: string, chunkSize = 500): MemoryChunk[] {
  const chunks: MemoryChunk[] = [];
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';
  let chunkStart = 1;
  let lineNumber = 1;

  for (const paragraph of paragraphs) {
    const paragraphLines = paragraph.split('\n').length;

    if (currentChunk.length + paragraph.length > chunkSize && currentChunk.length > 0) {
      const endLine = lineNumber - 1;
      const content = currentChunk.trim();
      chunks.push({
        filePath,
        lineStart: chunkStart,
        lineEnd: endLine,
        content,
        hash: contentHash(content),
      });
      chunkStart = lineNumber;
      currentChunk = paragraph + '\n\n';
    } else {
      currentChunk += paragraph + '\n\n';
    }

    lineNumber += paragraphLines + 1;
  }

  if (currentChunk.trim().length > 0) {
    const content = currentChunk.trim();
    chunks.push({
      filePath,
      lineStart: chunkStart,
      lineEnd: lineNumber - 1,
      content,
      hash: contentHash(content),
    });
  }

  return chunks;
}

// ── Embedding providers ──────────────────────────────────────────────────────

function createOpenAIEmbed(apiKey: string, model: string): EmbedFn {
  const client = new OpenAI({ apiKey });
  return async (text: string) => {
    const response = await client.embeddings.create({ model, input: text });
    return response.data[0].embedding;
  };
}

function createCopilotEmbed(): EmbedFn {
  let tokenPromise: Promise<string> | null = null;
  const MODELS = ['copilot-text-embedding-ada-002', 'text-embedding-ada-002', 'text-embedding-3-small'];

  return async (text: string) => {
    if (!tokenPromise) tokenPromise = getCopilotSessionToken('device');
    const token = await tokenPromise;

    let lastError = '';
    for (const model of MODELS) {
      const response = await proxyFetch('https://api.githubcopilot.com/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...COPILOT_HEADERS,
        },
        body: JSON.stringify({
          model,
          input: [text],
        }),
      });

      if (response.ok) {
        const data = await response.json() as { data: Array<{ embedding: number[] }> };
        if (data.data?.[0]?.embedding) {
          return data.data[0].embedding;
        }
      }

      lastError = `${model}: ${response.status}`;
      const body = await response.text().catch(() => '');
      if (body) lastError += ` ${body.slice(0, 200)}`;
    }

    throw new Error(`Copilot embeddings failed (${lastError})`);
  };
}

// ── Ollama embeddings (fallback 3: local, no API key) ────────────────────────

const OLLAMA_MODELS = ['nomic-embed-text', 'gte-large-en-v1.5', 'all-minilm', 'mxbai-embed-large'];

function createOllamaEmbed(): EmbedFn {
  const baseUrl = process.env.OLLAMA_HOST || 'http://localhost:11434';

  return async (text: string) => {
    let lastError = '';
    for (const model of OLLAMA_MODELS) {
      try {
        const response = await fetch(`${baseUrl}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, input: text }),
        });

        if (response.ok) {
          const data = await response.json() as { embeddings?: number[][]; embedding?: number[] };
          const embedding = data.embeddings?.[0] ?? data.embedding;
          if (embedding && embedding.length > 0) return embedding;
        }

        lastError = `${model}: ${response.status}`;
      } catch (e) {
        lastError = `${model}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    throw new Error(`Ollama embeddings failed (${lastError})`);
  };
}

// ── Keyword search (fallback 4: no API needed) ──────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function keywordScore(query: string, content: string): number {
  const queryTokens = tokenize(query);
  const contentTokens = new Set(tokenize(content));
  if (queryTokens.length === 0) return 0;

  let matches = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      matches++;
    } else {
      for (const ct of contentTokens) {
        if (ct.includes(token) || token.includes(ct)) {
          matches += 0.5;
          break;
        }
      }
    }
  }

  const relevance = matches / queryTokens.length;
  const brevityBonus = Math.min(1, 200 / Math.max(content.length, 1));
  return relevance * 0.8 + relevance * brevityBonus * 0.2;
}

// ── Load chunks from workspace ───────────────────────────────────────────────

async function loadChunks(workspacePath: string): Promise<MemoryChunk[]> {
  const allChunks: MemoryChunk[] = [];

  const memoryPath = join(workspacePath, 'MEMORY.md');
  try {
    const content = await readFile(memoryPath, 'utf-8');
    allChunks.push(...splitIntoChunks(content, memoryPath));
  } catch { /* skip */ }

  const pattern = join(workspacePath, 'memory', '*.md');
  const memFiles = await glob(pattern);
  for (const filePath of memFiles) {
    try {
      const content = await readFile(filePath, 'utf-8');
      allChunks.push(...splitIntoChunks(content, filePath));
    } catch { /* skip */ }
  }

  return allChunks;
}

// ── Vectra index sync ────────────────────────────────────────────────────────

async function syncVectraIndex(
  vectraIndex: LocalIndex,
  chunks: MemoryChunk[],
  embed: EmbedFn,
): Promise<{ added: number; removed: number }> {
  // Get existing items from Vectra
  const existingItems = await vectraIndex.listItems();
  const existingByHash = new Map<string, string>(); // hash → id
  for (const item of existingItems) {
    const hash = item.metadata.hash as string;
    if (hash) existingByHash.set(hash, item.id);
  }

  // Determine what's new and what's stale
  const currentHashes = new Set(chunks.map(c => c.hash));
  const toAdd = chunks.filter(c => !existingByHash.has(c.hash));
  const toRemove = [...existingByHash.entries()].filter(([hash]) => !currentHashes.has(hash));

  // Remove stale items
  for (const [, id] of toRemove) {
    await vectraIndex.deleteItem(id);
  }

  // Add new items
  for (const chunk of toAdd) {
    const vector = await embed(chunk.content);
    await vectraIndex.insertItem({
      vector,
      metadata: {
        content: chunk.content,
        filePath: chunk.filePath,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        hash: chunk.hash,
      },
    });
  }

  return { added: toAdd.length, removed: toRemove.length };
}

// ── Build index with fallback chain ──────────────────────────────────────────

export async function buildIndex(
  workspacePath: string,
  apiKey: string,
  model = 'text-embedding-3-small'
): Promise<MemoryIndex> {
  const allChunks = await loadChunks(workspacePath);

  if (allChunks.length === 0) {
    return { vectraIndex: null, chunks: allChunks, provider: 'keyword', embedFn: null, apiKey, model };
  }

  // Initialize Vectra local index
  const indexPath = join(workspacePath, '.vectra');
  const vectraIndex = new LocalIndex(indexPath);
  if (!await vectraIndex.isIndexCreated()) {
    await vectraIndex.createIndex();
  }

  // Try embedding providers in order: OpenAI → Copilot → Ollama → Keyword
  const providers: Array<{ name: 'openai' | 'copilot' | 'ollama'; create: () => EmbedFn }> = [];

  if (apiKey) {
    providers.push({ name: 'openai', create: () => createOpenAIEmbed(apiKey, model) });
  }
  providers.push({ name: 'copilot', create: () => createCopilotEmbed() });
  providers.push({ name: 'ollama', create: () => createOllamaEmbed() });

  for (const { name, create } of providers) {
    try {
      const embed = create();
      // Test with first chunk to verify the provider works
      const testEmbedding = await embed(allChunks[0].content.slice(0, 100));
      if (!testEmbedding || testEmbedding.length === 0) throw new Error('Empty embedding');

      // Provider works — sync Vectra index (only embed new/changed chunks)
      const { added, removed } = await syncVectraIndex(vectraIndex, allChunks, embed);

      console.error(`[memory] Using ${name} embeddings via Vectra (${allChunks.length} chunks, +${added}/-${removed} synced)`);
      return { vectraIndex, chunks: allChunks, provider: name, embedFn: embed, apiKey, model };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[memory] ${name} embeddings failed: ${msg}, trying next...`);
    }
  }

  // All embedding providers failed — fall back to keyword search
  console.error(`[memory] Using keyword search fallback (${allChunks.length} chunks)`);
  return { vectraIndex: null, chunks: allChunks, provider: 'keyword', embedFn: null, apiKey, model };
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function searchMemory(
  query: string,
  index: MemoryIndex,
  apiKey: string,
  topN = 5
): Promise<MemorySearchResult[]> {

  if (index.provider === 'keyword' || !index.vectraIndex || !index.embedFn) {
    return keywordSearch(query, index.chunks, topN);
  }

  try {
    const queryVector = await index.embedFn(query);
    const results = await index.vectraIndex.queryItems(queryVector, query, topN);

    return results.map(r => ({
      content: r.item.metadata.content as string,
      filePath: r.item.metadata.filePath as string,
      lineStart: r.item.metadata.lineStart as number,
      lineEnd: r.item.metadata.lineEnd as number,
      score: r.score,
    }));
  } catch {
    // If vector search fails at query time, fall back to keyword
    return keywordSearch(query, index.chunks, topN);
  }
}

function keywordSearch(query: string, chunks: MemoryChunk[], topN: number): MemorySearchResult[] {
  const scored = chunks
    .map((chunk) => ({
      chunk,
      score: keywordScore(query, chunk.content),
    }))
    .filter(({ score }) => score > 0);

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topN).map(({ chunk, score }) => ({
    content: chunk.content,
    filePath: chunk.filePath,
    lineStart: chunk.lineStart,
    lineEnd: chunk.lineEnd,
    score,
  }));
}
