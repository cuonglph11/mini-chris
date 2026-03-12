import type { ToolDefinition } from '../types.js';

export function getBuiltInTools(): ToolDefinition[] {
  return [
    {
      name: 'delegate_task',
      description:
        'Delegate a task to a sub-agent that runs in its own context. Use this for complex sub-tasks that would clutter the main conversation. The sub-agent has access to all MCP tools. Returns the sub-agent result as text.',
      inputSchema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The task description for the sub-agent',
          },
          context: {
            type: 'string',
            description:
              'Optional context to provide to the sub-agent (relevant info from current conversation)',
          },
        },
        required: ['task'],
      },
    },
  ];
}
