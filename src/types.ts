// Shared types for mini-chris

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  result: unknown;
  isError?: boolean;
}

export type AdapterEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; result: unknown }
  | { type: 'error'; message: string }
  | { type: 'done'; usage?: { inputTokens: number; outputTokens: number } };

export interface Adapter {
  name: string;
  run(options: {
    systemPrompt: string;
    task: string;
    tools: ToolDefinition[];
    model?: string;
    cwd?: string;
    stream?: boolean;
  }): AsyncIterable<AdapterEvent>;
}

export interface SkillMeta {
  name: string;
  description: string;
  path: string;
}

export interface MemorySearchResult {
  content: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  score: number;
}

export interface McpServerConfig {
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface AppConfig {
  adapter: 'cursor' | 'copilot';
  model: string;
  cwd: string;
  workspace: string;
  embedding: {
    provider: string;
    model: string;
    apiKey: string;
  };
  cursor: {
    binary?: string;
  };
  copilot: {
    auth: 'gh' | 'token';
    token?: string;
  };
}
