import readline from 'readline';
import chalk from 'chalk';
import { loadConfig } from './config.js';
import { createAdapter } from './adapters/interface.js';
import { injectWorkspaceContext } from './memory/inject.js';
import { injectSkill } from './skills/runner.js';
import { loadRegistry } from './mcp/registry.js';
import { ToolRouter } from './mcp/tool-router.js';
import type { AppConfig, ToolDefinition } from './types.js';

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

async function buildSystemPrompt(task: string, config: AppConfig): Promise<string> {
  const [memoryContext, skillContext] = await Promise.all([
    injectWorkspaceContext(config.workspace),
    injectSkill(task, config.workspace),
  ]);

  const parts: string[] = ['You are mini-chris, a helpful AI assistant.'];
  if (memoryContext) parts.push('\n## Workspace Context\n' + memoryContext);
  if (skillContext) parts.push('\n## Active Skill\n' + skillContext);
  return parts.join('\n');
}

async function runTurn(
  task: string,
  config: AppConfig,
  router: ToolRouter,
  tools: ToolDefinition[],
): Promise<void> {
  const systemPrompt = await buildSystemPrompt(task, config);
  const adapter = createAdapter(config.adapter, config);

  for await (const event of adapter.run({
    systemPrompt,
    task,
    tools,
    model: config.model,
    cwd: config.cwd,
    stream: true,
  })) {
    switch (event.type) {
      case 'text':
        process.stdout.write(event.content);
        break;
      case 'tool_call': {
        process.stdout.write(
          chalk.cyan(`\n[tool: ${event.name}] `) + chalk.dim(JSON.stringify(event.args)) + '\n',
        );
        // Only route through MCP if it's a known MCP tool; adapter built-in tools are handled internally
        const mcpToolNames = new Set(tools.map(t => t.name));
        if (mcpToolNames.has(event.name)) {
          const result = await router.routeToolCall({
            id: event.id,
            name: event.name,
            args: event.args,
          });
          const status = result.isError ? chalk.red('[error]') : chalk.green('[ok]');
          process.stdout.write(chalk.cyan('[result] ') + status + '\n');
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
            chalk.dim(
              `\n[tokens: in=${event.usage.inputTokens} out=${event.usage.outputTokens}]\n`,
            ),
          );
        }
        break;
    }
  }
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
        await runTurn(input, config, router, tools);
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
