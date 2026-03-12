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
import type { AppConfig, ToolDefinition } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedModels: { id: string; label: string }[] | null = null;

async function fetchCursorModels(binary: string): Promise<{ id: string; label: string }[]> {
  if (cachedModels) return cachedModels;
  try {
    const result = await execa(binary, ['agent', '--list-models'], { reject: false });
    const output = result.stdout || result.stderr || '';
    // Strip ANSI escape codes
    const clean = output.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
    const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
    // Parse lines like: "gpt-5.3-codex - GPT-5.3 Codex" or "auto - Auto  (current)"
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
      return cachedModels;
    }
  } catch { /* ignore */ }
  return [];
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
      const binary = config.cursor.binary ?? 'cursor';
      const models = await fetchCursorModels(binary);
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

function handleWsConnection(ws: WebSocket, config: AppConfig, router: ToolRouter) {
  ws.on('message', async (raw) => {
    let msg: { type: string; content: string; model?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    if (msg.type !== 'chat') return;

    const task = msg.content;
    const tools = router.getTools();

    try {
      // Build system prompt
      const [memoryContext, skillContext] = await Promise.all([
        injectWorkspaceContext(config.workspace),
        injectSkill(task, config.workspace),
      ]);

      const parts: string[] = ['You are mini-chris, a helpful AI assistant.'];
      if (memoryContext) parts.push('\n## Workspace Context\n' + memoryContext);
      if (skillContext) parts.push('\n## Active Skill\n' + skillContext);
      const systemPrompt = parts.join('\n');

      const effectiveConfig = msg.model ? { ...config, model: msg.model } : config;
      const adapter = createAdapter(effectiveConfig.adapter, effectiveConfig);

      for await (const event of adapter.run({
        systemPrompt,
        task,
        tools,
        model: effectiveConfig.model,
        cwd: effectiveConfig.cwd,
        stream: true,
      })) {
        if (ws.readyState !== WebSocket.OPEN) break;

        switch (event.type) {
          case 'text':
            ws.send(JSON.stringify({ type: 'text', content: event.content }));
            break;
          case 'tool_call': {
            ws.send(JSON.stringify({ type: 'tool_call', id: event.id, name: event.name, args: event.args }));
            // Only route through MCP if it's a known MCP tool; Cursor handles its own built-in tools internally
            const mcpToolNames = new Set(tools.map(t => t.name));
            if (mcpToolNames.has(event.name)) {
              try {
                const result = await router.routeToolCall({ id: event.id, name: event.name, args: event.args });
                ws.send(JSON.stringify({ type: 'tool_result', id: event.id, result: result.result, isError: result.isError }));
              } catch (e) {
                ws.send(JSON.stringify({ type: 'tool_result', id: event.id, result: (e as Error).message, isError: true }));
              }
            }
            // Cursor built-in tools: result will arrive as a separate tool_result event from the adapter
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
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: (e as Error).message }));
      ws.send(JSON.stringify({ type: 'done' }));
    }
  });
}
