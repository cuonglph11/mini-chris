# mini-chris — Requirements Document

## Overview

Lightweight, portable AI agent CLI designed for restricted corporate environments where OpenClaw cannot be installed. Focuses on memory persistence, skill execution, and MCP tool integration — using Cursor and GitHub Copilot as LLM backends.

**Core principle**: Port OpenClaw's brain (memory, skills, MCP) without the body (messaging, nodes, browser, media, cron, extensions).

## Target Environment

- Corporate macOS/Windows machines with restricted software policies
- Node.js available (standard dev tool)
- Cursor IDE installed (or VS Code + GitHub Copilot)
- Network access to LLM APIs (Cursor/Copilot already allowed through corporate firewall)
- No admin/root required for installation

## Architecture

```
mini-chris/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts                 # CLI entry point (commander)
│   ├── config.ts              # YAML config loader + validation
│   ├── runner.ts              # Task runner / interactive chat loop
│   │
│   ├── adapters/              # LLM backends
│   │   ├── interface.ts       # Common adapter interface
│   │   ├── cursor.ts          # Cursor agent CLI subprocess
│   │   └── copilot.ts         # GitHub Copilot API
│   │
│   ├── memory/                # Ported from OpenClaw
│   │   ├── inject.ts          # Load workspace files → system prompt
│   │   ├── search.ts          # Embedding-based semantic search
│   │   └── persist.ts         # Write/append to memory files
│   │
│   ├── skills/                # Ported from OpenClaw
│   │   ├── loader.ts          # Scan skill descriptions, match to task
│   │   └── runner.ts          # Read SKILL.md, inject into context
│   │
│   └── mcp/                   # Independent MCP client
│       ├── client.ts          # MCP protocol implementation
│       ├── transports/
│       │   ├── stdio.ts       # stdio transport (spawn process)
│       │   └── sse.ts         # SSE/HTTP transport
│       ├── registry.ts        # Load server configs from mcp-servers.json
│       └── tool-router.ts     # Route tool calls → correct MCP server
│
├── workspace/                 # Persistent memory (git-synced)
│   ├── MEMORY.md              # Long-term memory
│   ├── SOUL.md                # Personality & tone
│   ├── USER.md                # About the human
│   ├── IDENTITY.md            # Who the AI is
│   ├── AGENTS.md              # Task guidelines
│   ├── TOOLS.md               # Environment-specific notes
│   ├── memory/                # Daily + topic memory files
│   │   ├── YYYY-MM-DD.md
│   │   └── *.md
│   └── skills/                # Installed skills
│       └── <skill-name>/
│           └── SKILL.md
│
├── mcp-servers.json           # MCP server registry
└── config.yaml                # Runtime config
```

## Features

### F1 — Memory System (port from OpenClaw)

**Priority: Critical — this is the core differentiator**

#### F1.1 — Workspace Context Injection
- On every session start, automatically load workspace files into the system prompt
- Files loaded (in order): SOUL.md, IDENTITY.md, USER.md, MEMORY.md, AGENTS.md, TOOLS.md
- Files are optional — skip missing files gracefully
- Total context budget: warn if workspace files exceed 50KB (configurable)

