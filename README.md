# mini-chris

A lightweight, portable AI agent CLI with persistent memory, skill execution, and MCP tool integration. Use Cursor IDE or GitHub Copilot as your LLM backend.

## Features

- **📝 Persistent Memory** — Automatic context injection from workspace files (SOUL.md, USER.md, MEMORY.md, etc.)
- **🔍 Semantic Search** — Embedding-based memory search with fallback to keyword matching
- **🎯 Skills System** — Scan and inject relevant skills into every task
- **🔧 MCP Integration** — Connect to Model Context Protocol servers (stdio and SSE transports)
- **💬 LLM Adapters** — Support for Cursor IDE and GitHub Copilot APIs
- **🌐 Web UI** — Optional web interface for interactive chat
- **⚙️ YAML Configuration** — Simple, environment-variable friendly config
- **📦 Minimal** — ~300KB node_modules, ~1,350 lines of code

## Quick Start

### Installation

```bash
git clone git@github.com:cuonglph11/mini-chris.git ~/mini-chris
cd ~/mini-chris
npm install
npm link
```

### Configuration

```bash
cp config.example.yaml config.yaml
# Edit config.yaml with your preferences
```

### Interactive Chat

```bash
mini-chris chat
```

### Single Task

```bash
mini-chris run "implement a feature"
mini-chris run --adapter copilot --model gpt-4o "review this PR"
```

## Commands

### Chat & Tasks
```bash
mini-chris chat                                  # Interactive chat
mini-chris run "task description"               # Single task
mini-chris run --adapter copilot "task"         # With options
```

### Memory
```bash
mini-chris memory search "what about auth?"     # Search memory
mini-chris memory sync                          # Git commit + push
```

### Skills
```bash
mini-chris skills list                          # Show installed skills
mini-chris skills install <path|url>            # Install new skill
```

### MCP Servers
```bash
mini-chris mcp list                             # Show connected servers
mini-chris mcp test <server-name>               # Test server
mini-chris mcp add <name> <command|url>         # Register server
```

### Config
```bash
mini-chris config show                          # Show current config
mini-chris config set adapter cursor            # Change adapter
mini-chris config set model gpt-4o              # Change model
```

## Configuration

Create `config.yaml`:

```yaml
# LLM Backend
adapter: cursor                          # cursor | copilot
model: auto                              # model name or "auto"

# Working directory
cwd: ~/projects/work

# Workspace path (contains memory, skills, etc)
workspace: ./workspace

# Embedding for semantic search
embedding:
  provider: openai                       # openai | copilot | keyword
  model: text-embedding-3-small
  apiKey: ${OPENAI_API_KEY}

# Cursor-specific (optional)
cursor:
  binary: /usr/local/bin/cursor          # Path to cursor binary

# Copilot-specific (optional)
copilot:
  auth: gh                               # "gh" (use gh CLI) or "token"
  token: ${GITHUB_TOKEN}                 # Only if auth=token
```

### Environment Variables

- `OPENAI_API_KEY` — For memory search embeddings
- `GITHUB_TOKEN` or `COPILOT_GITHUB_TOKEN` — For GitHub Copilot adapter
- `GH_TOKEN` — Fallback for GitHub auth

## Workspace Structure

```
workspace/
├── SOUL.md           # Personality & values
├── IDENTITY.md       # Who you are as an agent
├── USER.md           # About the human
├── MEMORY.md         # Long-term facts & preferences
├── AGENTS.md         # Task-specific guidelines
├── TOOLS.md          # Environment notes
├── BOOTSTRAP.md      # First-run setup
│
├── memory/           # Dated memory files
│   ├── 2026-03-12.md
│   └── *.md
│
└── skills/           # Installed skills
    └── <skill-name>/
        └── SKILL.md
```

## MCP Configuration

Register MCP servers in `mcp-servers.json`:

```json
{
  "github": {
    "transport": "stdio",
    "command": "npx",
    "args": ["@github/mcp-server"]
  },
  "notion": {
    "transport": "stdio",
    "command": "npx",
    "args": ["@notionhq/mcp-server"],
    "env": { "NOTION_API_KEY": "..." }
  },
  "custom": {
    "transport": "sse",
    "url": "http://localhost:5678/mcp/tools"
  }
}
```

## Web UI

Start the web server:

```bash
mini-chris web --port 3000
```

Visit `http://localhost:3000` for an interactive chat interface with:
- Memory and skill sidebar
- Chat history persistence (localStorage)
- MCP tool visibility
- Token usage display

## Docker

Build and run in Docker:

```bash
docker build -t mini-chris .
docker run -it \
  -e GITHUB_TOKEN=$GITHUB_TOKEN \
  -e OPENAI_API_KEY=$OPENAI_API_KEY \
  -v $(pwd)/workspace:/app/workspace \
  -p 3000:3000 \
  mini-chris web --port 3000
```

