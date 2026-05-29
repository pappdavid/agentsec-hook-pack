import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

// 1. Read JSON hook input from stdin
async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return JSON.parse(data || '{}');
}

// Map AgentSec decision to Claude output
function respondClaude(decision, approvalUrl) {
  if (decision === 'allow') {
    console.log(JSON.stringify({ permissionDecision: 'allow' }));
  } else if (decision === 'deny' || decision === 'block') {
    console.log(JSON.stringify({ permissionDecision: 'deny' }));
  } else if (decision === 'requires_approval') {
    console.log(JSON.stringify({ permissionDecision: 'ask' }));
  } else {
    // Default safe fallback
    console.log(JSON.stringify({ permissionDecision: 'deny' }));
  }
  process.exit(0); // Hook succeeds, returning the decision payload
}

// Map AgentSec decision to Codex output
function respondCodex(decision, approvalUrl) {
  if (decision === 'allow') {
    process.exit(0);
  } else if (decision === 'deny' || decision === 'block') {
    console.error("AgentSec denied this action.");
    process.exit(1);
  } else if (decision === 'requires_approval') {
    console.error(`AgentSec approval required: ${approvalUrl || 'Check dashboard'}. Retry after approval.`);
    process.exit(1); // Do not map requires_approval to Codex ask in V1
  } else {
    process.exit(1);
  }
}

