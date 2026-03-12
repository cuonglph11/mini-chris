import { readFile } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';
import OpenAI from 'openai';
import type { MemorySearchResult } from '../types.js';

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
}

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

    lineNumber += paragraphLines + 1; // +1 for the blank line between paragraphs
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

async function embedText(text: string, client: OpenAI, model: string): Promise<number[]> {
  const response = await client.embeddings.create({
    model,
    input: text,
  });
  return response.data[0].embedding;
}

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

export async function buildIndex(
  workspacePath: string,
  apiKey: string,
  model = 'text-embedding-3-small'
): Promise<MemoryIndex> {
  const client = new OpenAI({ apiKey });
  const embeddingCache = new Map<string, number[]>();

  const allChunks: MemoryChunk[] = [];

  // Read MEMORY.md
  const memoryPath = join(workspacePath, 'MEMORY.md');
  try {
    const content = await readFile(memoryPath, 'utf-8');
    allChunks.push(...splitIntoChunks(content, memoryPath));
  } catch {
    // Skip if missing
  }

  // Read all memory/*.md files
  const pattern = join(workspacePath, 'memory', '*.md');
  const memFiles = await glob(pattern);
  for (const filePath of memFiles) {
    try {
      const content = await readFile(filePath, 'utf-8');
      allChunks.push(...splitIntoChunks(content, filePath));
    } catch {
      // Skip unreadable files
    }
  }

  // Embed all chunks
  for (const chunk of allChunks) {
    if (!embeddingCache.has(chunk.content)) {
      const embedding = await embedText(chunk.content, client, model);
      embeddingCache.set(chunk.content, embedding);
    }
    chunk.embedding = embeddingCache.get(chunk.content);
  }

  return { chunks: allChunks, embeddingCache, apiKey, model };
}

export async function searchMemory(
  query: string,
  index: MemoryIndex,
  apiKey: string,
  topN = 5
): Promise<MemorySearchResult[]> {
  const client = new OpenAI({ apiKey });
  const queryEmbedding = await embedText(query, client, index.model);

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
}
