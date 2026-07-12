import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const hookPath = path.resolve('.agentsec/hooks/agentsec-hook.mjs');

function runHook({ command, mode = 'enforce', client = 'claude', rawInput }) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'agentsec-hook-'));
  mkdirSync(path.join(cwd, '.agentsec'), { recursive: true });
  writeFileSync(
    path.join(cwd, '.agentsec', 'config.json'),
    JSON.stringify({
      baseUrl: 'http://127.0.0.1:9',
      mode,
      agentId: 'test-agent',
      safeCommands: ['ls', 'pwd', 'grep', 'find', 'npm test', 'npm run lint', 'npm run typecheck'],
    })
  );

  const env = { ...process.env };
  delete env.AGENTSEC_API_KEY;

  const result = spawnSync(process.execPath, [hookPath, '--client', client], {
    cwd,
    env,
    encoding: 'utf8',
    input:
      rawInput ??
      JSON.stringify({
        toolName: 'Bash',
        input: { command },
        context: { cwd, conversationId: 'test-session' },
      }),
  });

  rmSync(cwd, { recursive: true, force: true });
  return result;
}

function claudeDecision(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim()).permissionDecision;
}

test('allows an explicitly safe read-only command', () => {
  assert.equal(claudeDecision(runHook({ command: 'ls -la' })), 'allow');
});

test('denies an obvious destructive command in enforce mode', () => {
  assert.equal(claudeDecision(runHook({ command: 'rm -rf /' })), 'deny');
});

test('does not allow a chained destructive command because it starts with ls', () => {
  assert.equal(claudeDecision(runHook({ command: 'ls; rm -rf /' })), 'deny');
});

test('does not allow mutating find actions through the safe-command path', () => {
  assert.equal(claudeDecision(runHook({ command: 'find . -exec rm -rf {} +' })), 'deny');
});

test('asks for approval for risky commands in prompt mode without an API key', () => {
  assert.equal(claudeDecision(runHook({ command: 'git push --force', mode: 'prompt' })), 'ask');
});

test('denies malformed hook input', () => {
  assert.equal(claudeDecision(runHook({ rawInput: '{not-json' })), 'deny');
});
