import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const hookPath = path.resolve('.agentsec/hooks/agentsec-hook.mjs');

function runHook({
  command,
  mode = 'enforce',
  client = 'claude',
  rawInput,
  baseUrl = 'http://127.0.0.1:9',
  apiKey,
}) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'agentsec-hook-'));
  mkdirSync(path.join(cwd, '.agentsec'), { recursive: true });
  writeFileSync(
    path.join(cwd, '.agentsec', 'config.json'),
    JSON.stringify({
      baseUrl,
      mode,
      agentId: 'test-agent',
      safeCommands: ['ls', 'pwd', 'grep', 'find', 'npm test', 'npm run lint', 'npm run typecheck'],
    })
  );

  const env = { ...process.env };
  if (apiKey) env.AGENTSEC_API_KEY = apiKey;
  else delete env.AGENTSEC_API_KEY;

  const input =
    rawInput ??
    JSON.stringify({
      toolName: 'Bash',
      input: { command },
      context: { cwd, conversationId: 'test-session' },
    });

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookPath, '--client', client], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (status) => {
      rmSync(cwd, { recursive: true, force: true });
      resolve({ status, stdout, stderr });
    });

    child.stdin.end(input);
  });
}

function claudeDecision(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim()).permissionDecision;
}

async function withMockApi(response, callback) {
  let receivedPayload = null;
  let receivedAuthorization = null;

  const server = http.createServer((request, reply) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      receivedAuthorization = request.headers.authorization;
      receivedPayload = JSON.parse(body);
      reply.writeHead(response.statusCode ?? 200, { 'content-type': 'application/json' });
      reply.end(JSON.stringify(response.body ?? response));
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await callback({
      baseUrl,
      getPayload: () => receivedPayload,
      getAuthorization: () => receivedAuthorization,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('allows an explicitly safe read-only command', async () => {
  assert.equal(claudeDecision(await runHook({ command: 'ls -la' })), 'allow');
});

test('denies an obvious destructive command in enforce mode', async () => {
  assert.equal(claudeDecision(await runHook({ command: 'sudo rm -fr /' })), 'deny');
});

test('does not allow a chained destructive command because it starts with ls', async () => {
  assert.equal(claudeDecision(await runHook({ command: 'ls; rm -rf /' })), 'deny');
});

test('does not allow mutating find actions through the safe-command path', async () => {
  assert.equal(claudeDecision(await runHook({ command: 'find . -exec rm -rf {} +' })), 'deny');
});

test('asks for approval for risky commands in prompt mode without an API key', async () => {
  assert.equal(claudeDecision(await runHook({ command: 'git push --force', mode: 'prompt' })), 'ask');
});

test('denies malformed hook input', async () => {
  assert.equal(claudeDecision(await runHook({ rawInput: '{not-json' })), 'deny');
});

test('allows an API-approved action and sends the expected payload', async () => {
  await withMockApi({ decision: 'allow' }, async ({ baseUrl, getPayload, getAuthorization }) => {
    const result = await runHook({ command: 'git status', baseUrl, apiKey: 'test-key' });
    assert.equal(claudeDecision(result), 'allow');
    assert.equal(getAuthorization(), 'Bearer test-key');
    assert.deepEqual(getPayload(), {
      agentId: 'test-agent',
      sessionId: 'test-session',
      action: {
        type: 'shell_command',
        tool: 'Bash',
        command: 'git status',
        cwd: getPayload().action.cwd,
      },
    });
    assert.equal(typeof getPayload().action.cwd, 'string');
  });
});

test('denies an API-rejected action in enforce mode', async () => {
  await withMockApi({ decision: 'deny' }, async ({ baseUrl }) => {
    assert.equal(
      claudeDecision(await runHook({ command: 'git push origin main', baseUrl, apiKey: 'test-key' })),
      'deny'
    );
  });
});

test('maps an API denial to approval in prompt mode', async () => {
  await withMockApi(
    { decision: 'deny', approvalUrl: 'https://example.invalid/approval/1' },
    async ({ baseUrl }) => {
      assert.equal(
        claudeDecision(
          await runHook({ command: 'git push origin main', baseUrl, apiKey: 'test-key', mode: 'prompt' })
        ),
        'ask'
      );
    }
  );
});

test('uses nonzero exit status for a Codex denial', async () => {
  await withMockApi({ decision: 'deny' }, async ({ baseUrl }) => {
    const result = await runHook({
      command: 'git push origin main',
      baseUrl,
      apiKey: 'test-key',
      client: 'codex',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /denied/i);
  });
});

test('fails closed when the policy API is unavailable in enforce mode', async () => {
  assert.equal(
    claudeDecision(
      await runHook({ command: 'git push origin main', apiKey: 'test-key', baseUrl: 'http://127.0.0.1:9' })
    ),
    'deny'
  );
});

test('allows API outages only in explicit observe mode', async () => {
  assert.equal(
    claudeDecision(
      await runHook({
        command: 'git push origin main',
        apiKey: 'test-key',
        baseUrl: 'http://127.0.0.1:9',
        mode: 'observe',
      })
    ),
    'allow'
  );
});
