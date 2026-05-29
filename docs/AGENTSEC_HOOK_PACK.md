# AgentSec Hook Pack

The AgentSec Hook Pack allows you to integrate AgentSec with Claude Code and Codex to provide runtime security and policy enforcement for your AI agents.

## What it guards

By adding these hooks, AgentSec will intercept and classify risky tool calls before execution, including:
- `Bash` commands (e.g. `rm -rf`, production deployments, db migrations)
- File edits
- MCP write/delete tools
- Secret exfiltration attempts

Safe, read-only commands (like `ls`, `grep`, `npm test`) are allowed instantly by the local classifier to avoid disrupting your workflow.

## 1. Claude Code Integration

Create or update `.claude/settings.json` in your repository root with the following snippet:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Edit|Write|mcp__.*",
        "hooks": [
          {
            "type": "command",
            "command": "node .agentsec/hooks/agentsec-hook.mjs --client claude",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

## 2. Codex Integration

Create or update `.codex/config.toml` in your repository root with the following snippet:

```toml
[[hooks.PreToolUse]]
matcher = "^Bash$|^apply_patch$|^mcp__.*"

[[hooks.PreToolUse.hooks]]
type = "command"
command = 'node "$(git rev-parse --show-toplevel)/.agentsec/hooks/agentsec-hook.mjs" --client codex'
timeout = 15
statusMessage = "Checking AgentSec policy"
```

## Configuration

Make sure your `AGENTSEC_API_KEY` is exported in your environment:

```bash
export AGENTSEC_API_KEY="your_api_key_here"
```

You can customize the AgentSec settings by modifying `.agentsec/config.json`.
