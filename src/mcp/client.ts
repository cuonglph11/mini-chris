import type { ToolDefinition } from '../types.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export interface McpTransport {
  send(msg: JsonRpcMessage): void;
  onMessage(handler: (msg: JsonRpcMessage) => void): void;
  close(): void;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

export class McpClient {
  private transport: McpTransport | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private serverInfo: unknown = null;

  async connect(transport: McpTransport): Promise<void> {
    this.transport = transport;
    this.transport.onMessage((msg) => this.handleMessage(msg));

    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'mini-chris', version: '0.1.0' },
    });

    this.serverInfo = result;

    // Send initialized notification
    this.transport.send({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  }

  async listTools(): Promise<ToolDefinition[]> {
    const result = await this.sendRequest('tools/list', {});
    const response = result as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
    const tools = response.tools ?? [];
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? {},
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.sendRequest('tools/call', { name, arguments: args });
    return result;
  }

  disconnect(): void {
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    for (const pending of this.pending.values()) {
      pending.reject(new Error('McpClient disconnected'));
    }
    this.pending.clear();
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.transport) {
        reject(new Error('McpClient not connected'));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.transport.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private handleMessage(msg: JsonRpcMessage): void {
    if (!('id' in msg) || msg.id === undefined) {
      // Notification — ignore for now
      return;
    }
    const response = msg as JsonRpcResponse;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(new Error(`MCP error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }
}
