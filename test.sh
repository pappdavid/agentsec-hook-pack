#!/bin/bash

HOOK="node .agentsec/hooks/agentsec-hook.mjs"

echo "=== Test 1: Claude Safe command (npm test) ==="
echo '{"toolName": "Bash", "input": {"command": "npm test"}, "context": {"cwd": "/", "conversationId": "123"}}' | $HOOK --client claude

echo -e "\n=== Test 2: Claude dangerous command (rm -rf /) in observe ==="
sed -i '' 's/"mode": "[^"]*"/"mode": "observe"/' .agentsec/config.json
echo '{"toolName": "Bash", "input": {"command": "rm -rf /"}, "context": {"cwd": "/", "conversationId": "123"}}' | $HOOK --client claude

echo -e "\n=== Test 3: Claude dangerous command (rm -rf /) in enforce ==="
sed -i '' 's/"mode": "[^"]*"/"mode": "enforce"/' .agentsec/config.json
echo '{"toolName": "Bash", "input": {"command": "rm -rf /"}, "context": {"cwd": "/", "conversationId": "123"}}' | $HOOK --client claude

echo -e "\n=== Test 4: Codex dangerous command (rm -rf /) in enforce ==="
echo '{"toolName": "Bash", "input": {"command": "rm -rf /"}, "context": {"cwd": "/", "conversationId": "123"}}' | $HOOK --client codex

echo -e "\n=== Test 5: Claude production deploy API missing in prompt mode ==="
sed -i '' 's/"mode": "[^"]*"/"mode": "prompt"/' .agentsec/config.json
# Without API key, prompt mode should fail by mapping to requires_approval (ask)
echo '{"toolName": "Bash", "input": {"command": "vercel deploy --prod"}, "context": {"cwd": "/", "conversationId": "123"}}' | $HOOK --client claude

echo -e "\n=== Test 6: Codex production deploy API missing in prompt mode ==="
echo '{"toolName": "Bash", "input": {"command": "vercel deploy --prod"}, "context": {"cwd": "/", "conversationId": "123"}}' | $HOOK --client codex

# Restore config to observe
sed -i '' 's/"mode": "[^"]*"/"mode": "observe"/' .agentsec/config.json
