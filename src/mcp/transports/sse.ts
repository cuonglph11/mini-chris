import type { McpTransport, JsonRpcMessage } from '../client.js';

export class SseTransport implements McpTransport {
  private messageHandler: ((msg: JsonRpcMessage) => void) | null = null;
  private abortController: AbortController | null = null;
  private retryCount = 0;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly maxRetries: number = 3,
  ) {}

  send(msg: JsonRpcMessage): void {
    fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    }).catch((err: unknown) => {
      console.error('SseTransport: POST error:', err instanceof Error ? err.message : err);
    });
  }

  onMessage(handler: (msg: JsonRpcMessage) => void): void {
    this.messageHandler = handler;
    this.startStream();
  }

  close(): void {
    this.closed = true;
    this.abortController?.abort();
    this.abortController = null;
  }

  private startStream(): void {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    fetch(this.url, {
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
      signal,
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          throw new Error(`SSE connection failed: ${res.status}`);
        }
        this.retryCount = 0;
        await this.readStream(res.body);
      })
      .catch((err: unknown) => {
        if (this.closed) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('abort')) return;
        console.error('SseTransport: stream error:', msg);
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
          const delay = 1000 * this.retryCount;
          console.error(`SseTransport: reconnecting in ${delay}ms (${this.retryCount}/${this.maxRetries})`);
          setTimeout(() => this.startStream(), delay);
        } else {
          console.error('SseTransport: max retries reached, giving up');
        }
      });
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          const dataLines = event
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim());

          if (dataLines.length === 0) continue;
          const data = dataLines.join('\n');
          if (data === '[DONE]') continue;

          try {
            const msg = JSON.parse(data) as JsonRpcMessage;
            this.messageHandler?.(msg);
          } catch {
            // Ignore non-JSON events
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
