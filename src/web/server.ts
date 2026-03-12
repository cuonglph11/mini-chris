import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { execa } from 'execa';
import { loadConfig } from '../config.js';
import { createAdapter } from '../adapters/interface.js';
import { injectWorkspaceContext } from '../memory/inject.js';
import { searchMemory, buildIndex, type MemoryIndex } from '../memory/search.js';
import { syncMemory } from '../memory/persist.js';
import { scanSkills, formatAvailableSkills } from '../skills/loader.js';
import { injectSkill } from '../skills/runner.js';
import { loadRegistry } from '../mcp/registry.js';
import { ToolRouter } from '../mcp/tool-router.js';
import { getCopilotSessionToken, COPILOT_HEADERS } from '../copilot-auth.js';
import { proxyFetch } from '../net.js';
import type { AppConfig, ToolDefinition } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedModels: { id: string; label: string }[] | null = null;
let cachedModelsAdapter: string | null = null;

async function fetchCursorModels(binary: string): Promise<{ id: string; label: string }[]> {
  if (cachedModels && cachedModelsAdapter === 'cursor') return cachedModels;
  try {
    const result = await execa(binary, ['agent', '--list-models'], { reject: false });
    const output = result.stdout || result.stderr || '';
    const clean = output.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
    const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
    const models: { id: string; label: string }[] = [];
    for (const line of lines) {
      const match = line.match(/^([\w.-]+)\s+-\s+(.+)$/);
      if (match) {
        const id = match[1];
        const label = match[2].replace(/\s*\(current\)\s*/, '').replace(/\s*\(default\)\s*/, '').trim();
        models.push({ id, label });
      }
    }
    if (models.length > 0) {
      cachedModels = models;
      cachedModelsAdapter = 'cursor';
      return cachedModels;
    }
  } catch { /* ignore */ }
  return [];
}

const COPILOT_FALLBACK_MODELS: { id: string; label: string }[] = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'gpt-4', label: 'GPT-4' },
  { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  { id: 'o3-mini', label: 'O3 Mini' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
];

async function fetchCopilotModels(config: AppConfig): Promise<{ id: string; label: string }[]> {
  if (cachedModels && cachedModelsAdapter === 'copilot') return cachedModels;
  try {
    const token = await getCopilotSessionToken(config.copilot.auth, config.copilot.token);
    const response = await proxyFetch('https://api.githubcopilot.com/models', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        ...COPILOT_HEADERS,
      },
    });
    if (!response.ok) throw new Error(`${response.status}`);
    const data = await response.json() as { data?: Array<{ id: string; name?: string }> };
    const list = data.data ?? (Array.isArray(data) ? data as Array<{ id: string; name?: string }> : []);
    if (list.length > 0) {
      cachedModels = list.map(m => ({ id: m.id, label: m.name || m.id }));
      cachedModelsAdapter = 'copilot';
      return cachedModels;
    }
  } catch { /* fall through */ }
  return COPILOT_FALLBACK_MODELS;
}


