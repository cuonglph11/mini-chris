import readline from 'readline';
import chalk from 'chalk';
import { loadConfig } from './config.js';
import { createAdapter } from './adapters/interface.js';
import { injectWorkspaceContext } from './memory/inject.js';
import { injectSkill } from './skills/runner.js';
import { loadRegistry } from './mcp/registry.js';
import { ToolRouter } from './mcp/tool-router.js';
import type { AdapterEvent, AppConfig, ToolDefinition } from './types.js';

export interface RunOptions {
  adapter?: string;
  model?: string;
  cwd?: string;
  configPath?: string;
}

function applyOptions(config: AppConfig, options: RunOptions): AppConfig {
  return {
    ...config,
    ...(options.adapter ? { adapter: options.adapter as AppConfig['adapter'] } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
  };
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

function formatHistory(history: ChatTurn[]): string {
  if (history.length === 0) return '';
  return '\n## Conversation History\n' + history.map(t =>
    t.role === 'user' ? `User: ${t.content}` : `Assistant: ${t.content}`
  ).join('\n') + '\n';
}

async function buildSystemPrompt(task: string, config: AppConfig, history: ChatTurn[] = []): Promise<string> {
  const [memoryContext, skillContext] = await Promise.all([
    injectWorkspaceContext(config.workspace),
    injectSkill(task, config.workspace),
  ]);

  const parts: string[] = ['You are mini-chris, a helpful AI assistant. Always consider the conversation history when answering follow-up questions.'];
  if (memoryContext) parts.push('\n## Workspace Context\n' + memoryContext);
  if (skillContext) parts.push('\n## Active Skill\n' + skillContext);
  const historyBlock = formatHistory(history);
  if (historyBlock) parts.push(historyBlock);
  return parts.join('\n');
}

const MAX_TOOL_ROUNDS = 10;

async function runTurn(
  task: string,
  config: AppConfig,
  router: ToolRouter,
  tools: ToolDefinition[],
  history: ChatTurn[] = [],
): Promise<string> {
  const systemPrompt = await buildSystemPrompt(task, config, history);
  let assistantText = '';
  const adapter = createAdapter(config.adapter, config);
  const mcpToolNames = new Set(tools.map(t => t.name));

  const processStream = async (stream: AsyncIterable<AdapterEvent>): Promise<{ pendingToolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> }> => {
    const pendingToolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
    for await (const event of stream) {
      switch (event.type) {
        case 'text':
          assistantText += event.content;
          process.stdout.write(event.content);
          break;
        case 'tool_call': {
          process.stdout.write(
            chalk.cyan(`\n[tool: ${event.name}] `) + chalk.dim(JSON.stringify(event.args)) + '\n',
          );
          if (mcpToolNames.has(event.name)) {
            pendingToolCalls.push({ id: event.id, name: event.name, args: event.args });
          } else {
            process.stdout.write(chalk.dim('[handled by adapter]\n'));
          }
          break;
        }
        case 'error':
          process.stderr.write(chalk.red(`\nError: ${event.message}\n`));
          break;
        case 'done':
          if (event.usage) {
            process.stderr.write(
              chalk.dim(`\n[tokens: in=${event.usage.inputTokens} out=${event.usage.outputTokens}]\n`),
            );
          }
          break;
      }
    }
    return { pendingToolCalls };
  };

  let { pendingToolCalls } = await processStream(adapter.run({
    systemPrompt, task, tools, model: config.model, cwd: config.cwd, stream: true,
  }));

  let round = 0;
  while (pendingToolCalls.length > 0 && adapter.addToolResult && adapter.continueAfterToolCall && round < MAX_TOOL_ROUNDS) {
    round++;
    for (const tc of pendingToolCalls) {
      const result = await router.routeToolCall({ id: tc.id, name: tc.name, args: tc.args });
      const status = result.isError ? chalk.red('[error]') : chalk.green('[ok]');
      process.stdout.write(chalk.cyan('[result] ') + status + '\n');
      const resultStr = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
      adapter.addToolResult(tc.id, resultStr);
    }

    ({ pendingToolCalls } = await processStream(adapter.continueAfterToolCall({
      systemPrompt, tools, model: config.model, cwd: config.cwd,
    })));
  }

  return assistantText;
}

export async function runTask(task: string, options: RunOptions = {}): Promise<void> {
  const config = applyOptions(loadConfig(options.configPath), options);
  const router = new ToolRouter();
  await router.connectAll(loadRegistry());
  try {
    await runTurn(task, config, router, router.getTools());
  } finally {
    router.disconnectAll();
  }
  process.stdout.write('\n');
}

export async function startChat(options: RunOptions = {}): Promise<void> {
  const config = applyOptions(loadConfig(options.configPath), options);
  const router = new ToolRouter();
  await router.connectAll(loadRegistry());
  const tools = router.getTools();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  console.log(chalk.bold('mini-chris') + chalk.dim(' — type "exit" to quit'));

  const prompt = (): Promise<string> =>
    new Promise((resolve) => {
      rl.question(chalk.blue('you> '), resolve);
    });

  const history: ChatTurn[] = [];

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let line: string;
      try {
        line = await prompt();
      } catch {
        break;
      }

      const input = line.trim();
      if (!input) continue;
      if (input === 'exit' || input === 'quit') break;

      process.stdout.write(chalk.green('assistant> '));
      try {
        const response = await runTurn(input, config, router, tools, history);
        history.push({ role: 'user', content: input });
        if (response) {
          const summary = response.length > 500 ? response.slice(0, 500) + '...' : response;
          history.push({ role: 'assistant', content: summary });
        }
        // Cap history
        if (history.length > 40) history.splice(0, history.length - 40);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(chalk.red(`\nError: ${msg}\n`));
      }
      process.stdout.write('\n');
    }
  } finally {
    router.disconnectAll();
    rl.close();
  }

  console.log(chalk.dim('Goodbye.'));
}
