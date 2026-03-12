import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { McpServerConfig } from '../types.js';

const DEFAULT_REGISTRY_PATH = resolve(process.cwd(), 'mcp-servers.json');

function validateConfig(name: string, raw: unknown): McpServerConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`MCP server "${name}": config must be an object`);
  }
  const cfg = raw as Record<string, unknown>;
  if (cfg.transport !== 'stdio' && cfg.transport !== 'sse') {
    throw new Error(`MCP server "${name}": transport must be "stdio" or "sse"`);
  }
  if (cfg.transport === 'stdio' && typeof cfg.command !== 'string') {
    throw new Error(`MCP server "${name}": stdio transport requires "command"`);
  }
  if (cfg.transport === 'sse' && typeof cfg.url !== 'string') {
    throw new Error(`MCP server "${name}": sse transport requires "url"`);
  }
  return cfg as unknown as McpServerConfig;
}

export function loadRegistry(registryPath?: string): Record<string, McpServerConfig> {
  const path = registryPath ?? DEFAULT_REGISTRY_PATH;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return {};
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const result: Record<string, McpServerConfig> = {};

  for (const [name, value] of Object.entries(parsed)) {
    result[name] = validateConfig(name, value);
  }

  return result;
}

export function saveRegistry(
  registry: Record<string, McpServerConfig>,
  registryPath?: string,
): void {
  const path = registryPath ?? DEFAULT_REGISTRY_PATH;
  writeFileSync(path, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
}

export function addServer(
  name: string,
  config: McpServerConfig,
  registryPath?: string,
): void {
  const registry = loadRegistry(registryPath);
  registry[name] = config;
  saveRegistry(registry, registryPath);
}
