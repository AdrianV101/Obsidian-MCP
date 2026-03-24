#!/usr/bin/env bash
# PostToolUse hook: explicit PKM capture via vault_capture tool
# Runs async after vault_capture returns. Spawns claude -p with Opus
# to create a properly structured vault note with graph links.

set -euo pipefail

LOG_DIR="${VAULT_PATH:?}/.obsidian/hook-logs"
mkdir -p "$LOG_DIR"
PROMPT_FILE=""
cleanup() { [ -n "$PROMPT_FILE" ] && rm -f "$PROMPT_FILE"; }
trap 'echo "capture-handler: failed at line $LINENO" >> "$LOG_DIR/capture-errors.log"; cleanup' ERR
trap cleanup EXIT

# Read hook input from stdin
INPUT=$(cat)

# Extract tool_input fields safely (no eval — stdout capture only)
TOOL_INPUT=$(echo "$INPUT" | node -e "
  let b=''; process.stdin.on('data',c=>b+=c);
  process.stdin.on('end',()=>{ process.stdout.write(JSON.stringify(JSON.parse(b).tool_input||{})); })
")
CAPTURE_TYPE=$(echo "$INPUT" | node -e "
  let b=''; process.stdin.on('data',c=>b+=c);
  process.stdin.on('end',()=>{ process.stdout.write((JSON.parse(b).tool_input||{}).type||''); })
")
CAPTURE_TITLE=$(echo "$INPUT" | node -e "
  let b=''; process.stdin.on('data',c=>b+=c);
  process.stdin.on('end',()=>{ process.stdout.write((JSON.parse(b).tool_input||{}).title||''); })
")
CAPTURE_CONTENT=$(echo "$INPUT" | node -e "
  let b=''; process.stdin.on('data',c=>b+=c);
  process.stdin.on('end',()=>{ process.stdout.write((JSON.parse(b).tool_input||{}).content||''); })
")

# Skip if missing required fields
if [ -z "$CAPTURE_TYPE" ] || [ -z "$CAPTURE_TITLE" ] || [ -z "$CAPTURE_CONTENT" ]; then
  echo "capture-handler: skipping - missing required fields (type='$CAPTURE_TYPE')" >&2
  exit 0
fi

# MCP config — auto-detect repo (../index.js exists) vs installed (use npx)
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
MCP_CONFIG=$(node -e "
  const { existsSync } = require('fs');
  const path = require('path');
  const localIndex = path.join(process.argv[1], '..', 'index.js');
  const useLocal = existsSync(localIndex);
  const env = { VAULT_PATH: process.argv[2] };
  if (process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const server = useLocal
    ? { command: 'node', args: [localIndex], env }
    : { command: 'npx', args: ['-y', 'obsidian-pkm@latest'], env };
  console.log(JSON.stringify({ mcpServers: { 'obsidian-pkm': server } }));
" "$SCRIPT_DIR" "${VAULT_PATH:-$HOME/Documents/PKM}")

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

5. Use vault_suggest_links with the note's content to find related notes. If the tool is available, add [[wikilinks]] to 2-3 of the most relevant suggestions in the note body using vault_edit.

6. Use vault_search to verify no very similar note already exists. If a near-duplicate is found, consider appending to the existing note instead of creating a new one.

CRITICAL: If you stop after step 1 or 2, you have FAILED. The note will contain useless placeholder text like 'Brief description of the technology, tool, or concept.' which is worse than no note at all. You MUST reach step 6.\`;
require('fs').writeFileSync(process.argv[2], prompt);
" "$TOOL_INPUT" "$PROMPT_FILE"

# Spawn claude -p in background with logging
nohup claude -p --model opus --mcp-config "$MCP_CONFIG" --max-turns 30 --allowedTools "mcp__obsidian-pkm__vault_read mcp__obsidian-pkm__vault_peek mcp__obsidian-pkm__vault_write mcp__obsidian-pkm__vault_append mcp__obsidian-pkm__vault_edit mcp__obsidian-pkm__vault_update_frontmatter mcp__obsidian-pkm__vault_search mcp__obsidian-pkm__vault_semantic_search mcp__obsidian-pkm__vault_suggest_links mcp__obsidian-pkm__vault_list mcp__obsidian-pkm__vault_recent mcp__obsidian-pkm__vault_links mcp__obsidian-pkm__vault_neighborhood mcp__obsidian-pkm__vault_query mcp__obsidian-pkm__vault_tags mcp__obsidian-pkm__vault_activity mcp__obsidian-pkm__vault_move" < "$PROMPT_FILE" >> "$LOG_DIR/capture-$(date +%Y%m%d-%H%M%S).log" 2>&1 &

exit 0
