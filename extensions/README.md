# Jinx Pi Extensions

This directory contains custom Pi extensions that extend Jinx's capabilities.

## What are Pi Extensions?

Pi extensions are TypeScript modules that extend pi's behavior. They can:
- Register custom tools callable by the LLM
- Subscribe to lifecycle events (session_start, tool_call, etc.)
- Add custom commands and keyboard shortcuts
- Intercept and modify tool calls

## Available Extensions

### jinx-tools.ts

The main extension that registers Jinx's custom tools via the Pi Extension API.

**Features:**
- Re-exports all tools from `src/agent/tools.ts`
- Supports tool group filtering via environment variable or config file
- Automatic registration on Pi startup

**Configuration:**

Via environment variable:
```bash
JINX_TOOL_GROUPS=github,evolution,memory
```

Via config file (`data/tool-groups.json`):
```json
{
  "enabled": ["github", "evolution", "memory"]
}
```

If not configured, all tools are enabled.

## Tool Groups

| Group | Description | Tools |
|-------|-------------|-------|
| `github` | GitHub integration | Issues, PRs, repo stats |
| `memory` | Knowledge graph | remember, recall, relate |
| `evolution` | Self-improvement | claude_code, request_restart |
| `skills` | Skill library | list_skills, execute_skill |
| `system` | State management | update_identity, update_state |
| `web` | Web interaction | web_search, fetch_webpage |
| `swarm` | Multi-agent | run_swarm |

## Adding New Extensions

1. Create a `.ts` file in this directory
2. Export a default function that receives `ExtensionAPI`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function myExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });

  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "What this tool does",
    parameters: { ... },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return { content: [{ type: "text", text: "Done" }] };
    },
  });
}
```

## Related Files

- `src/agent/tools.ts` — Tool implementations
- `src/agent/tool-groups.ts` — Tool group filtering logic
- `skills/` — Pi skills (markdown-based instructions)