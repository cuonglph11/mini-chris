import chalk from 'chalk';
import { createAdapter } from '../adapters/interface.js';
import { injectWorkspaceContext } from '../memory/inject.js';
import { injectSkill } from '../skills/runner.js';
import type { AdapterEvent, AppConfig, ToolDefinition } from '../types.js';
import type { ToolRouter } from '../mcp/tool-router.js';

export interface SubAgentOptions {
  task: string;
  config: AppConfig;
  router: ToolRouter;
  tools: ToolDefinition[];
  parentContext?: string;
}

export async function runSubAgent(options: SubAgentOptions): Promise<string> {
  const { task, config, router, tools, parentContext } = options;

  const log = (msg: string) =>
    process.stderr.write(chalk.magenta(`[sub-agent] `) + msg + '\n');

  log(`Starting: ${task.length > 120 ? task.slice(0, 120) + '...' : task}`);

  // Build system prompt for the sub-agent (same workspace context, fresh conversation)
  const [memoryContext, skillContext] = await Promise.all([
    injectWorkspaceContext(config.workspace),
    injectSkill(task, config.workspace),
  ]);

  const parts: string[] = [
    'You are mini-chris, a helpful AI assistant running as a sub-agent. Complete the given task thoroughly and return a clear, detailed answer. You do NOT have the delegate_task tool — complete everything yourself.',
  ];
  if (memoryContext) parts.push('\n## Workspace Context\n' + memoryContext);
  if (skillContext) parts.push('\n## Active Skill\n' + skillContext);
  if (parentContext) parts.push('\n## Context from Parent\n' + parentContext);
  const systemPrompt = parts.join('\n');

  // Filter out delegate_task from the tools so sub-agents cannot nest
  const subAgentTools = tools.filter((t) => t.name !== 'delegate_task');
  const mcpToolNames = new Set(subAgentTools.map((t) => t.name));

  const adapter = createAdapter(config.adapter, config);
  let assistantText = '';

  const processStream = async (
    stream: AsyncIterable<AdapterEvent>,
  ): Promise<Array<{ id: string; name: string; args: Record<string, unknown> }>> => {
    const pendingToolCalls: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];

    for await (const event of stream) {
      switch (event.type) {
        case 'text':
          assistantText += event.content;
          // Show sub-agent text output to stderr so user can follow along
          process.stderr.write(chalk.magenta(event.content));
          break;
        case 'tool_call':
          log(
            chalk.cyan(`[tool: ${event.name}] `) +
              chalk.dim(JSON.stringify(event.args)),
          );
          if (mcpToolNames.has(event.name)) {
            pendingToolCalls.push({
              id: event.id,
              name: event.name,
              args: event.args,
            });
          } else {
            log(chalk.dim('[handled by adapter]'));
          }
          break;
        case 'error':
          log(chalk.red(`Error: ${event.message}`));
          break;
        case 'done':
          if (event.usage) {
            log(
              chalk.dim(
                `[tokens: in=${event.usage.inputTokens} out=${event.usage.outputTokens}]`,
              ),
            );
          }
          break;
      }
    }
    return pendingToolCalls;
  };

  let pendingToolCalls = await processStream(
    adapter.run({
      systemPrompt,
      task,
      tools: subAgentTools,
      model: config.model,
      cwd: config.cwd,
      stream: true,
    }),
  );

  let round = 0;
  while (
    pendingToolCalls.length > 0 &&
    adapter.addToolResult &&
    adapter.continueAfterToolCall &&
    round < config.maxToolRounds
  ) {
    round++;
    for (const tc of pendingToolCalls) {
      const result = await router.routeToolCall({
        id: tc.id,
        name: tc.name,
        args: tc.args,
      });
      const status = result.isError ? chalk.red('[error]') : chalk.green('[ok]');
      log(chalk.cyan('[result] ') + status);
      const resultStr =
        typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result);
      adapter.addToolResult(tc.id, resultStr);
    }

    pendingToolCalls = await processStream(
      adapter.continueAfterToolCall({
        systemPrompt,
        tools: subAgentTools,
        model: config.model,
        cwd: config.cwd,
      }),
    );
  }

  process.stderr.write('\n');
  log(`Completed (${round} tool round${round === 1 ? '' : 's'} used)`);

  return assistantText;
}
