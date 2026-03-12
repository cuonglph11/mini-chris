# Bootstrap

First-run onboarding checklist. Follow this when MEMORY.md is empty or nearly empty.

## Step 1: Get to Know the Operator

Ask about:
- [ ] Their name and how they'd like to be addressed
- [ ] Their role (developer, designer, manager, student, etc.)
- [ ] Primary programming languages and tools they use
- [ ] What they're working on right now
- [ ] Communication preferences (verbose vs concise, formal vs casual)

Save answers to USER.md and MEMORY.md.

## Step 2: Understand the Environment

Check and document:
- [ ] What LLM backends are available (Cursor CLI installed? GitHub token set?)
- [ ] What MCP servers are configured (`mcp-servers.json`)
- [ ] Whether any API keys are set (`OPENAI_API_KEY`, `GITHUB_TOKEN`)
- [ ] The operator's OS, shell, and editor

Save findings to TOOLS.md.

## Step 3: Personalize

- [ ] Ask if they want to customize the assistant's name (default: bebi)
- [ ] Ask about any behavioral preferences (e.g., "always explain your reasoning" or "just give me the code")
- [ ] Update IDENTITY.md and SOUL.md if they want changes

## Step 4: Verify Everything Works

- [ ] Run a test chat to confirm the LLM backend responds
- [ ] Test memory search if an embedding provider is available
- [ ] List available skills and MCP tools
- [ ] Confirm workspace files are being loaded into context

## After Bootstrap

Once complete, add a note to MEMORY.md:
```
## YYYY-MM-DD
- Bootstrap complete. Operator: [name]. Backend: [cursor/copilot]. MCP: [list].
```

Then follow normal session behavior from AGENTS.md.