export async function startServer(port = 3000, configPath?: string): Promise<void> {
  const config = loadConfig(configPath);
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.use(express.json());
  // Serve static files from both dist/web/public and src/web/public (dev fallback)
  const distPublic = path.join(__dirname, 'public');
  const srcPublic = path.resolve(__dirname, '../../src/web/public');
  app.use(express.static(distPublic));
  app.use(express.static(srcPublic));

  // Connect MCP servers
  const router = new ToolRouter();
  try {
    await router.connectAll(loadRegistry());
  } catch {
    console.warn('Warning: Could not connect to all MCP servers');
  }

  // REST APIs
  app.get('/api/config', (_req, res) => {
    const safeConfig = { ...config, embedding: { ...config.embedding, apiKey: '***' } };
    if (safeConfig.copilot.token) safeConfig.copilot = { ...safeConfig.copilot, token: '***' };
    res.json(safeConfig);
  });

  app.get('/api/memory', async (_req, res) => {
    try {
      const context = await injectWorkspaceContext(config.workspace);
      res.json({ context });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/skills', async (_req, res) => {
    try {
      const skills = await scanSkills(config.workspace);
      res.json({ skills });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/mcp/tools', (_req, res) => {
    res.json({ tools: router.getTools() });
  });

  app.get('/api/models', async (_req, res) => {
    try {
      const adapterName = config.adapter;
      let models: { id: string; label: string }[];
      if (adapterName === 'copilot') {
        models = await fetchCopilotModels(config);
      } else {
        const binary = config.cursor.binary ?? 'cursor';
        models = await fetchCursorModels(binary);
      }
      res.json({ models });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/memory/search', async (req, res) => {
    try {
      const { query } = req.body as { query: string };
      if (!query) return res.status(400).json({ error: 'query required' });
      const index = await buildIndex(config.workspace, config.embedding.apiKey, config.embedding.model);
      const results = await searchMemory(query, index, config.embedding.apiKey);
      res.json({ results });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/memory/sync', async (_req, res) => {
    try {
      await syncMemory(config.workspace);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // WebSocket chat
  wss.on('connection', (ws) => {
    handleWsConnection(ws, config, router);
  });

  server.listen(port, () => {
    console.log(`mini-chris web UI running at http://localhost:${port}`);
  });
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

function formatConversationHistory(history: ChatTurn[]): string {
  if (history.length === 0) return '';
  const lines = history.map(t =>
    t.role === 'user' ? `User: ${t.content}` : `Assistant: ${t.content}`
  );
  return '\n## Conversation History\n' + lines.join('\n') + '\n';
}

const WS_MAX_TOOL_ROUNDS = 10;

function handleWsConnection(ws: WebSocket, config: AppConfig, router: ToolRouter) {
  const history: ChatTurn[] = [];

  ws.on('message', async (raw) => {
    let msg: { type: string; content: string; model?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    if (msg.type === 'clear_history') {
      history.length = 0;
      return;
    }

    if (msg.type !== 'chat') return;

    const task = msg.content;
    const tools = router.getTools();
    const mcpToolNames = new Set(tools.map(t => t.name));

    try {
      const [memoryContext, skillContext] = await Promise.all([
        injectWorkspaceContext(config.workspace),
        injectSkill(task, config.workspace),
      ]);

      const parts: string[] = ['You are mini-chris, a helpful AI assistant. Always consider the conversation history when answering follow-up questions.'];
      if (memoryContext) parts.push('\n## Workspace Context\n' + memoryContext);
      if (skillContext) parts.push('\n## Active Skill\n' + skillContext);
      const historyBlock = formatConversationHistory(history);
      if (historyBlock) parts.push(historyBlock);
      const systemPrompt = parts.join('\n');

      const effectiveConfig = msg.model ? { ...config, model: msg.model } : config;
      const adapter = createAdapter(effectiveConfig.adapter, effectiveConfig);

      let assistantText = '';

      const processStream = async (stream: AsyncIterable<import('../types.js').AdapterEvent>): Promise<Array<{ id: string; name: string; args: Record<string, unknown> }>> => {
        const pendingToolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
        for await (const event of stream) {
          if (ws.readyState !== WebSocket.OPEN) break;
          switch (event.type) {
            case 'text':
              assistantText += event.content;
              ws.send(JSON.stringify({ type: 'text', content: event.content }));
              break;
            case 'tool_call': {
              ws.send(JSON.stringify({ type: 'tool_call', id: event.id, name: event.name, args: event.args }));
              if (mcpToolNames.has(event.name)) {
                pendingToolCalls.push({ id: event.id, name: event.name, args: event.args });
              }
              break;
            }
            case 'error':
              ws.send(JSON.stringify({ type: 'error', message: event.message }));
              break;
            case 'done':
              ws.send(JSON.stringify({ type: 'done', usage: event.usage }));
              break;
          }
        }
        return pendingToolCalls;
      };

      let pendingToolCalls = await processStream(adapter.run({
        systemPrompt, task, tools, model: effectiveConfig.model, cwd: effectiveConfig.cwd, stream: true,
      }));

      let round = 0;
      while (pendingToolCalls.length > 0 && adapter.addToolResult && adapter.continueAfterToolCall && round < WS_MAX_TOOL_ROUNDS) {
        round++;
        for (const tc of pendingToolCalls) {
          try {
            const result = await router.routeToolCall({ id: tc.id, name: tc.name, args: tc.args });
            const resultStr = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
            ws.send(JSON.stringify({ type: 'tool_result', id: tc.id, result: result.result, isError: result.isError }));
            adapter.addToolResult(tc.id, resultStr);
          } catch (e) {
            const errMsg = (e as Error).message;
            ws.send(JSON.stringify({ type: 'tool_result', id: tc.id, result: errMsg, isError: true }));
            adapter.addToolResult(tc.id, `Error: ${errMsg}`);
          }
        }

        if (ws.readyState !== WebSocket.OPEN) break;

        pendingToolCalls = await processStream(adapter.continueAfterToolCall({
          systemPrompt, tools, model: effectiveConfig.model, cwd: effectiveConfig.cwd,
        }));
      }

      history.push({ role: 'user', content: task });
      if (assistantText) {
        const summary = assistantText.length > 500 ? assistantText.slice(0, 500) + '...' : assistantText;
        history.push({ role: 'assistant', content: summary });
      }
      if (history.length > 40) {
        history.splice(0, history.length - 40);
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: (e as Error).message }));
      ws.send(JSON.stringify({ type: 'done' }));
    }
  });
}
