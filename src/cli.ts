#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { runTask, startChat } from './runner.js';
import { searchMemory, syncMemory } from './memory/index.js';
import { listSkills, installSkill } from './skills/index.js';
import { listMcpServers, testMcpConnection, addMcpServer } from './mcp/index.js';

const program = new Command();

program
  .name('mini-chris')
  .description('Lightweight AI agent CLI with memory, skills, and MCP integration')
  .version('0.1.0');

// ── chat ─────────────────────────────────────────────────────────────────────

program
  .command('chat')
  .description('Start interactive chat')
  .option('--adapter <adapter>', 'Adapter to use (cursor|copilot)')
  .option('--model <model>', 'Model name')
  .option('--cwd <path>', 'Working directory')
  .action(async (opts: { adapter?: string; model?: string; cwd?: string }) => {
    await startChat({ adapter: opts.adapter, model: opts.model, cwd: opts.cwd });
  });

// ── run ───────────────────────────────────────────────────────────────────────

program
  .command('run <task>')
  .description('Run a single task and exit')
  .option('--adapter <adapter>', 'Adapter to use (cursor|copilot)')
  .option('--model <model>', 'Model name')
  .option('--cwd <path>', 'Working directory')
  .action(
    async (task: string, opts: { adapter?: string; model?: string; cwd?: string }) => {
      await runTask(task, { adapter: opts.adapter, model: opts.model, cwd: opts.cwd });
    },
  );

// ── memory ────────────────────────────────────────────────────────────────────

const memory = program.command('memory').description('Memory management');

memory
  .command('search <query>')
  .description('Search workspace memory')
  .action(async (query: string) => {
    const cfg = loadConfig();
    const results = await searchMemory(
      query,
      cfg.workspace,
      cfg.embedding.apiKey,
      cfg.embedding.model,
    );
    if (results.length === 0) {
      console.log('No results found.');
    } else {
      for (const r of results) {
        console.log(`[score: ${r.score.toFixed(3)}] ${r.filePath}:${r.lineStart}`);
        console.log(r.content);
        console.log();
      }
    }
  });

memory
  .command('sync')
  .description('Git add/commit/push workspace')
  .action(async () => {
    const cfg = loadConfig();
    await syncMemory(cfg.workspace);
    console.log('Workspace synced.');
  });

// ── skills ────────────────────────────────────────────────────────────────────

const skills = program.command('skills').description('Skill management');

skills
  .command('list')
  .description('List installed skills')
  .action(async () => {
    const cfg = loadConfig();
    const list = await listSkills(cfg.workspace);
    if (list.length === 0) {
      console.log('No skills installed.');
    } else {
      for (const s of list) {
        console.log(`${s.name}: ${s.description}`);
      }
    }
  });

skills
  .command('install <path>')
  .description('Install a skill from path or URL')
  .action(async (skillPath: string) => {
    const cfg = loadConfig();
    await installSkill(skillPath, cfg.workspace);
    console.log(`Skill installed from ${skillPath}`);
  });

// ── mcp ───────────────────────────────────────────────────────────────────────

const mcp = program.command('mcp').description('MCP server management');

mcp
  .command('list')
  .description('List MCP servers and their tools')
  .action(async () => {
    const servers = await listMcpServers();
    if (servers.length === 0) {
      console.log('No MCP servers configured.');
    } else {
      for (const s of servers) {
        console.log(`${s.name}: ${s.tools.join(', ') || '(no tools)'}`);
      }
    }
  });

mcp
  .command('test <server>')
  .description('Test MCP server connection')
  .action(async (server: string) => {
    await testMcpConnection(server);
    console.log(`Connection to ${server} OK`);
  });

mcp
  .command('add <name> <command>')
  .description('Add a stdio MCP server to the registry')
  .action((name: string, command: string) => {
    addMcpServer(name, command);
    console.log(`MCP server '${name}' added.`);
  });

// ── web ──────────────────────────────────────────────────────────────────────

program
  .command('web')
  .description('Start web UI')
  .option('--port <port>', 'Port to listen on', '3000')
  .action(async (opts: { port: string }) => {
    const { startServer } = await import('./web/server.js');
    await startServer(parseInt(opts.port, 10));
  });

// ── config ────────────────────────────────────────────────────────────────────

const cfg = program.command('config').description('Configuration management');

cfg
  .command('show')
  .description('Show current config')
  .action(() => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });

cfg
  .command('set <key> <value>')
  .description('Update a config value (key as dot-path, e.g. model)')
  .action((key: string, value: string) => {
    // TODO: read config.yaml, set key path, write back
    console.error(`config set ${key}=${value} not yet implemented`);
    process.exit(1);
  });

// ── parse ─────────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
