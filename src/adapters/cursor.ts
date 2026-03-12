import { execa } from 'execa';
import { type Adapter, type AdapterEvent, type AppConfig, type ToolDefinition } from '../types.js';

export class CursorAdapter implements Adapter {
  name = 'cursor';

  constructor(private config: AppConfig) {}

  async *run(options: {
    systemPrompt: string;
    task: string;
    tools: ToolDefinition[];
    model?: string;
    cwd?: string;
    stream?: boolean;
  }): AsyncIterable<AdapterEvent> {
    const binary = this.config.cursor.binary ?? 'cursor';
    const args: string[] = [
      'agent',
      '--print',
      '--output-format', 'stream-json',
      '--stream-partial-output',
      '--force',
      '--trust',
    ];

    if (options.model && options.model !== 'auto') {
      args.push('--model', options.model);
    }

    if (options.cwd) {
      args.push('--workspace', options.cwd);
    }

    // Build the prompt with system context prepended
    const fullPrompt = options.systemPrompt
      ? `[System Instructions]\n${options.systemPrompt}\n\n[Task]\n${options.task}`
      : options.task;

    args.push(fullPrompt);

    const subprocess = execa(binary, args, {
      cwd: options.cwd ?? this.config.cwd,
      reject: false,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    try {
      const proc = subprocess;
      if (!proc.stdout) {
        yield { type: 'error', message: 'Failed to capture cursor stdout' };
        yield { type: 'done' };
        return;
      }

      let buffer = '';
      let hasStreamedText = false;

      for await (const chunk of proc.stdout) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed);
            const event = this.parseEvent(data, hasStreamedText);
            if (event) {
              if (event.type === 'text') hasStreamedText = true;
              // Reset after tool result — next assistant message is new content
              if (event.type === 'tool_result') hasStreamedText = false;
              yield event;
              if (event.type === 'done') return;
            }
          } catch {
            yield { type: 'text', content: trimmed + '\n' };
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer.trim());
          const event = this.parseEvent(data, hasStreamedText);
          if (event) yield event;
        } catch {
          yield { type: 'text', content: buffer.trim() + '\n' };
        }
      }

      yield { type: 'done' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message };
      yield { type: 'done' };
    }
  }

  private parseEvent(data: Record<string, unknown>, hasStreamedText: boolean): AdapterEvent | null {
    switch (data.type) {
      // Cursor agent: assistant message
      // With --stream-partial-output, deltas have `timestamp_ms`, final duplicate does NOT
      case 'assistant': {
        const isStreamingDelta = 'timestamp_ms' in data;
        // Skip the final duplicate message if we already streamed the deltas
        if (!isStreamingDelta && hasStreamedText) return null;
        const msg = data.message as { content?: Array<{ type: string; text?: string }> } | undefined;
        if (msg?.content) {
          const text = msg.content
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text)
            .join('');
          if (text) return { type: 'text', content: text };
        }
        return null;
      }

      // Cursor agent: text delta for streaming partial output
      case 'text':
      case 'text_delta': {
        const content = (data.content ?? data.delta ?? data.text ?? '') as string;
        if (content) return { type: 'text', content };
        return null;
      }

      // Cursor agent: tool calls have subtype "started" / "completed"
      // Format: { type: "tool_call", subtype, call_id, tool_call: { <toolName>Call: { args, result? } } }
      case 'tool_use':
      case 'tool_call': {
        const subtype = data.subtype as string | undefined;
        const callId = (data.call_id ?? data.id ?? String(Date.now())) as string;
        const toolCallObj = data.tool_call as Record<string, unknown> | undefined;

        // Extract tool name and args from the nested structure
        let toolName = '';
        let toolArgs: Record<string, unknown> = {};
        let toolResult: unknown = undefined;

        if (toolCallObj) {
          // Find the key like "globToolCall", "readToolCall", "terminalToolCall", etc.
          const callKey = Object.keys(toolCallObj).find(k => k.endsWith('Call') || k.endsWith('ToolCall'));
          if (callKey) {
            // Derive readable name: "globToolCall" → "glob", "listDirectoryToolCall" → "listDirectory"
            toolName = callKey.replace(/(?:Tool)?Call$/, '');
            const inner = toolCallObj[callKey] as Record<string, unknown> | undefined;
            if (inner) {
              toolArgs = (inner.args ?? {}) as Record<string, unknown>;
              if (inner.result !== undefined) toolResult = inner.result;
            }
          }
        }

        // Fall back to flat fields if no nested structure
        if (!toolName) {
          toolName = (data.name ?? data.tool ?? '') as string;
          toolArgs = (data.args ?? data.arguments ?? data.input ?? {}) as Record<string, unknown>;
        }

        if (subtype === 'completed' && toolResult !== undefined) {
          return { type: 'tool_result', id: callId, result: toolResult };
        }

        if (subtype === 'started' || !subtype) {
          return { type: 'tool_call', id: callId, name: toolName, args: toolArgs };
        }

        return null;
      }

      // Cursor agent: tool result (standalone)
      case 'tool_result': {
        return {
          type: 'tool_result',
          id: (data.call_id ?? data.id ?? '') as string,
          result: data.result ?? data.output,
        };
      }

      // Cursor agent: final result with usage
      case 'result': {
        const usage = data.usage as { inputTokens?: number; outputTokens?: number } | undefined;
        return {
          type: 'done',
          usage: usage ? { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 } : undefined,
        };
      }

      // Cursor agent: error
      case 'error': {
        return { type: 'error', message: (data.message ?? JSON.stringify(data)) as string };
      }

      // Ignore system/init, user echo, thinking events
      case 'system':
      case 'user':
      case 'thinking':
        return null;

      default:
        return null;
    }
  }
}
