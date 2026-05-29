import React from 'react';

export default function IntegrationsPage() {
  return (
    <div className="max-w-4xl mx-auto py-12 px-6">
      <h1 className="text-4xl font-bold mb-6">AgentSec Integrations</h1>
      <p className="text-lg text-gray-600 mb-12">
        Easily drop AgentSec into your favorite AI coding agents to ensure runtime security and policy enforcement.
      </p>

      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">1. Claude Code Integration</h2>
        <p className="mb-4 text-gray-700">
          Add the following to your <code>.claude/settings.json</code> to intercept tool executions.
        </p>
        <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
          <pre className="text-gray-100 text-sm">
            {`{
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
}`}
          </pre>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">2. Codex Integration</h2>
        <p className="mb-4 text-gray-700">
          Add the following to your <code>.codex/config.toml</code> to guard Codex tool executions.
        </p>
        <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
          <pre className="text-gray-100 text-sm">
            {`[[hooks.PreToolUse]]
matcher = "^Bash$|^apply_patch$|^mcp__.*"

[[hooks.PreToolUse.hooks]]
type = "command"
command = 'node "$(git rev-parse --show-toplevel)/.agentsec/hooks/agentsec-hook.mjs" --client codex'
timeout = 15
statusMessage = "Checking AgentSec policy"`}
          </pre>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4">3. What it Guards</h2>
        <ul className="list-disc pl-6 text-gray-700 space-y-2">
          <li><strong>Bash Commands:</strong> Intercepts high-risk commands like <code>rm -rf</code>, production deployments, and database migrations.</li>
          <li><strong>File Edits:</strong> Prevents unauthorized modifications to critical configurations or source code.</li>
          <li><strong>MCP Write Tools:</strong> Guards Model Context Protocol tools that write, delete, or deploy resources.</li>
          <li><strong>Secrets:</strong> Stops obvious secret exfiltration attempts (e.g., reading <code>.env</code> to external servers).</li>
        </ul>
      </section>
    </div>
  );
}