Or with docker-compose:

```bash
docker-compose up
```

## Architecture

```
User Input
    ↓
[Memory Injection] — Load SOUL.md, USER.md, MEMORY.md, etc.
    ↓
[Skill Matching] — Find relevant SKILL.md files
    ↓
[MCP Discovery] — Connect to configured servers
    ↓
[Build Prompt] — Combine memory + skills + tools + user input
    ↓
[LLM Adapter] — Send to Cursor or Copilot
    ↓
[Tool Routing] — Execute MCP tools if requested
    ↓
[Display & Persist] — Show response + save to memory
```

## Memory System

### Context Injection
Automatically loaded on every session start (in order):
1. `SOUL.md` — Core personality
2. `IDENTITY.md` — Agent identity
3. `USER.md` — Human context
4. `MEMORY.md` — Long-term facts
5. `AGENTS.md` — Task guidelines
6. `TOOLS.md` — Environment notes

### Semantic Search
```bash
mini-chris memory search "what did we decide about auth?"
```

Search across:
- `MEMORY.md` (main memory index)
- `memory/*.md` (daily/topic files)

Supports embedding providers:
- **OpenAI** — text-embedding-3-small
- **GitHub Copilot** — via API (fallback)
- **Keyword** — Simple token matching (fallback)

### Memory Persistence
After each session, new facts are automatically flushed to:
- `MEMORY.md` — Durable facts, preferences, rules
- `memory/YYYY-MM-DD.md` — Daily context

Use `mini-chris memory sync` to git commit + push.

## Skills System

### Creating a Skill

Create `workspace/skills/my-skill/SKILL.md`:

```markdown
---
name: My Skill
description: What this skill does
tags: [tag1, tag2]
---

# Skill Instructions

When user asks about {topic}, you should:
1. Do this
2. Then that
3. Return this format
```

### Matching
Skills match based on:
- Exact name match
- Description similarity to task
- Tags

When matched, `SKILL.md` content is injected into the system prompt.

## Performance

- **Installation**: ~300KB node_modules (vs 50MB+ alternatives)
- **Startup**: <1s for CLI, <2s for web server
- **Memory search**: <100ms with embeddings, <50ms with keyword fallback
- **Context size**: Warn if workspace files exceed 50KB

## Security

- ✅ No hardcoded secrets (uses environment variables)
- ✅ Config masking in API responses (`apiKey: '***'`)
- ✅ No daemon/persistent service (runs only when invoked)
- ✅ No telemetry or analytics
- ✅ All data local in `workspace/` (git sync is opt-in)
- ✅ Input sanitization in web UI (HTML escaping)

## Adapters

### Cursor Adapter
- Spawns Cursor's `agent` CLI as subprocess
- Supports model selection: `auto`, `gpt-5.3-codex`, `claude-sonnet-4.6`, etc.
- Streams response + handles tool calls
- Requires: Cursor IDE installed

### Copilot Adapter
- Uses GitHub Copilot API
- Models: `gpt-4o`, `claude-sonnet-4.5`, `gemini-2.5-pro`, etc.
- Auth via `gh` CLI or direct token
- Requires: GitHub token with Copilot access

## Environment Setup

### macOS
```bash
# Using Homebrew
brew install node gh

# Login to GitHub
gh auth login

# Install mini-chris
git clone git@github.com:cuonglph11/mini-chris.git
cd mini-chris && npm install && npm link
```

### Linux
```bash
# Install Node.js and GitHub CLI from their websites
# Then:
git clone git@github.com:cuonglph11/mini-chris.git
cd mini-chris && npm install && npm link
```

### Docker
```bash
docker-compose up
```

## Troubleshooting

### Memory search failing
- Check `OPENAI_API_KEY` is set for OpenAI embeddings
- Falls back to Copilot embeddings if OpenAI unavailable
- Falls back to keyword search if all else fails

### MCP servers not connecting
```bash
mini-chris mcp list          # Show connection status
mini-chris mcp test github   # Test specific server
```

### Cursor adapter not found
```bash
mini-chris config set cursor.binary /path/to/cursor
```

### Token limit exceeded
Cap conversation history in web UI (max 40 turns per connection) and workspace files (warn at 50KB).

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run CLI (during development)
npm run dev -- chat
npm run dev -- run "task"

# Format & lint
npm run format
npm run lint

# Run tests (if available)
npm test
```

## License

Proprietary — for authorized use only.

## Support

For issues and feature requests: [GitHub Issues](https://github.com/cuonglph11/mini-chris/issues)

---

**Made with ❤️ for personal AI agents in restricted environments**
