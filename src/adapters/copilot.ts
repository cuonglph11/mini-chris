import { execa } from 'execa';
import { createParser } from 'eventsource-parser';
import { type Adapter, type AdapterEvent, type AppConfig, type ToolDefinition } from '../types.js';

const COPILOT_API_URL = 'https://api.githubcopilot.com/chat/completions';
const EDITOR_VERSION = 'mini-chris/0.1.0';

interface ToolCallAccumulator {
  id: string;
  name: string;
  argumentsJson: string;
}

export class CopilotAdapter implements Adapter {
  name = 'copilot';

  constructor(private config: AppConfig) {}

  private async getToken(): Promise<string> {
    if (this.config.copilot.auth === 'token') {
      const token = this.config.copilot.token;
      if (!token) throw new Error('copilot.token is required when auth is "token"');
      return token;
    }

    // auth === 'gh'
    const result = await execa('gh', ['auth', 'token'], { reject: false });
    if (result.exitCode !== 0) {
      throw new Error(`Failed to get GitHub token via gh: ${result.stderr}`);
    }
    return (result.stdout as string).trim();
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
      token = await this.getToken();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message };
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

    const body = {
      model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.task },
      ],
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
    };

    let response: Response;
    try {
      response = await fetch(COPILOT_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Editor-Version': EDITOR_VERSION,
          'Copilot-Integration-Id': 'mini-chris',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message: `Network error: ${message}` };
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
          eventQueue.push({ type: 'text', content: delta['content'] });
        }

        // Tool calls
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
    for (const [, acc] of toolCallAccumulators) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(acc.argumentsJson || '{}') as Record<string, unknown>;
      } catch {
        args = { _raw: acc.argumentsJson };
      }
      yield { type: 'tool_call', id: acc.id, name: acc.name, args };
    }

    yield { type: 'done', usage };
  }
}
