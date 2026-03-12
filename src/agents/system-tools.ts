/**
 * Built-in system tools: exec, read_file, write_file, web_fetch
 *
 * These give the LLM direct access to the host system, making the Copilot
 * adapter useful for real tasks (Cursor adapter has its own native tools).
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { execa } from 'execa';
import type { ToolDefinition } from '../types.js';

// ── Tool definitions ────────────────────────────────────────────────────────

export function getSystemTools(): ToolDefinition[] {
  return [
    {
      name: 'exec',
      description:
        'Execute a shell command and return its output. Use this to run CLI commands like `docker ps`, `git status`, `npm test`, `ls`, etc. Commands run in the working directory.',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the command (optional, defaults to project root)',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (optional, default 30000)',
          },
        },
        required: ['command'],
      },
    },
    {
      name: 'read_file',
      description:
        'Read the contents of a file. Returns the full file content as text. Use this to inspect files, configs, logs, source code, etc.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative path to the file',
          },
          maxLines: {
            type: 'number',
            description: 'Maximum number of lines to read (optional, default: all)',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description:
        'Write content to a file. Creates the file and parent directories if they don\'t exist. Overwrites existing content. Use this to create or update files.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative path to the file',
          },
          content: {
            type: 'string',
            description: 'The content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'web_fetch',
      description:
        'Fetch the content of a URL. Returns the response body as text. Use this to read web pages, APIs, or download content.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch',
          },
          method: {
            type: 'string',
            description: 'HTTP method (optional, default GET)',
          },
          headers: {
            type: 'object',
            description: 'HTTP headers as key-value pairs (optional)',
          },
          body: {
            type: 'string',
            description: 'Request body for POST/PUT (optional)',
          },
        },
        required: ['url'],
      },
    },
  ];
}

// ── Execution functions ─────────────────────────────────────────────────────

const MAX_OUTPUT = 50_000; // 50KB output cap

function truncate(text: string, max = MAX_OUTPUT): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n...[truncated, ${text.length} chars total]`;
}

export async function executeExec(
  args: Record<string, unknown>,
  defaultCwd?: string,
): Promise<string> {
  const command = args.command as string;
  const cwd = (args.cwd as string) || defaultCwd || process.cwd();
  const timeout = (args.timeout as number) || 30_000;

  if (!command || typeof command !== 'string') {
    return JSON.stringify({ error: 'command parameter is required' });
  }

  try {
    const result = await execa('sh', ['-c', command], {
      cwd,
      timeout,
      reject: false,
      env: { ...process.env, TERM: 'dumb' },
    });

    const stdout = truncate(result.stdout || '');
    const stderr = truncate(result.stderr || '');

    return JSON.stringify({
      exitCode: result.exitCode,
      stdout,
      stderr: stderr || undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: `exec failed: ${message}` });
  }
}

export async function executeReadFile(
  args: Record<string, unknown>,
  defaultCwd?: string,
): Promise<string> {
  let filePath = args.path as string;
  const maxLines = args.maxLines as number | undefined;

  if (!filePath || typeof filePath !== 'string') {
    return JSON.stringify({ error: 'path parameter is required' });
  }

  // Resolve relative paths
  if (!filePath.startsWith('/')) {
    filePath = `${defaultCwd || process.cwd()}/${filePath}`;
  }

  try {
    let content = await readFile(filePath, 'utf-8');

    if (maxLines && maxLines > 0) {
      const lines = content.split('\n');
      if (lines.length > maxLines) {
        content = lines.slice(0, maxLines).join('\n') + `\n...[${lines.length} lines total, showing first ${maxLines}]`;
      }
    }

    return JSON.stringify({ path: filePath, content: truncate(content) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: `read failed: ${message}` });
  }
}

export async function executeWriteFile(
  args: Record<string, unknown>,
  defaultCwd?: string,
): Promise<string> {
  let filePath = args.path as string;
  const content = args.content as string;

  if (!filePath || typeof filePath !== 'string') {
    return JSON.stringify({ error: 'path parameter is required' });
  }
  if (content === undefined || content === null) {
    return JSON.stringify({ error: 'content parameter is required' });
  }

  // Resolve relative paths
  if (!filePath.startsWith('/')) {
    filePath = `${defaultCwd || process.cwd()}/${filePath}`;
  }

  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
    return JSON.stringify({ written: true, path: filePath, bytes: Buffer.byteLength(content) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: `write failed: ${message}` });
  }
}

export async function executeWebFetch(
  args: Record<string, unknown>,
): Promise<string> {
  const url = args.url as string;
  const method = (args.method as string) || 'GET';
  const headers = (args.headers as Record<string, string>) || {};
  const body = args.body as string | undefined;

  if (!url || typeof url !== 'string') {
    return JSON.stringify({ error: 'url parameter is required' });
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body || undefined,
    });

    const text = await response.text();

    return JSON.stringify({
      status: response.status,
      statusText: response.statusText,
      body: truncate(text),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: `fetch failed: ${message}` });
  }
}
