#!/usr/bin/env bash
# Stop hook: passive PKM capture sweep
# Runs async after each Claude response. Spawns claude -p with Haiku
# to analyze the transcript and capture decisions/tasks/findings.

set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)

TRANSCRIPT_PATH=$(echo "$INPUT" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.transcript_path||'')})")
SESSION_ID=$(echo "$INPUT" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.session_id||'')})")
CWD=$(echo "$INPUT" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.cwd||'')})")

# Skip if no transcript
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  exit 0
fi

# MCP config for obsidian-pkm server
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
MCP_CONFIG=$(node -e "console.log(JSON.stringify({mcpServers:{'obsidian-pkm':{command:'node',args:[process.argv[1]],env:{VAULT_PATH:process.argv[2]}}}}))" "$SCRIPT_DIR/../index.js" "${VAULT_PATH:-$HOME/Documents/PKM}")

LOG_DIR="${VAULT_PATH:?}/.obsidian/hook-logs"
mkdir -p "$LOG_DIR"

PROJECT_NAME=$(basename "$CWD")
SESSION_SHORT=$(echo "$SESSION_ID" | cut -c1-8)
TODAY=$(date +%Y-%m-%d)
NOW=$(date +%H:%M)

# Build the prompt
PROMPT="You are a PKM passive capture agent. Your job is to identify decisions, task changes, and research findings from the most recent conversation exchange and append them to the vault staging inbox.

## Transcript

Read the file at: $TRANSCRIPT_PATH

Find the LAST user message and LAST assistant message at the end of the file — these are the current exchange. One exchange = one contiguous user message + one contiguous assistant response (the last complete turn pair). All prior messages are historical context only. Do NOT capture anything from prior messages.

## What to Capture

1. **Decisions**: Technical or architectural choices that were AGREED upon (not proposed, not still being discussed)
2. **Task changes**: New tasks identified, tasks completed, priority changes, blockers discovered
3. **Research findings**: Patterns discovered, library behaviors documented, gotchas found

## Noise Suppression

Be conservative. Skip: trivial exchanges, clarification Q&A that hasn't resolved, implementation details obvious from code, anything restating existing project context. When in doubt, don't capture.

## Deduplication

If the assistant message in the current exchange contains a vault_capture tool call, the content of that capture is already being handled by the explicit capture agent. Do NOT also capture it in the staging inbox — skip it to avoid semantic duplication.

## Output

If you find PKM-worthy content, use vault_append to add entries to 00-Inbox/captures-${TODAY}.md. If the file doesn't exist, create it first with vault_write (template: fleeting-note, tags: [capture, auto]). Each entry format:

## ${NOW} — {Category}: {Title}

{1-3 sentence description}

**Source:** ${PROJECT_NAME}, session ${SESSION_SHORT}

---

If nothing is PKM-worthy, do nothing."

# Spawn claude -p in background (detached, no stdin/stdout)
echo "$PROMPT" | nohup claude -p --model haiku --mcp-config "$MCP_CONFIG" --max-turns 5 >> "$LOG_DIR/sweep-$(date +%Y%m%d-%H%M%S).log" 2>&1 &

exit 0
