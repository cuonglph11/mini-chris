# mini-chris

A lightweight, open-source AI agent framework built for **enterprise and corporate environments**. Uses your existing **Cursor IDE** or **GitHub Copilot** subscription as the LLM backend — no external API keys, no data leaving your network.

[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Why mini-chris?

**Most AI agent frameworks require OpenAI/Anthropic API keys** — which means sending code and data to third-party services. That's a non-starter for most companies.

mini-chris is different: it piggybacks on tools your company **already pays for** (Cursor IDE or GitHub Copilot), keeping all LLM traffic within your existing vendor agreements and security policies.

- **Enterprise-safe** — no extra API keys, no new vendor approvals, no data exfiltration risk
- **Runs inside corporate networks** — works behind VPNs, proxies, and firewalls
- **Uses existing subscriptions** — Cursor IDE or GitHub Copilot (most companies already have one)
- **Zero data collection** — no telemetry, no analytics, all data stays local
- **Fully self-hosted** — run on your machine, your server, or your Docker cluster
- **Lightweight** — minimal dependencies, fast startup, no daemons or background services

## Features

| Feature | Description |
|---------|-------------|
| **Persistent Memory** | Workspace files (SOUL.md, USER.md, MEMORY.md) injected into every session |
| **Active Memory** | LLM can search and save memories during conversations via built-in tools |
| **Memory Flush** | Auto-saves important context every N turns before it's lost |
| **Sub-Agents** | Delegate complex tasks to isolated sub-agents with fresh context windows |
| **System Tools** | Built-in `exec`, `read_file`, `write_file`, `web_fetch` for real work |
| **Skills System** | Markdown-based skills auto-matched and injected into prompts |
| **MCP Integration** | Connect to any MCP server (stdio or SSE transport) |
| **Web UI** | Browser-based chat interface with streaming, history, and tool visibility |
| **Dual LLM Backend** | Cursor IDE (primary) or GitHub Copilot (fallback) |
| **Vector DB (Vectra)** | Persistent local vector storage — embeddings cached on disk, only new chunks re-embedded |
| **Embedding Search** | Configurable fallback chain: Ollama (local) → Copilot → OpenAI → keyword |

## Quick Start

```bash
# Clone
git clone https://github.com/cuonglph11/mini-chris.git
cd mini-chris

# Install & build
npm install
npm run build

# Link globally (optional)
npm link

# Start chatting
mini-chris chat
```

## Requirements

- **Node.js 20+**
- **At least one LLM backend:**
  - [Cursor IDE](https://cursor.com) with CLI enabled (`Cmd+Shift+P` → "Install 'cursor' command")
  - GitHub account with [Copilot subscription](https://github.com/features/copilot) + PAT

## Configuration

Copy the example config and customize:

```bash
cp config.example.yaml config.yaml
```

```yaml
adapter: cursor                    # cursor | copilot
model: auto                        # model name or "auto"
cwd: .                             # working directory
workspace: ./workspace             # memory & skills location
maxToolRounds: 50                  # max tool call rounds per turn

# Embedding for memory search (local-first by default)
embedding:
  provider: ollama                         # ollama | copilot | openai | keyword
  model: text-embedding-3-small            # OpenAI model (only when provider=openai)
  apiKey: ${OPENAI_API_KEY}                # only when provider=openai
  providerOrder:                           # fallback chain — tried in order
    - ollama                               # local Ollama (run models/setup.sh first)
    - copilot                              # GitHub Copilot embeddings
    - openai                               # OpenAI API (requires apiKey)
    - keyword                              # keyword matching (always works)
  ollamaHost: http://localhost:11434       # Ollama server URL
  # vectraPath: ./workspace/.vectra        # custom Vectra index location

# Cursor-specific
cursor:
  binary: cursor                   # path to cursor binary

# Copilot-specific
copilot:
  auth: token                      # "gh" | "token" | "device"
  token: ${GITHUB_TOKEN}           # PAT with copilot scope
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | GitHub Copilot authentication (PAT with `copilot` scope) |
| `OPENAI_API_KEY` | Memory search embeddings (optional, falls back gracefully) |
| `OLLAMA_HOST` | Ollama server URL (default: `http://localhost:11434`) |
| `MINI_CHRIS_ADAPTER` | Override adapter without editing config (`cursor` or `copilot`) |

## Commands

```bash
# Chat & Tasks
mini-chris chat                          # Interactive chat session
mini-chris chat --adapter copilot        # Use Copilot backend
mini-chris run "implement auth module"   # One-shot task execution
mini-chris web --port 3000               # Web UI at http://localhost:3000

# Memory
mini-chris memory search "auth decision" # Search workspace memory
mini-chris memory sync                   # Git commit + push workspace

# Skills
mini-chris skills list                   # Show installed skills
mini-chris skills install <path>         # Install a skill

# MCP Servers
mini-chris mcp list                      # List servers and tools
mini-chris mcp test <server>             # Test connection
mini-chris mcp add <name> <command>      # Register new server

# Config
mini-chris config show                   # Show current config
```

## Built-in Tools

The LLM has access to these tools during conversations:

### System Tools
| Tool | Description |
|------|-------------|
| `exec` | Run shell commands (`docker ps`, `git log`, `npm test`, `ls`, etc.) |
| `read_file` | Read file contents with optional line limiting |
| `write_file` | Create or update files (auto-creates parent directories) |
| `web_fetch` | Fetch URLs — web pages, REST APIs, JSON endpoints |

### Agent Tools
| Tool | Description |
|------|-------------|
| `delegate_task` | Spawn a sub-agent with fresh context for complex sub-tasks |

### Memory Tools
| Tool | Description |
|------|-------------|
| `memory_search` | Semantic search across all workspace memory files |
| `memory_save` | Save facts, preferences, and decisions to daily memory log |

Plus any tools from connected **MCP servers** (web search, GitHub, Notion, etc.).

## Architecture

```
User Input
    │
    ├─→ [Memory Injection]     Load SOUL.md, USER.md, MEMORY.md, AGENTS.md, TOOLS.md
    ├─→ [Skill Matching]       Find & inject relevant SKILL.md
    ├─→ [MCP Discovery]        Connect to configured servers, collect tools
    │
    ▼
Build System Prompt ──→ LLM Adapter (Cursor CLI / Copilot API)
    │
    ▼
Tool Dispatch
    ├─→ exec / read_file / write_file / web_fetch   (system tools)
    ├─→ delegate_task                                 (sub-agent)
    ├─→ memory_search / memory_save                   (memory tools)
    ├─→ MCP tool calls                                (external tools)
    └─→ Adapter-native tools                          (Cursor built-ins)
    │
    ▼
Response ──→ Display + Update conversation history
```

### Sub-Agent Architecture

```
Main Agent (conversation context)
    │
    ├─→ delegate_task("research X")
    │       │
    │       └─→ Sub-Agent (fresh context, same tools)
    │               ├─→ exec, read_file, MCP tools...
    │               └─→ Returns result text
    │
    └─→ Main Agent continues with sub-agent's result
         (main context stays clean)
```

## Memory System

### Workspace Files

Loaded into every session's system prompt:

| File | Purpose |
|------|---------|
| `SOUL.md` | Personality, principles, red lines |
| `IDENTITY.md` | Agent identity and capabilities |
| `USER.md` | Information about the human operator |
| `MEMORY.md` | Long-term facts, rules, preferences |
| `AGENTS.md` | Operational handbook and memory discipline |
| `TOOLS.md` | Environment-specific tool notes |
| `BOOTSTRAP.md` | First-run onboarding checklist |

### Active Memory (During Conversations)

The LLM proactively manages memory using built-in tools:
- **`memory_search`** — searches before answering questions about past context
- **`memory_save`** — saves preferences, decisions, and facts to `memory/YYYY-MM-DD.md`

### Memory Flush

Every 20 conversation turns, a hidden prompt asks the LLM to review and save important context. This prevents information loss in long sessions.

### Embedding Search & Vector Storage

Memory search uses [Vectra](https://github.com/Stevenic/vectra) — a local, file-based vector database. Embeddings are persisted to disk at `workspace/.vectra/`, so only new or changed chunks are re-embedded on startup.

The embedding provider is fully configurable with a **local-first** fallback chain:

1. **Ollama** (local, default) — bundled model included, run `models/setup.sh` to install
2. **GitHub Copilot** embeddings — uses your existing subscription, no extra key
3. **OpenAI** embeddings (`text-embedding-3-small`) — best quality, requires API key
4. **Keyword matching** — works offline, no API required, always available

```yaml
# config.yaml — customize the fallback order
embedding:
  providerOrder: [ollama, copilot, openai, keyword]
  ollamaHost: http://localhost:11434
```

#### Bundled Embedding Model

A quantized [nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF) model (~80MB) is included in `models/` via Git LFS. To set it up:

```bash
git lfs pull                # download the GGUF model file
cd models/
./setup.sh                  # creates the Ollama model locally
```

This works fully offline — no `ollama pull` needed. Ideal for corporate networks that block external model downloads.

## Skills System

Skills are Markdown files that get injected into the system prompt when matched:

```
workspace/skills/
├── onboarding/SKILL.md      # First-run setup wizard
├── code-review/SKILL.md     # Code review checklist
├── debug/SKILL.md           # Systematic debugging
├── refactor/SKILL.md        # Safe refactoring guide
├── react-expert/SKILL.md    # React best practices
└── typescript-*/SKILL.md    # TypeScript guides
```

### Creating a Skill

```markdown
---
name: my-skill
description: What this skill does
---

# Instructions

When the user asks about {topic}:
1. Do this first
2. Then check that
3. Return in this format
```

Skills are auto-matched by keyword scoring against the user's input.

## MCP Servers

Configure external tool servers in `mcp-servers.json`:

```json
{
  "vibium": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "vibium", "mcp"]
  },
  "github": {
    "transport": "stdio",
    "command": "npx",
    "args": ["@github/mcp-server"]
  },
  "custom-api": {
    "transport": "sse",
    "url": "http://localhost:5678/mcp"
  }
}
```

Supports both **stdio** (subprocess) and **SSE** (HTTP) transports.

## Web UI

```bash
mini-chris web --port 3000
```

Features:
- Dark-themed chat interface
- Real-time streaming responses
- Tool call visibility with expandable results
- Sidebar: memory, skills, MCP tools, settings
- Chat history persistence (localStorage)
- Model selection dropdown
- Session management (new chat / clear history)

## Docker

```bash
# Build
docker build -t mini-chris .

# Run with Copilot
docker run -it \
  -e GITHUB_TOKEN=$GITHUB_TOKEN \
  -v $(pwd)/workspace:/app/workspace \
  -p 3000:3000 \
  mini-chris

# Or use docker-compose
docker-compose up
```

## LLM Adapters

### Cursor Adapter (Primary)

Uses Cursor IDE's agent CLI as a subprocess:
```
cursor agent --print --output-format stream-json --stream-partial-output --force --trust
```

- Streams JSON events (text, tool_call, result)
- Has native tools (glob, grep, shell, file read/write)
- Supports all Cursor-available models
- Requires: Cursor IDE installed with CLI enabled

### Copilot Adapter (Fallback)

Uses GitHub Copilot's chat completions API:
- Endpoint: `api.githubcopilot.com/chat/completions`
- Token exchange: PAT → short-lived Copilot session token (auto-cached)
- SSE streaming with tool call accumulation
- Multi-turn conversation history
- Requires: GitHub account with Copilot subscription

## Project Structure

```
models/
├── nomic-embed-text-v1.5.Q4_K_M.gguf  # Bundled embedding model (Git LFS)
├── Modelfile                            # Ollama model definition
└── setup.sh                             # One-command local model setup
src/
├── cli.ts                    # Commander CLI entry point
├── config.ts                 # YAML config loader with zod validation
├── runner.ts                 # Task runner with tool dispatch loop
├── types.ts                  # Shared TypeScript types
├── adapters/
│   ├── cursor.ts             # Cursor IDE adapter
│   ├── copilot.ts            # GitHub Copilot adapter
│   └── interface.ts          # Adapter factory
├── agents/
│   ├── tools.ts              # delegate_task tool definition
│   ├── sub-agent.ts          # Sub-agent runner
│   └── system-tools.ts       # exec, read_file, write_file, web_fetch
├── memory/
│   ├── inject.ts             # Workspace context loader
│   ├── search.ts             # Vectra vector DB + embedding search
│   ├── tools.ts              # memory_search, memory_save tools
│   ├── flush.ts              # Pre-compaction memory flush
│   └── persist.ts            # Git sync helpers
├── skills/
│   ├── loader.ts             # Skill scanner
│   └── runner.ts             # Skill matcher + injector
├── mcp/
│   ├── client.ts             # JSON-RPC 2.0 MCP client
│   ├── tool-router.ts        # Multi-server tool routing
│   ├── registry.ts           # Server registry (mcp-servers.json)
│   └── transports/           # stdio + SSE transports
└── web/
    ├── server.ts             # Express + WebSocket server
    └── public/index.html     # Single-page chat UI
```

## Security & Enterprise Compliance

mini-chris is designed for corporate environments where data security matters:

### No New Vendor Risk
- **No OpenAI/Anthropic API keys required** — uses Cursor or Copilot, which your company already approved
- All LLM traffic goes through your existing vendor (GitHub/Cursor) — no new data processors
- No additional DPAs, security reviews, or procurement needed

### Data Stays Local
- **Zero telemetry** — no usage data, analytics, or phone-home
- All memory, skills, and config stored in local `workspace/` directory
- Git sync is opt-in and goes to **your** repository
- API keys masked in REST responses (`apiKey: '***'`)

### Network Compatible
- Works behind corporate VPNs, proxies, and firewalls
- Proxy support via `HTTPS_PROXY` / `HTTP_PROXY` environment variables
- Embedding model bundled via Git LFS — works without internet access
- Only outbound connections: `api.githubcopilot.com` (Copilot) or local Cursor CLI

### Runtime Safety
- No hardcoded secrets — uses environment variables and `${VAR}` config expansion
- No daemon or persistent service — runs only when invoked
- Shell execution via `exec` tool follows the same trust model as Cursor/Copilot agents

> **Note:** The `exec` tool gives the LLM shell access. This is by design — mini-chris is a personal agent meant to run on your own machine. Do not expose the web UI to untrusted networks without additional access controls.

## Troubleshooting

### "Network error: fetch failed" with Copilot
Your PAT needs the `copilot` scope and an active Copilot subscription. The adapter exchanges your PAT for a short-lived Copilot token automatically.

### Memory search returns no results
Falls back gracefully: Ollama → Copilot → OpenAI → keyword. Run `models/setup.sh` to set up local embeddings, or it works without any setup using keyword matching. Embeddings are cached in `workspace/.vectra/` so subsequent searches are fast.

### Cursor adapter not found
Enable Cursor CLI: open Cursor IDE → `Cmd+Shift+P` → "Install 'cursor' command". Or set the path:
```yaml
cursor:
  binary: /path/to/cursor
```

### MCP server not connecting
```bash
mini-chris mcp test <server-name>   # Debug connection
mini-chris mcp list                  # Check status
```

## Development

```bash
npm install          # Install dependencies
npm run build        # Build TypeScript + copy web assets
npm run dev          # Watch mode (tsc --watch)
npm start            # Run CLI
```

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-thing`)
3. Make your changes
4. Run `npm run build` to verify
5. Commit with a clear message
6. Open a Pull Request

### Areas for Contribution

- New LLM adapters (Ollama, OpenAI direct, Anthropic direct)
- Additional built-in skills
- MCP server integrations
- Web UI improvements
- Test coverage
- Documentation

## License

[MIT](LICENSE)

## Acknowledgments

- Inspired by [OpenClaw](https://github.com/openclaw/openclaw)'s memory architecture and tool system
- Built with [Cursor IDE](https://cursor.com) and [GitHub Copilot](https://github.com/features/copilot) as LLM backends
- Uses [Vectra](https://github.com/Stevenic/vectra) for local vector storage
- Uses the [Model Context Protocol](https://modelcontextprotocol.io) for tool extensibility

---

**Built for developers who need a powerful AI agent that works inside corporate networks — no extra API keys, no data leaving your org.**
