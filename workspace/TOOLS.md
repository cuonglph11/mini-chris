# Tools

Environment-specific tool configuration and notes.

## LLM Backends

### Cursor CLI (Primary)
- **Command:** `cursor agent --print --output-format stream-json --stream-partial-output --force --trust`
- **Event format:** JSON lines with types: `assistant`, `tool_call`, `result`, `system`, `user`
- **Streaming:** `assistant` events with `timestamp_ms` are deltas; without are final duplicates
- **Models:** Run `cursor agent --list-models` to see available models
- **Built-in tools:** glob, grep, shell, file read/write — these are NOT MCP tools

### GitHub Copilot (Fallback)
- **Endpoint:** `https://api.githubcopilot.com/chat/completions`
- **Auth:** `COPILOT_GITHUB_TOKEN` → `GITHUB_TOKEN` → `GH_TOKEN` → `gh auth token`
- **Headers:** Must include VS Code-compatible User-Agent and Editor-Version
- **Models:** `gpt-4o`, `gpt-4o-mini`, `claude-3.5-sonnet`, `o3-mini` (availability varies)

## MCP Servers

### vibium (Web Search)
- **Transport:** stdio
- **Command:** `npx -y vibium mcp`
- **Tools:** Web search, page fetch
- **Config:** `mcp-servers.json`

## Embedding Providers (for Memory Search)

Fallback chain — tries each in order:
1. **OpenAI** — `text-embedding-3-small` via OpenAI API (needs `OPENAI_API_KEY`)
2. **GitHub Copilot** — `text-embedding-3-small` via Copilot embeddings endpoint
3. **Keyword Search** — Local TF-IDF-like scoring, no API needed

## Environment Notes

- **Platform:** macOS (Darwin)
- **Node.js:** v20+
- **Package Manager:** npm
- **Shell:** zsh
- **Git:** Available but workspace is not a git repo by default