#### F1.2 — Semantic Memory Search
- Embedding-based search across MEMORY.md + memory/*.md
- Uses OpenAI `text-embedding-3-small` by default (configurable)
- Index is built on first search, cached for session duration
- Search returns top-N snippets with file path + line numbers
- Must match OpenClaw's `memory_search` behavior:
  - Query → embed → cosine similarity against all chunks
  - Return ranked results with source attribution

#### F1.3 — Memory Persistence
- After each session, flush new facts to memory files
- Append to MEMORY.md for durable facts/rules/preferences
- Create/append to memory/YYYY-MM-DD.md for daily context
- Never overwrite existing memory — only append
- Agent decides what to persist (same as OpenClaw behavior)

#### F1.4 — Memory Sync (git)
- `mini-chris memory sync` → git add + commit + push workspace/
- Auto-commit message with timestamp
- Supports any git remote (GitHub, GitLab, etc.)

### F2 — LLM Adapters

#### F2.1 — Cursor Adapter
- Spawn Cursor's `agent` CLI as subprocess
- Pass system prompt (with memory context) + user task
- Stream stdout/stderr back to terminal
- Support model selection via config: `auto`, `gpt-5.3-codex`, `claude-sonnet-4.6`, `gemini-3-pro`, etc.
- Handle tool calls from Cursor (file read/write/edit, terminal commands)
- Pass MCP tools as available tools to Cursor

#### F2.2 — GitHub Copilot Adapter
- Use GitHub Copilot API (via `gh` CLI auth or direct API)
- Models: `gpt-4o`, `claude-sonnet-4.5`, `gemini-2.5-pro` (Copilot model roster)
- Same interface as Cursor adapter: system prompt + task → streamed response
- Handle tool calls and route to MCP servers

#### F2.3 — Adapter Interface
```typescript
interface Adapter {
  name: string;
  run(options: {
    systemPrompt: string;     // memory + skills injected
    task: string;             // user's task/message
    tools: ToolDefinition[];  // MCP tools available
    model?: string;
    cwd?: string;
    stream?: boolean;
  }): AsyncIterable<AdapterEvent>;
}

type AdapterEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; result: unknown }
  | { type: 'error'; message: string }
  | { type: 'done'; usage?: { inputTokens: number; outputTokens: number } };
```

### F3 — Skills System (port from OpenClaw)

#### F3.1 — Skill Discovery
- Scan workspace/skills/ for available skills
- Each skill has: name, description (in SKILL.md frontmatter), location
- Build `<available_skills>` list identical to OpenClaw format

#### F3.2 — Skill Matching
- Before each task, scan skill descriptions
- If exactly one skill matches → read its SKILL.md
- If multiple match → pick most specific
- If none match → skip
- Inject matched SKILL.md content into system prompt

#### F3.3 — Skill Installation
- `mini-chris skills list` — show installed skills
- `mini-chris skills install <path|url>` — copy skill folder into workspace/skills/
- Compatible with ClawHub skill format (can install from clawhub.com)

### F4 — MCP Client (Independent)

**Independent from adapters — mini-chris owns the MCP connections directly**

#### F4.1 — MCP Server Registry
```jsonc
// mcp-servers.json
{
  "notion": {
    "transport": "stdio",
    "command": "npx",
    "args": ["@notionhq/mcp-server"],
    "env": { "NOTION_API_KEY": "..." }
  },
  "github": {
    "transport": "stdio",
    "command": "npx",
    "args": ["@github/mcp-server"]
  },
  "n8n": {
    "transport": "sse",
    "url": "http://localhost:5678/mcp/tools"
  }
}
```

#### F4.2 — stdio Transport
- Spawn MCP server as child process
- Communicate via stdin/stdout using JSON-RPC 2.0
- Handle `initialize`, `tools/list`, `tools/call` methods
- Auto-restart on crash (configurable max retries)

#### F4.3 — SSE Transport
- Connect to HTTP SSE endpoint
- Send requests via POST, receive responses via SSE stream
- Handle reconnection on disconnect

#### F4.4 — Tool Router
- On session start: connect to all configured MCP servers
- Collect all available tools via `tools/list`
- When adapter makes a tool call → route to correct MCP server
- Return tool result back to adapter
- Deduplicate tool names across servers (prefix with server name if collision)

#### F4.5 — MCP Management CLI
- `mini-chris mcp list` — show connected servers + available tools
- `mini-chris mcp test <server-name>` — test connection, list tools
- `mini-chris mcp add <name> <command|url>` — add server to registry

### F5 — CLI Interface

#### F5.1 — Commands
```bash
# Interactive chat (with memory + skills + MCP)
mini-chris chat

# Run single task
mini-chris run "implement feature X"

# Run with options
mini-chris run --adapter copilot --model gpt-4o "review this PR"
mini-chris run --cwd /path/to/project "fix the build"

# Memory management
mini-chris memory search "what did we decide about auth?"
mini-chris memory sync                    # git commit + push

# Skills
mini-chris skills list
mini-chris skills install <path|url>

# MCP servers
mini-chris mcp list
mini-chris mcp test <server-name>
mini-chris mcp add <name> <command|url>

# Config
mini-chris config show
mini-chris config set adapter cursor
mini-chris config set model auto
```

#### F5.2 — Interactive Chat Mode
- REPL-style: user types → agent responds → loop
- Full memory context loaded on start
- Memory persisted on `/save` command or session end (Ctrl+C)
- Tool calls displayed inline (show tool name + result summary)
- Token usage displayed per message (optional)

#### F5.3 — Single Task Mode
- Run one task, output result, exit
- Useful for scripting: `mini-chris run "summarize this file" < input.txt`
- Exit code 0 on success, 1 on error

### F6 — Configuration

```yaml
# config.yaml
adapter: cursor                    # cursor | copilot
model: auto                        # model name or "auto"
cwd: ~/projects/work               # default working directory
workspace: ./workspace             # path to workspace dir

# Embedding for memory search
embedding:
  provider: openai
  model: text-embedding-3-small
  apiKey: ${OPENAI_API_KEY}        # env var reference

# Adapter-specific
cursor:
  binary: /usr/local/bin/cursor    # path to cursor binary (optional)

copilot:
  auth: gh                         # "gh" (use gh CLI auth) or "token"
  token: ${GITHUB_TOKEN}           # only if auth=token
```

## Dependencies (minimal)

| Package | Purpose | Size |
|---|---|---|
| `commander` | CLI framework | 50KB |
| `yaml` | Config parsing | 30KB |
| `execa` | Spawn subprocesses (Cursor, MCP stdio) | 20KB |
| `openai` | Embedding API for memory search | 100KB |
| `eventsource-parser` | SSE parsing for MCP transport | 10KB |
| `zod` | Config/input validation | 60KB |
| `glob` | File scanning (skills, memory) | 20KB |
| `chalk` | Terminal colors | 10KB |
| `readline` | Interactive chat (Node built-in) | 0 |

**Total: ~300KB node_modules** (vs OpenClaw's ~50MB+)

## Data Flow

```
User input
  │
  ▼
[1] Memory Inject
    Load SOUL.md + USER.md + IDENTITY.md + MEMORY.md + AGENTS.md + TOOLS.md
    → Build system prompt
  │
  ▼
[2] Skill Match
    Scan workspace/skills/ descriptions
    Match relevant skill → inject SKILL.md into system prompt
  │
  ▼
[3] MCP Tool Discovery
    Connect to all MCP servers in registry
    Collect available tools via tools/list
    → Add tool definitions to prompt
  │
  ▼
[4] Build Final Prompt
    system_prompt = memory_context + skill_context + available_tools + user_input
  │
  ▼
[5] Send to Adapter
    Cursor CLI subprocess OR Copilot API call
    Stream response events
  │
  ▼
[6] Tool Call Routing
    If adapter requests tool call:
      → Find matching MCP server
      → Execute via stdio/SSE
      → Return result to adapter
      → Continue generation
  │
  ▼
[7] Display Response
    Stream text to terminal
    Show tool calls inline
  │
  ▼
[8] Memory Persist
    Agent flushes new facts → MEMORY.md / memory/YYYY-MM-DD.md
    Optional: auto git sync
```

## Installation (on corporate machine)

```bash
# Clone from private repo
git clone git@github.com:cuonglph11/mini-chris.git ~/mini-chris
cd ~/mini-chris

# Install (no native deps, no admin needed)
npm install

# Link CLI globally (user-local, no sudo)
npm link

# Setup workspace (first time)
cp -r workspace.template/ workspace/
# Or clone existing workspace from backup repo

# Configure
cp config.example.yaml config.yaml
# Edit config.yaml with adapter preference and API keys

# Verify
mini-chris config show
mini-chris mcp list

# Start
mini-chris chat
```

## Security & Stealth

- Package name: `mini-chris` — looks like a personal dev tool, not "openclaw"
- No daemon/service — runs only when invoked
- No network listeners — only outbound to LLM APIs and MCP servers
- All data local in `workspace/` — git sync is opt-in
- No telemetry, no analytics, no phone-home
- Binary name configurable via package.json `bin` field

## Comparison with OpenClaw

| Capability | OpenClaw | mini-chris |
|---|---|---|
| Memory (MEMORY.md + memory/*.md) | ✅ | ✅ (identical format) |
| Semantic memory search | ✅ (embedding) | ✅ (same embedding approach) |
| Context injection (SOUL/USER/etc) | ✅ | ✅ (identical) |
| Skills (SKILL.md format) | ✅ | ✅ (compatible) |
| MCP client | ✅ | ✅ (independent, stdio + SSE) |
| ClawHub skill install | ✅ | ✅ (compatible format) |
| Cursor adapter | ❌ (via Paperclip) | ✅ |
| GitHub Copilot adapter | ✅ | ✅ |
| Messaging (Telegram/Discord/etc) | ✅ | ❌ (not needed) |
| Node pairing | ✅ | ❌ |
| Browser automation | ✅ | ❌ |
| Media pipeline | ✅ | ❌ |
| Cron/heartbeat | ✅ | ❌ (not in v1) |
| Web UI | ✅ | ❌ (CLI only) |
| Install size | ~50MB+ | ~300KB |
| LOC | ~50,000+ | ~1,350 |

## Build Phases

| Phase | Scope | Est. LOC | Est. Time |
|---|---|---|---|
| P1 | CLI + Config + Cursor adapter (basic `run`) | ~200 | 1h |
| P2 | Memory system (inject + search + persist) | ~300 | 2h |
| P3 | Copilot adapter | ~150 | 1h |
| P4 | Skills loader + matcher | ~150 | 1h |
| P5 | MCP client (stdio + SSE + tool routing) | ~400 | 2h |
| P6 | Interactive chat mode | ~100 | 30m |
| P7 | Memory sync (git) | ~50 | 30m |
| **Total** | | **~1,350** | **~8h** |

## Non-Goals (v1)

- No messaging channel integration
- No web UI or dashboard
- No daemon/background service
- No browser automation
- No node pairing or remote access
- No cron scheduling (run manually or via external cron)
- No multi-user support
- No plugin/extension system beyond skills + MCP
