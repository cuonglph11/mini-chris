import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import type { McpTransport, JsonRpcMessage } from '../client.js';

export class StdioTransport implements McpTransport {
  private process: ChildProcess | null = null;
  private messageHandler: ((msg: JsonRpcMessage) => void) | null = null;
  private retryCount = 0;
  private closed = false;

  constructor(
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly env: Record<string, string> = {},
    private readonly maxRetries: number = 3,
  ) {}

  send(msg: JsonRpcMessage): void {
    if (!this.process?.stdin) {
      throw new Error('StdioTransport: process not running');
    }
    const line = JSON.stringify(msg) + '\n';
    this.process.stdin.write(line);
  }

  onMessage(handler: (msg: JsonRpcMessage) => void): void {
    this.messageHandler = handler;
    this.startProcess();
  }

  close(): void {
    this.closed = true;
    this.killProcess();
  }

  private startProcess(): void {
    const proc = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    this.process = proc;

    const rl = createInterface({ input: proc.stdout! });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcMessage;
        this.messageHandler?.(msg);
      } catch {
        // Ignore non-JSON lines
      }
    });

    proc.on('exit', (code) => {
      if (!this.closed && this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.error(`StdioTransport: process exited (code ${code}), restarting (${this.retryCount}/${this.maxRetries})`);
        setTimeout(() => this.startProcess(), 500 * this.retryCount);
      } else if (!this.closed) {
        console.error(`StdioTransport: process exited after ${this.maxRetries} retries, giving up`);
      }
    });

    proc.on('error', (err) => {
      console.error('StdioTransport: process error:', err.message);
    });
  }

  private killProcess(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
