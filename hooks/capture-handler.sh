#!/usr/bin/env bash
# PostToolUse hook: explicit PKM capture via vault_capture tool
# Runs async after vault_capture returns. Spawns claude -p with Sonnet
# to create a properly structured vault note.

set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)

# Extract tool_input fields
TOOL_INPUT=$(echo "$INPUT" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(JSON.stringify(j.tool_input||{}))})")
CAPTURE_TYPE=$(echo "$TOOL_INPUT" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.type||'')})")
CAPTURE_TITLE=$(echo "$TOOL_INPUT" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.title||'')})")
CAPTURE_CONTENT=$(echo "$TOOL_INPUT" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.content||'')})")
CAPTURE_PRIORITY=$(echo "$TOOL_INPUT" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.priority||'normal')})")
CAPTURE_PROJECT=$(echo "$TOOL_INPUT" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.project||'')})")

# Skip if missing required fields
if [ -z "$CAPTURE_TYPE" ] || [ -z "$CAPTURE_TITLE" ] || [ -z "$CAPTURE_CONTENT" ]; then
  echo "capture-handler: skipping - missing required fields (type='$CAPTURE_TYPE')" >&2
  exit 0
fi

# MCP config for obsidian-pkm server
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
MCP_CONFIG=$(node -e "console.log(JSON.stringify({mcpServers:{'obsidian-pkm':{command:'node',args:[process.argv[1]],env:{VAULT_PATH:process.argv[2]}}}}))" "$SCRIPT_DIR/../index.js" "${VAULT_PATH:-$HOME/Documents/PKM}")

LOG_DIR="${VAULT_PATH:?}/.obsidian/hook-logs"
mkdir -p "$LOG_DIR"

# Build prompt via Node.js to avoid shell injection from user content
PROMPT_FILE=$(mktemp)
node -e "
const ti = JSON.parse(process.argv[1]);
const project = ti.project
  ? 'The project is: ' + ti.project
  : 'The project is not specified. Check vault_activity recent entries to infer the active project.';
const prompt = \`You are a PKM note creation agent. Your job is NOT done until the note has real content — not template placeholders.

## What to capture

- Type: \${ti.type}
- Title: \${ti.title}
- Content: \${ti.content}
- Priority: \${ti.priority || 'normal'}
- \${project}

## Required steps (you must do ALL of these)

1. Create the note with vault_write using the appropriate template:
   - research → template 'research-note', path: 01-Projects/{project}/research/{kebab-title}.md
   - adr → template 'adr', path: 01-Projects/{project}/development/decisions/ADR-NNN-{kebab-title}.md (use vault_list to get next number)
   - task → template 'task', path: 01-Projects/{project}/tasks/{kebab-title}.md (vault_query first to check for duplicates)
   - bug → template 'troubleshooting-log', path: 01-Projects/{project}/development/debug/{kebab-title}.md
   If vault_write fails because the file exists, use a different filename.

2. Read the created note with vault_read.

3. Use vault_edit to replace EVERY template placeholder with real content derived from the Title and Content above. For example, replace 'Brief description of the technology, tool, or concept.' with an actual description. Do this for EACH section — you will need multiple vault_edit calls.

4. Read the note one final time to confirm no placeholder text remains.

CRITICAL: If you stop after step 1 or 2, you have FAILED. The note will contain useless placeholder text like 'Brief description of the technology, tool, or concept.' which is worse than no note at all. You MUST reach step 4.\`;
require('fs').writeFileSync(process.argv[2], prompt);
" "$TOOL_INPUT" "$PROMPT_FILE"

# Spawn claude -p in background with logging
nohup claude -p --model sonnet --mcp-config "$MCP_CONFIG" --max-turns 25 --allowedTools "mcp__obsidian-pkm__vault_write mcp__obsidian-pkm__vault_read mcp__obsidian-pkm__vault_edit mcp__obsidian-pkm__vault_append mcp__obsidian-pkm__vault_query mcp__obsidian-pkm__vault_list mcp__obsidian-pkm__vault_update_frontmatter mcp__obsidian-pkm__vault_activity" < "$PROMPT_FILE" >> "$LOG_DIR/capture-$(date +%Y%m%d-%H%M%S).log" 2>&1 &

rm -f "$PROMPT_FILE"

exit 0
