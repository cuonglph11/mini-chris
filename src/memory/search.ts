import { readFile } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';
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
  embedding?: number[];
}

export interface MemoryIndex {
  chunks: MemoryChunk[];
  embeddingCache: Map<string, number[]>;
  apiKey: string;
  model: string;
  provider: 'openai' | 'copilot' | 'ollama' | 'keyword';
}

type EmbedFn = (text: string) => Promise<number[]>;

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
      chunks.push({
        filePath,
        lineStart: chunkStart,
        lineEnd: endLine,
        content: currentChunk.trim(),
      });
      chunkStart = lineNumber;
      currentChunk = paragraph + '\n\n';
    } else {
      currentChunk += paragraph + '\n\n';
    }

    lineNumber += paragraphLines + 1;
  }

  if (currentChunk.trim().length > 0) {
    chunks.push({
      filePath,
      lineStart: chunkStart,
      lineEnd: lineNumber - 1,
      content: currentChunk.trim(),
    });
  }

  return chunks;
}

// ── Cosine similarity ────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
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
  // Copilot supports these embedding models — try in order
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

const OLLAMA_MODELS = ['gte-large-en-v1.5', 'nomic-embed-text', 'all-minilm', 'mxbai-embed-large'];

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
          // Ollama returns { embeddings: [[...]] } in newer versions, { embedding: [...] } in older
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
      // Partial match: check if any content token contains the query token
      for (const ct of contentTokens) {
        if (ct.includes(token) || token.includes(ct)) {
          matches += 0.5;
          break;
        }
      }
    }
  }

  // Normalize by query length, boost shorter content (more focused)
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

// ── Build index with fallback chain ──────────────────────────────────────────

export async function buildIndex(
  workspacePath: string,
  apiKey: string,
  model = 'text-embedding-3-small'
): Promise<MemoryIndex> {
  const allChunks = await loadChunks(workspacePath);
  const embeddingCache = new Map<string, number[]>();

  if (allChunks.length === 0) {
    return { chunks: allChunks, embeddingCache, apiKey, model, provider: 'keyword' };
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

      // Provider works — embed all chunks
      embeddingCache.set(allChunks[0].content, testEmbedding);
      allChunks[0].embedding = testEmbedding;

      for (let i = 1; i < allChunks.length; i++) {
        const chunk = allChunks[i];
        if (!embeddingCache.has(chunk.content)) {
          const embedding = await embed(chunk.content);
          embeddingCache.set(chunk.content, embedding);
        }
        chunk.embedding = embeddingCache.get(chunk.content);
      }

      console.error(`[memory] Using ${name} embeddings (${allChunks.length} chunks indexed)`);
      return { chunks: allChunks, embeddingCache, apiKey, model, provider: name };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[memory] ${name} embeddings failed: ${msg}, trying next...`);
    }
  }

  // All embedding providers failed — fall back to keyword search
  console.error(`[memory] Using keyword search fallback (${allChunks.length} chunks)`);
  return { chunks: allChunks, embeddingCache, apiKey, model, provider: 'keyword' };
}

// ── Search with fallback ─────────────────────────────────────────────────────

export async function searchMemory(
  query: string,
  index: MemoryIndex,
  apiKey: string,
  topN = 5
): Promise<MemorySearchResult[]> {

  if (index.provider === 'keyword' || index.chunks.every(c => !c.embedding)) {
    // Keyword fallback
    return keywordSearch(query, index.chunks, topN);
  }

  // Embedding search — use same provider that built the index
  try {
    let embed: EmbedFn;
    if (index.provider === 'openai' && apiKey) {
      embed = createOpenAIEmbed(apiKey, index.model);
    } else if (index.provider === 'copilot') {
      embed = createCopilotEmbed();
    } else if (index.provider === 'ollama') {
      embed = createOllamaEmbed();
    } else {
      return keywordSearch(query, index.chunks, topN);
    }

    const queryEmbedding = await embed(query);

    const scored = index.chunks
      .filter((chunk) => chunk.embedding !== undefined)
      .map((chunk) => ({
        chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding!),
      }));

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topN).map(({ chunk, score }) => ({
      content: chunk.content,
      filePath: chunk.filePath,
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
      score,
    }));
  } catch {
    // If embedding search fails at query time, fall back to keyword
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