function respond(client, decision, approvalUrl) {
  if (client === 'claude') {
    respondClaude(decision, approvalUrl);
  } else {
    respondCodex(decision, approvalUrl);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const clientIndex = args.indexOf('--client');
  const client = clientIndex !== -1 ? args[clientIndex + 1] : 'claude';

  let inputData;
  try {
    inputData = await readStdin();
  } catch (err) {
    console.error("Failed to parse stdin", err);
    respond(client, 'deny');
    return;
  }

  // 3. Extract tool_name, command, cwd, session id
  const toolName = inputData.toolName || inputData.tool || inputData.name || 'unknown';
  const inputArgs = inputData.input || inputData.args || inputData.parameters || {};
  
  const command = inputArgs.command || inputArgs.patch || JSON.stringify(inputArgs);
  const cwd = (inputData.context && inputData.context.cwd) || process.cwd();
  const sessionId = (inputData.context && inputData.context.conversationId) || inputData.sessionId || 'unknown';

  // Load Config
  let config = { mode: 'observe', baseUrl: 'https://promptshield-cyan.vercel.app', agentId: 'local-coding-agent' };
  try {
    const configPath = path.join(process.cwd(), '.agentsec', 'config.json');
    if (fs.existsSync(configPath)) {
      const configRaw = fs.readFileSync(configPath, 'utf8');
      config = { ...config, ...JSON.parse(configRaw) };
    }
  } catch (e) {
    // ignore
  }

  // 4. Classify risk locally
  const safeCommands = config.safeCommands || [
    'ls', 'pwd', 'grep', 'find', 'npm test', 'npm run lint', 'npm run typecheck'
  ];
  
  let isSafe = false;
  if (toolName === 'Bash' || toolName === 'shell_command' || toolName.toLowerCase() === 'bash') {
    const cmdTrimmed = command.trim();
    if (safeCommands.some(sc => cmdTrimmed.startsWith(sc))) {
      isSafe = true;
    }
    // Simple block list for obvious bad commands
    const blockPatterns = [
      /^rm\s+-rf\s+\/$/,
      /^rm\s+-rf\s+~$/,
      /^rm\s+-rf\s+\.$/,
      /curl.*\|.*sh/i,
      /wget.*\|.*sh/i,
      /\.env\s+.*curl/i // Obvious secret exfiltration
    ];
    if (blockPatterns.some(p => p.test(cmdTrimmed))) {
      if (config.mode === 'observe') return respond(client, 'allow');
      return respond(client, 'block');
    }
  } else if (toolName.startsWith('mcp__') && (toolName.includes('search') || toolName.includes('list') || toolName.includes('get'))) {
    isSafe = true; // Read-only MCP tools
  } else if (toolName.toLowerCase() === 'cat') {
    if (!command.includes('.env') && !command.includes('secret')) {
        isSafe = true; // basic cat allowance if not secret
    }
  }

  // Skip safe actions immediately
  if (isSafe) {
    return respond(client, 'allow');
  }

  // 6. For risky actions, send POST to /api/runtime/inspect
  const apiKey = process.env.AGENTSEC_API_KEY;
  if (!apiKey) {
    if (config.mode === 'observe') {
      return respond(client, 'allow');
    } else if (config.mode === 'prompt') {
      console.error("AGENTSEC_API_KEY is not set.");
      return respond(client, 'requires_approval');
    } else {
      console.error("AGENTSEC_API_KEY is not set.");
      return respond(client, 'deny');
    }
  }

  // Construct AgentAction payload
  let actionType = 'tool_use';
  if (toolName === 'Bash' || toolName.toLowerCase() === 'bash') {
      actionType = 'shell_command';
      if (command.includes('vercel deploy --prod')) actionType = 'production_deploy';
      if (command.includes('prisma migrate')) actionType = 'database_migration';
      if (command.includes('.env')) actionType = 'env_secret_access';
  } else if (toolName.toLowerCase() === 'apply_patch') {
      actionType = 'file_edit';
  } else if (toolName.startsWith('mcp__')) {
      if (toolName.includes('github')) actionType = 'github_write';
      else if (toolName.includes('db') || toolName.includes('neon')) actionType = 'db_write';
      else actionType = 'mcp_tool';
  }

  const payload = JSON.stringify({
    agentId: config.agentId || 'local-coding-agent',
    sessionId: sessionId,
    action: {
      type: actionType,
      tool: toolName,
      command: command,
      cwd: cwd
    }
  });

  const url = new URL('/api/runtime/inspect', config.baseUrl);
  const clientModule = url.protocol === 'https:' ? https : http;
  
  const reqOptions = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 5000 // 5 seconds
  };

  const req = clientModule.request(reqOptions, (res) => {
    let responseData = '';
    res.on('data', chunk => responseData += chunk);
    res.on('end', () => {
      let decision = 'allow';
      let approvalUrl = '';
      try {
        if (res.statusCode >= 200 && res.statusCode < 300) {
           const parsed = JSON.parse(responseData);
           decision = parsed.decision || 'allow';
           approvalUrl = parsed.approvalUrl || '';
        } else {
           decision = 'deny';
        }
      } catch (e) {
        decision = 'deny';
      }
      
      if (config.mode === 'observe') {
        respond(client, 'allow', approvalUrl);
      } else if (config.mode === 'prompt') {
        // In prompt mode, we only block obvious critical local patterns (already handled earlier).
        // If API returns block, we map it to requires_approval so the user is prompted.
        if (decision === 'block' || decision === 'deny') {
            respond(client, 'requires_approval', approvalUrl);
        } else {
            respond(client, decision, approvalUrl);
        }
      } else {
        // enforce mode
        respond(client, decision, approvalUrl);
      }
    });
  });

  req.on('error', (e) => {
    console.error(`AgentSec API request failed: ${e.message}`);
    // Fail safely for high-risk actions if AgentSec is unavailable
    if (config.mode === 'observe') {
      respond(client, 'allow');
    } else if (config.mode === 'prompt') {
      respond(client, 'requires_approval');
    } else {
      respond(client, 'deny');
    }
  });

  req.on('timeout', () => {
    req.destroy();
    console.error("AgentSec API request timed out.");
    if (config.mode === 'observe') {
      respond(client, 'allow');
    } else if (config.mode === 'prompt') {
      respond(client, 'requires_approval');
    } else {
      respond(client, 'deny');
    }
  });

  req.write(payload);
  req.end();
}

main();
