#!/usr/bin/env node

import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProject } from "./resolve-project.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_PATH = process.env.VAULT_PATH;
const LOG_DIR = VAULT_PATH ? join(VAULT_PATH, ".obsidian", "hook-logs") : null;

function logError(message) {
  if (!LOG_DIR) {
    console.error(`stop-sweep: ${message}`);
    return;
  }
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, "sweep-errors.log"), `${new Date().toISOString()} ${message}\n`);
  } catch {
    console.error(`stop-sweep: ${message}`);
  }
}

async function main() {
  // Read hook input from stdin
  let inputJson = "";
  for await (const chunk of process.stdin) {
    inputJson += chunk;
  }

  let input;
  try {
    input = JSON.parse(inputJson);
  } catch {
    logError("could not parse hook input JSON");
    return;
  }

  const { transcript_path, session_id, cwd } = input;

  // Skip if no transcript
  if (!transcript_path) return;
  try {
    await access(transcript_path);
  } catch {
    return; // transcript file missing — normal for non-conversation triggers
  }

  if (!VAULT_PATH) {
    console.error("stop-sweep: VAULT_PATH not set");
    return;
  }

  if (!cwd) {
    logError("hook input missing 'cwd' field");
    return;
  }

  // Resolve project — no project, no captures
  const { projectPath, error } = await resolveProject(cwd, VAULT_PATH);
  if (error || !projectPath) return;

  // Build MCP config — auto-detect repo (../index.js exists) vs installed (use npx)
  const localIndex = join(__dirname, "..", "index.js");
  const useLocal = existsSync(localIndex);
  const mcpEnv = { VAULT_PATH };
  if (process.env.OPENAI_API_KEY) {
    mcpEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  }
  const mcpConfig = JSON.stringify({
    mcpServers: {
      "obsidian-pkm": useLocal
        ? { command: "node", args: [localIndex], env: mcpEnv }
        : { command: "npx", args: ["-y", "obsidian-pkm@latest"], env: mcpEnv },
    },
  });

  const prompt = `You are a PKM librarian agent. Your job is to identify PKM-worthy content from the most recent conversation exchange and file it correctly in the vault.

## Context

- Project: ${projectPath}
- Session: ${session_id}
- Transcript: ${transcript_path}

## Step 1: Read the transcript

Read the file at ${transcript_path}. Find the LAST user message and LAST assistant response — this is the current exchange. All prior messages are historical context only. Do NOT capture anything from prior messages.

## Step 2: Classify what's PKM-worthy

Be conservative. Most exchanges produce NOTHING worth capturing. Skip:
- Trivial Q&A, clarifications, implementation details obvious from code
- Anything restating existing project context
- Content already handled by a vault_capture call in the same exchange
  (read the vault_capture arguments to see what type/title/content was captured;
  skip that specific item, but still capture other PKM-worthy content)

Before creating any note, use vault_search to check if a very similar note already exists — another sweep instance may have captured the same content from a prior exchange in a rapid conversation.

If you find something worth capturing, classify it:

| Content Type | Action |
|---|---|
| New task identified | Create task note: vault_write(template: "task", path: "${projectPath}/tasks/{kebab-title}.md") |
| Task completed/status changed | Find existing task via vault_query, then vault_update_frontmatter to update status |
| Significant decision agreed upon | Create ADR: vault_write(template: "adr", path: "${projectPath}/development/decisions/ADR-NNN-{kebab-title}.md") — use vault_list on the decisions directory to find the next ADR number |
| Research finding / gotcha | Create research note: vault_write(template: "research-note", path: "${projectPath}/research/{kebab-title}.md") |
| Bug root cause documented | Create troubleshooting log: vault_write(template: "troubleshooting-log", path: "${projectPath}/development/debug/{kebab-title}.md") |
| Minor implementation detail | SKIP — it's in the code/commits |

## Step 3: Create/update notes properly

For every note you create:
1. Use vault_write with the correct template
2. Use vault_edit to replace ALL template placeholders with real content
3. Use vault_suggest_links to find related notes (skip gracefully if unavailable)
4. Add [[wikilinks]] to the related notes in the body
5. Verify the note has no placeholder text remaining

For task updates:
1. Use vault_query to find the task by title/tags
2. Use vault_update_frontmatter to update status/priority
3. Optionally vault_append to add context about what changed

## Step 4: Quality check

If you created any notes, read each one back to confirm:
- No template placeholders remain
- Wikilinks are present to related notes (if vault_suggest_links was available)
- Frontmatter is complete and valid

If nothing is PKM-worthy, do nothing. Doing nothing is the correct default.`;

  // All vault tools except vault_trash and vault_capture
  const allowedTools = [
    "vault_read", "vault_peek", "vault_write", "vault_append", "vault_edit",
    "vault_update_frontmatter", "vault_search", "vault_semantic_search",
    "vault_suggest_links", "vault_list", "vault_recent", "vault_links",
    "vault_neighborhood", "vault_query", "vault_tags", "vault_activity", "vault_move",
  ].map(t => `mcp__obsidian-pkm__${t}`).join(" ");

  // Ensure log directory exists
  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = join(LOG_DIR, `sweep-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}.log`);
  const fd = openSync(logFile, "a");

  const child = spawn("claude", [
    "-p",
    "--model", "sonnet",
    "--mcp-config", mcpConfig,
    "--max-turns", "15",
    "--allowedTools", allowedTools,
  ], {
    detached: true,
    stdio: ["pipe", fd, fd],
  });

  child.on("error", (err) => {
    logError(`spawn failed: ${err.message}`);
  });

  // Pipe prompt to stdin
  child.stdin.write(prompt);
  child.stdin.end();

  closeSync(fd);

  // Detach — let the background process run independently
  child.unref();
}

main().catch((err) => {
  logError(`uncaught: ${err.message}`);
  process.exit(0);
});
