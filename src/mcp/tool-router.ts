import { McpClient } from './client.js';
import { StdioTransport } from './transports/stdio.js';
import { SseTransport } from './transports/sse.js';
import type { McpServerConfig, ToolCall, ToolDefinition, ToolResult } from '../types.js';

interface ServerEntry {
  client: McpClient;
  tools: Set<string>;
}

export class ToolRouter {
  private servers = new Map<string, ServerEntry>();
  private allTools: ToolDefinition[] = [];
  // Map from final tool name back to server name + original tool name
  private toolIndex = new Map<string, { serverName: string; originalName: string }>();

  async connectAll(registry: Record<string, McpServerConfig>): Promise<void> {
    const entries = Object.entries(registry);
    await Promise.all(entries.map(([name, config]) => this.connectServer(name, config)));
  }

  private async connectServer(name: string, config: McpServerConfig): Promise<void> {
    const client = new McpClient();
    let transport;

    if (config.transport === 'stdio') {
      if (!config.command) throw new Error(`Server "${name}" missing command`);
      transport = new StdioTransport(config.command, config.args ?? [], config.env ?? {});
    } else {
      if (!config.url) throw new Error(`Server "${name}" missing url`);
      transport = new SseTransport(config.url);
    }

    await client.connect(transport);
    const rawTools = await client.listTools();

    const toolNames = new Set<string>();
    for (const tool of rawTools) {
      // Check for collision with already-registered tool names
      const collision = this.toolIndex.has(tool.name);
      const finalName = collision ? `${name}__${tool.name}` : tool.name;

      toolNames.add(finalName);
      this.toolIndex.set(finalName, { serverName: name, originalName: tool.name });
      this.allTools.push({ ...tool, name: finalName, serverName: name });
    }

    this.servers.set(name, { client, tools: toolNames });
  }

  getTools(): ToolDefinition[] {
    return this.allTools;
  }

  async routeToolCall(call: ToolCall): Promise<ToolResult> {
    const entry = this.toolIndex.get(call.name);
    if (!entry) {
      return { id: call.id, result: `Unknown tool: ${call.name}`, isError: true };
    }

    const server = this.servers.get(entry.serverName);
    if (!server) {
      return { id: call.id, result: `Server not found: ${entry.serverName}`, isError: true };
    }

    try {
      const result = await server.client.callTool(entry.originalName, call.args);
      return { id: call.id, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { id: call.id, result: message, isError: true };
    }
  }

  disconnectAll(): void {
    for (const { client } of this.servers.values()) {
      client.disconnect();
    }
    this.servers.clear();
    this.allTools = [];
    this.toolIndex.clear();
  }
}
