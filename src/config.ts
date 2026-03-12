import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';
import { z } from 'zod';
import type { AppConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function expandEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_match: string, key: string) => process.env[key] ?? '');
  }
  if (Array.isArray(value)) {
    return value.map(expandEnvVars);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, expandEnvVars(v)]));
  }
  return value;
}

const AppConfigSchema = z.object({
  adapter: z.enum(['cursor', 'copilot']).default(process.env.MINI_CHRIS_ADAPTER === 'copilot' ? 'copilot' : 'cursor'),
  model: z.string().default('auto'),
  cwd: z.string().default('.'),
  workspace: z.string().default('./workspace'),
  embedding: z
    .object({
      provider: z.string().default('openai'),
      model: z.string().default('text-embedding-3-small'),
      apiKey: z.string().default(''),
    })
    .default({}),
  cursor: z
    .object({
      binary: z.string().optional(),
    })
    .default({}),
  copilot: z
    .object({
      auth: z.enum(['gh', 'token']).default('gh'),
      token: z.string().optional(),
    })
    .default({}),
});

export function loadConfig(configPath?: string): AppConfig {
  const searchPaths = configPath
    ? [resolve(configPath)]
    : [
        resolve(process.cwd(), 'config.yaml'),
        resolve(process.cwd(), 'config.yml'),
        resolve(__dirname, '..', 'config.yaml'),
      ];

  let raw: unknown = {};
  for (const p of searchPaths) {
    if (existsSync(p)) {
      raw = parse(readFileSync(p, 'utf-8')) ?? {};
      break;
    }
  }

  const expanded = expandEnvVars(raw);
  const result = AppConfigSchema.safeParse(expanded);
  if (!result.success) {
    throw new Error(`Invalid config:\n${result.error.message}`);
  }

  return result.data as AppConfig;
}
