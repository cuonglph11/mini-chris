import { loadRegistry, addServer } from './registry.js';
import { ToolRouter } from './tool-router.js';
import type { McpServerConfig } from '../types.js';

export { loadRegistry, saveRegistry, addServer } from './registry.js';
export { ToolRouter } from './tool-router.js';
export { McpClient } from './client.js';

export interface McpServerSummary {
  name: string;
  tools: string[];
}

export async function listMcpServers(): Promise<McpServerSummary[]> {
  const registry = loadRegistry();
  if (Object.keys(registry).length === 0) return [];

  const router = new ToolRouter();
  try {
    await router.connectAll(registry);
    const tools = router.getTools();

    // Seed an entry for every registered server (even those with zero tools)
    const byServer = new Map<string, string[]>(
      Object.keys(registry).map((name) => [name, []]),
    );
    for (const tool of tools) {
      const serverName = tool.serverName ?? 'unknown';
      const list = byServer.get(serverName) ?? [];
      list.push(tool.name);
      byServer.set(serverName, list);
    }
    return Array.from(byServer.entries()).map(([name, toolNames]) => ({
      name,
      tools: toolNames,
    }));
  } finally {
    router.disconnectAll();
  }
}

export async function testMcpConnection(serverName: string): Promise<void> {
  const registry = loadRegistry();
  const config = registry[serverName];
  if (!config) {
    throw new Error(`MCP server "${serverName}" not found in registry`);
  }
  const router = new ToolRouter();
  await router.connectAll({ [serverName]: config });
  router.disconnectAll();
}

export function addMcpServer(name: string, command: string, _registryPath?: string): void {
  const config: McpServerConfig = { transport: 'stdio', command };
  addServer(name, config);
}
