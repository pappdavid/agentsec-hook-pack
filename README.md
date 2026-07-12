<div align="center">

# AgentSec Hook Pack

**Pre-tool-use policy hook prototype for AI coding agents**

</div>

## Scope

AgentSec Hook Pack is a dependency-free Node.js hook that reads a tool-use event from standard input and returns a client-specific allow, deny, or approval decision.

It provides:

- local allow rules for explicitly configured read-only commands
- local blocking rules for obvious destructive shell patterns
- read-only MCP tool fast paths
- optional remote policy inspection through an AgentSec-compatible HTTP endpoint
- `observe`, `prompt`, and `enforce` modes
- Claude-style JSON decisions and exit-code based client behavior

The default configuration uses `observe` mode. In that mode risky actions are allowed after inspection; use `prompt` or `enforce` when the hook must interrupt execution.

## Verified behavior

GitHub Actions runs the hook on Node.js 20 and verifies:

- JavaScript syntax
- configuration JSON validity
- safe read-only command allowance
- destructive command denial in enforce mode
- rejection of chained-command prefix bypasses such as `ls; rm -rf /`
- rejection of mutating `find -exec` commands through the safe path
- prompt-mode fallback when no API key is available
- fail-closed handling of malformed hook input

## Installation

Copy `.agentsec` into the repository that should use the hook:

```bash
cp -r /path/to/agentsec-hook-pack/.agentsec .
```

Set the remote policy key when remote inspection is required:

```bash
export AGENTSEC_API_KEY="your_api_key_here"
```

Run the hook directly:

```bash
echo '{"toolName":"Bash","input":{"command":"npm test"}}' \
  | node .agentsec/hooks/agentsec-hook.mjs --client claude
```

Claude-style allow response:

```json
{"permissionDecision":"allow"}
```

## Configuration

`.agentsec/config.json`:

```json
{
  "baseUrl": "https://promptshield-cyan.vercel.app",
  "mode": "observe",
  "agentId": "local-coding-agent",
  "safeCommands": ["ls", "pwd", "grep", "find", "npm test", "npm run lint"]
}
```

| Mode | Behavior |
|---|---|
| `observe` | Performs classification but allows the action |
| `prompt` | Converts risky or unavailable-policy decisions into an approval request |
| `enforce` | Denies local blocks, remote denials, and unavailable-policy risky actions |

Safe-command entries allow the exact command or arguments following it. Commands containing shell chaining, redirection, command substitution, or mutating `find` actions do not use the safe fast path.

## Client examples

Example configuration snippets are included for Claude-style hooks and an exit-code based Codex-style adapter:

- `.claude/settings.agentsec.example.json`
- `.codex/config.agentsec.example.toml`

These files are integration examples. Client hook formats can change and should be checked against the installed client version.

## Development

```bash
npm run check
npm test
```

## Current limitations

- remote classification depends on the configured HTTP service
- the local rule set is intentionally small and conservative
- `observe` mode does not block actions
- approval persistence and reviewer UI are external to this repository
- shell classification is not a substitute for OS sandboxing or least-privilege credentials
