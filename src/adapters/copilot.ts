import { execa } from 'execa';
import { createParser } from 'eventsource-parser';
import { type Adapter, type AdapterEvent, type AppConfig, type ToolDefinition } from '../types.js';
import { proxyFetch, formatFetchError } from '../net.js';

const COPILOT_API_URL = 'https://api.githubcopilot.com/chat/completions';

// Use VS Code-like headers to avoid enterprise 421 errors
const HEADERS_COMPAT = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
};

interface ToolCallAccumulator {
  id: string;
  name: string;
  argumentsJson: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export class CopilotAdapter implements Adapter {
  name = 'copilot';
  private conversationHistory: ChatMessage[] = [];
  private cachedCopilotToken: { token: string; expiresAt: number } | null = null;

  constructor(private config: AppConfig) {}

  /** Get the GitHub PAT (used to exchange for a Copilot token) */
  private async getGitHubToken(): Promise<string> {
    // 1. Direct token from config
    if (this.config.copilot.auth === 'token') {
      const token = this.config.copilot.token;
      if (!token) throw new Error('copilot.token is required when auth is "token"');
      return token;
    }

    // 2. Environment variable fallback chain
    for (const envVar of ['COPILOT_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']) {
      const val = process.env[envVar];
      if (val) return val;
    }

    // 3. gh CLI auth
    const result = await execa('gh', ['auth', 'token'], { reject: false });
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to get GitHub token. Set GITHUB_TOKEN env var or run 'gh auth login'. Error: ${result.stderr}`,
      );
    }
    return (result.stdout as string).trim();
  }

  /** Exchange GitHub PAT for a short-lived Copilot API token */
  private async getCopilotToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.cachedCopilotToken && Date.now() / 1000 < this.cachedCopilotToken.expiresAt - 60) {
      return this.cachedCopilotToken.token;
    }

    const githubToken = await this.getGitHubToken();

    let response: Response;
    try {
      response = await proxyFetch('https://api.github.com/copilot_internal/v2/token', {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/json',
          ...HEADERS_COMPAT,
        },
      });
    } catch (err) {
      throw new Error(
        `Failed to reach GitHub API for Copilot token exchange: ${formatFetchError(err)}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Failed to get Copilot token (${response.status}): ${text}. ` +
        'Ensure your GitHub account has an active Copilot subscription and your PAT has the "copilot" scope.',
      );
    }

    const data = await response.json() as { token: string; expires_at: number };
    this.cachedCopilotToken = { token: data.token, expiresAt: data.expires_at };
    return data.token;
  }

  resetHistory(): void {
    this.conversationHistory = [];
  }

  async *run(options: {
    systemPrompt: string;
    task: string;
    tools: ToolDefinition[];
    model?: string;
    cwd?: string;
    stream?: boolean;
  }): AsyncIterable<AdapterEvent> {
    let token: string;
    try {
      token = await this.getCopilotToken();
    } catch (err) {
      yield { type: 'error', message: `Copilot auth failed: ${formatFetchError(err)}` };
      yield { type: 'done' };
      return;
    }

    const model = options.model ?? this.config.model;

    const tools = options.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    // Build messages with conversation history for multi-turn support
    const messages: ChatMessage[] = [];

    // System prompt always first
    messages.push({ role: 'system', content: options.systemPrompt });

    // Append prior conversation history (skip system messages from history)
    for (const msg of this.conversationHistory) {
      if (msg.role !== 'system') {
        messages.push(msg);
      }
    }

    // Add current user message
    messages.push({ role: 'user', content: options.task });

    const body = {
      model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
    };

    let response: Response;
    try {
      response = await proxyFetch(COPILOT_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...HEADERS_COMPAT,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      yield { type: 'error', message: `Network error: ${formatFetchError(err)}` };
      yield { type: 'done' };
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      yield { type: 'error', message: `Copilot API error ${response.status}: ${text}` };
      yield { type: 'done' };
      return;
    }

    if (!response.body) {
      yield { type: 'error', message: 'No response body from Copilot API' };
      yield { type: 'done' };
      return;
    }

    // Buffer events to yield from async generator
    const eventQueue: AdapterEvent[] = [];
    let done = false;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let assistantText = '';

    // Accumulate partial tool call arguments indexed by tool_call index
    const toolCallAccumulators = new Map<number, ToolCallAccumulator>();

    const parser = createParser({
      onEvent(sseEvent) {
        if (sseEvent.data === '[DONE]') {
          done = true;
          return;
        }

        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(sseEvent.data) as Record<string, unknown>;
        } catch {
          return;
        }

        // Capture usage if present
        if (chunk.usage && typeof chunk.usage === 'object') {
          const u = chunk.usage as Record<string, unknown>;
          usage = {
            inputTokens: typeof u['prompt_tokens'] === 'number' ? u['prompt_tokens'] : 0,
            outputTokens: typeof u['completion_tokens'] === 'number' ? u['completion_tokens'] : 0,
          };
        }

        const choices = chunk.choices;
        if (!Array.isArray(choices) || choices.length === 0) return;

        const delta = (choices[0] as Record<string, unknown>).delta as Record<string, unknown> | undefined;
        if (!delta) return;

        // Text content
        if (typeof delta['content'] === 'string' && delta['content'].length > 0) {
          assistantText += delta['content'];
          eventQueue.push({ type: 'text', content: delta['content'] });
        }

        // Tool calls — emit as soon as complete
        if (Array.isArray(delta['tool_calls'])) {
          for (const tc of delta['tool_calls'] as Array<Record<string, unknown>>) {
            const idx = typeof tc['index'] === 'number' ? tc['index'] : 0;
            const fn = tc['function'] as Record<string, unknown> | undefined;

            if (!toolCallAccumulators.has(idx)) {
              toolCallAccumulators.set(idx, {
                id: typeof tc['id'] === 'string' ? tc['id'] : '',
                name: typeof fn?.['name'] === 'string' ? fn['name'] : '',
                argumentsJson: '',
              });
            }

            const acc = toolCallAccumulators.get(idx)!;

            // ID and name only arrive in the first delta
            if (typeof tc['id'] === 'string' && tc['id'].length > 0) acc.id = tc['id'];
            if (typeof fn?.['name'] === 'string' && fn['name'].length > 0) acc.name = fn['name'];
            if (typeof fn?.['arguments'] === 'string') acc.argumentsJson += fn['arguments'];
          }
        }
      },
    });

    // Read the SSE stream and feed the parser
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        parser.feed(decoder.decode(value, { stream: true }));
        // Flush any queued events to the caller
        while (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message: `Stream read error: ${message}` };
    } finally {
      reader.releaseLock();
    }

    // Flush any remaining queued events
    while (eventQueue.length > 0) {
      yield eventQueue.shift()!;
    }

    // Emit accumulated tool calls
    const toolCallsForHistory: ChatMessage['tool_calls'] = [];
    for (const [, acc] of toolCallAccumulators) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(acc.argumentsJson || '{}') as Record<string, unknown>;
      } catch {
        args = { _raw: acc.argumentsJson };
      }
      yield { type: 'tool_call', id: acc.id, name: acc.name, args };
      toolCallsForHistory.push({
        id: acc.id,
        type: 'function',
        function: { name: acc.name, arguments: acc.argumentsJson || '{}' },
      });
    }

    // Save to conversation history for multi-turn support
    this.conversationHistory.push({ role: 'user', content: options.task });
    if (assistantText || toolCallsForHistory.length > 0) {
      const assistantMsg: ChatMessage = { role: 'assistant' };
      if (assistantText) assistantMsg.content = assistantText;
      if (toolCallsForHistory.length > 0) assistantMsg.tool_calls = toolCallsForHistory;
      this.conversationHistory.push(assistantMsg);
    }

    // Cap history to prevent context overflow (keep last 20 turns)
    if (this.conversationHistory.length > 40) {
      this.conversationHistory = this.conversationHistory.slice(-40);
    }

    yield { type: 'done', usage };
  }

  /**
   * Add a tool result to conversation history (for multi-turn tool use loops)
   */
  addToolResult(toolCallId: string, result: string): void {
    this.conversationHistory.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: result,
    });
  }
}
