# PKM Hook System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate the PKM read-at-start / write-continuously lifecycle using Claude Code hooks, adding a `vault_capture` MCP tool for explicit signaling.

**Architecture:** Three hooks (SessionStart command, Stop agent, PostToolUse agent) plus one new MCP tool (`vault_capture`). SessionStart loads project context into Claude's context window. Stop passively sweeps transcripts for PKM-worthy content. `vault_capture` signals the PostToolUse agent to create structured vault notes.

**Tech Stack:** Node.js (ES modules), `node:test` for testing, existing `helpers.js`/`utils.js` for vault access.

**Spec:** `docs/superpowers/specs/2026-03-17-pkm-hook-system-design.md`

---

## Chunk 1: Phase 0 — Proof-of-Concept Validation

Before building anything, validate the three critical assumptions about Claude Code agent hooks.

### Task 1: Create a test MCP tool and agent hook PoC

**Files:**
- No persistent files (all temporary artifacts deleted after Phase 0)
- No test file (manual validation only)

- [ ] **Step 1: Create a minimal dummy MCP tool for testing**

Add a temporary tool `vault_test_hook` to `index.js` (after the `vault_move` tool definition, around line 347). This tool does nothing except return a timestamp. We'll use it to trigger a PostToolUse agent hook.

```javascript
// TEMPORARY — Phase 0 PoC only. Remove after validation.
{
  name: "vault_test_hook",
  description: "Temporary tool for testing agent hooks. Remove after Phase 0.",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", description: "Test message" }
    },
    required: ["message"]
  }
}
```

Add the handler in `handlers.js` (before the return Map, around line 851):

```javascript
async function handleTestHook(args) {
  return {
    content: [{ type: "text", text: `Test hook received: ${args.message} at ${new Date().toISOString()}` }]
  };
}
```

Add to the handler Map (line ~869):

```javascript
["vault_test_hook", handleTestHook],
```

- [ ] **Step 2: Configure the test agent hook in settings.json**

Add to `~/.claude/settings.json` under `hooks`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__obsidian-pkm__vault_test_hook",
        "hooks": [
          {
            "type": "agent",
            "model": "claude-haiku-4-5-20251001",
            "async": true,
            "timeout": 30,
            "prompt": "You are a test agent. The hook input is: $ARGUMENTS\n\nDo the following:\n1. Use vault_list to list the root directory of the vault.\n2. Write a file at /tmp/pkm-hook-agent-result.txt using the Write tool containing: (a) the vault listing result, (b) the current timestamp, (c) the full hook input JSON you received above (copy it verbatim so we can verify $ARGUMENTS injection worked).\n\nThis is a test to verify agent hooks work correctly."
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Run the validation tests**

Start a fresh Claude Code session. Call the test tool:

```
Call vault_test_hook with message "phase0-test"
```

**Validate A1 (async):** Claude should respond immediately. If Claude freezes for 30+ seconds waiting for the agent, A1 fails.

**Validate A2 (MCP access):** After ~30 seconds, check `/tmp/pkm-hook-agent-result.txt`. If it contains vault directory listing, A2 passes.

**Validate A3 ($ARGUMENTS):** Check `/tmp/pkm-hook-agent-result.txt`. If the agent's output references the tool input (the test message "phase0-test"), then `$ARGUMENTS` successfully injected the hook input JSON into the agent's prompt. The agent could only know the message content if `$ARGUMENTS` worked.

Run: `cat /tmp/pkm-hook-agent-result.txt`

- [ ] **Step 4: Record results and clean up**

Document which assumptions passed/failed. If any fail, implement the corresponding fallback from the spec's "Fallback Plan" section before proceeding.

Clean up:
- Remove `vault_test_hook` tool definition from `index.js`
- Remove `handleTestHook` function and Map entry from `handlers.js`
- Remove hooks config from `~/.claude/settings.json`
- Delete `/tmp/pkm-hook-agent-result.txt`

- [ ] **Step 5: Commit Phase 0 results**

If all assumptions pass, no code changes to commit (everything was cleaned up). Record the validation results in a commit message:

```bash
git commit --allow-empty -m "chore: Phase 0 PoC validated — agent hooks work as expected

Validated:
- A1: async: true on agent hooks works (Claude not blocked)
- A2: Agent hooks can call MCP tools (vault_list succeeded)
- A3: \$ARGUMENTS placeholder injects hook input JSON correctly"
```

---

## Chunk 2: SessionStart Hook + vault_capture Tool

### Task 2: Create the project resolution module

**Files:**
- Create: `hooks/resolve-project.js`
- Create: `tests/resolve-project.test.js`

This module handles the cwd → vault project mapping logic. It's extracted as a separate module so the resolution logic is testable independently of the full SessionStart hook.

- [ ] **Step 1: Write failing tests for project resolution**

Create `tests/resolve-project.test.js`:

```javascript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { resolveProject } from "../hooks/resolve-project.js";

describe("resolveProject", () => {
  let tmpDir;
  let vaultPath;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pkm-test-"));
    vaultPath = path.join(tmpDir, "vault");
    await fs.mkdir(path.join(vaultPath, "01-Projects", "MyApp"), { recursive: true });
    await fs.mkdir(path.join(vaultPath, "01-Projects", "Obsidian-MCP"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("resolves by basename match (case-insensitive)", async () => {
    const result = await resolveProject("/home/user/Projects/myapp", vaultPath);
    assert.equal(result.projectPath, "01-Projects/MyApp");
    assert.equal(result.error, undefined);
  });

  it("resolves by CLAUDE.md annotation when basename fails", async () => {
    const cwdPath = path.join(tmpDir, "different-name");
    await fs.mkdir(cwdPath, { recursive: true });
    await fs.writeFile(
      path.join(cwdPath, "CLAUDE.md"),
      "# Project\n\n# PKM: 01-Projects/MyApp\n\nSome instructions."
    );
    const result = await resolveProject(cwdPath, vaultPath);
    assert.equal(result.projectPath, "01-Projects/MyApp");
  });

  it("returns error when no match found", async () => {
    const result = await resolveProject("/home/user/Projects/unknown-repo", vaultPath);
    assert.equal(result.projectPath, undefined);
    assert.ok(result.error.includes("No vault project found"));
  });

  it("returns error when VAULT_PATH does not exist", async () => {
    const result = await resolveProject("/some/dir", "/nonexistent/vault");
    assert.equal(result.projectPath, undefined);
    assert.ok(result.error);
  });

  it("handles CLAUDE.md annotation with .claude/ subdirectory", async () => {
    const cwdPath = path.join(tmpDir, "other-repo");
    await fs.mkdir(path.join(cwdPath, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(cwdPath, "CLAUDE.md"),
      "# PKM: 01-Projects/Obsidian-MCP\n"
    );
    const result = await resolveProject(cwdPath, vaultPath);
    assert.equal(result.projectPath, "01-Projects/Obsidian-MCP");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/resolve-project.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement resolveProject**

Create `hooks/resolve-project.js`:

```javascript
import fs from "fs/promises";
import path from "path";

/**
 * Resolve a working directory to a vault project path.
 *
 * Strategy:
 * 1. Basename match: compare basename(cwd) against 01-Projects/ subdirectories (case-insensitive)
 * 2. CLAUDE.md fallback: look for "# PKM: <path>" annotation in cwd/CLAUDE.md
 * 3. Error: return descriptive error if neither resolves
 *
 * @param {string} cwd - absolute path to the current working directory
 * @param {string} vaultPath - absolute path to the vault root
 * @returns {{ projectPath?: string, error?: string }}
 */
export async function resolveProject(cwd, vaultPath) {
  // Verify vault exists
  try {
    await fs.access(vaultPath);
  } catch {
    return { error: `VAULT_PATH does not exist: ${vaultPath}` };
  }

  const projectsDir = path.join(vaultPath, "01-Projects");
  const cwdBasename = path.basename(cwd).toLowerCase();

  // Step 1: Basename match
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.toLowerCase() === cwdBasename) {
        return { projectPath: `01-Projects/${entry.name}` };
      }
    }
  } catch {
    // 01-Projects/ doesn't exist — fall through to CLAUDE.md check
  }

  // Step 2: CLAUDE.md annotation
  try {
    const claudeMd = await fs.readFile(path.join(cwd, "CLAUDE.md"), "utf-8");
    const match = claudeMd.match(/^#\s+PKM:\s*(.+)$/m);
    if (match) {
      const annotatedPath = match[1].trim();
      // Verify the annotated path exists in the vault
      try {
        await fs.access(path.join(vaultPath, annotatedPath));
        return { projectPath: annotatedPath };
      } catch {
        return { error: `CLAUDE.md annotation points to non-existent vault path: ${annotatedPath}` };
      }
    }
  } catch {
    // No CLAUDE.md or not readable — fall through
  }

  // Step 3: Error
  return {
    error: `No vault project found for "${path.basename(cwd)}". ` +
      `To fix: ensure your project folder name matches the repo name in 01-Projects/, ` +
      `or add "# PKM: 01-Projects/YourProject" to your project's CLAUDE.md.`
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/resolve-project.test.js`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add hooks/resolve-project.js tests/resolve-project.test.js
git commit -m "feat: add project resolution module for SessionStart hook"
```

### Task 3: Create the context loader module

**Files:**
- Create: `hooks/load-context.js`
- Create: `tests/load-context.test.js`

This module loads project context (index, devlog, tasks) and formats it for injection.

- [ ] **Step 1: Write failing tests for context loading**

Create `tests/load-context.test.js`:

```javascript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { loadProjectContext } from "../hooks/load-context.js";

describe("loadProjectContext", () => {
  let tmpDir;
  let vaultPath;
  const projectPath = "01-Projects/MyApp";

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pkm-ctx-"));
    vaultPath = path.join(tmpDir, "vault");
    const projectDir = path.join(vaultPath, projectPath);

    // Create project structure
    await fs.mkdir(path.join(projectDir, "development"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "tasks"), { recursive: true });

    // _index.md
    await fs.writeFile(
      path.join(projectDir, "_index.md"),
      "---\ntype: project\nstatus: active\ncreated: 2026-01-01\ntags: [project]\n---\n\n# MyApp\n\nA test project."
    );

    // devlog.md with 4 sections (should return last 3)
    await fs.writeFile(
      path.join(projectDir, "development", "devlog.md"),
      "---\ntype: devlog\ncreated: 2026-01-01\ntags: [devlog]\n---\n\n# Devlog\n\n## 2026-01-01\nOld entry.\n\n## 2026-02-01\nMiddle entry.\n\n## 2026-03-01\nRecent entry.\n\n## 2026-03-15\nLatest entry.\n"
    );

    // Active task
    await fs.writeFile(
      path.join(projectDir, "tasks", "add-auth.md"),
      "---\ntype: task\nstatus: active\npriority: high\ncreated: 2026-03-10\ntags: [task]\n---\n\n# Add Authentication\n\nImplement OAuth2 flow.\nSecond line of description."
    );

    // Done task (should NOT be included)
    await fs.writeFile(
      path.join(projectDir, "tasks", "setup-ci.md"),
      "---\ntype: task\nstatus: done\npriority: normal\ncreated: 2026-02-01\ntags: [task]\n---\n\n# Setup CI\n\nDone."
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads full project context", async () => {
    const ctx = await loadProjectContext(vaultPath, projectPath);
    assert.ok(ctx.includes("## PKM Project Context: MyApp"));
    assert.ok(ctx.includes("A test project."));
    assert.ok(ctx.includes("Latest entry."));
    assert.ok(ctx.includes("Add Authentication"));
    assert.ok(ctx.includes("high"));
    assert.ok(!ctx.includes("Setup CI")); // done task excluded
  });

  it("returns last 3 devlog sections", async () => {
    const ctx = await loadProjectContext(vaultPath, projectPath);
    assert.ok(!ctx.includes("Old entry.")); // 4th from end, excluded
    assert.ok(ctx.includes("Middle entry."));
    assert.ok(ctx.includes("Recent entry."));
    assert.ok(ctx.includes("Latest entry."));
  });

  it("handles missing _index.md gracefully", async () => {
    await fs.rm(path.join(vaultPath, projectPath, "_index.md"));
    const ctx = await loadProjectContext(vaultPath, projectPath);
    assert.ok(ctx.includes("## PKM Project Context: MyApp"));
    assert.ok(ctx.includes("Latest entry.")); // devlog still works
  });

  it("handles missing devlog gracefully", async () => {
    await fs.rm(path.join(vaultPath, projectPath, "development", "devlog.md"));
    const ctx = await loadProjectContext(vaultPath, projectPath);
    assert.ok(ctx.includes("A test project.")); // index still works
  });

  it("shows 'No active tasks' when none exist", async () => {
    await fs.rm(path.join(vaultPath, projectPath, "tasks"), { recursive: true });
    const ctx = await loadProjectContext(vaultPath, projectPath);
    assert.ok(ctx.includes("No active tasks"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/load-context.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement loadProjectContext**

Create `hooks/load-context.js`:

```javascript
import fs from "fs/promises";
import path from "path";
import { extractFrontmatter } from "../utils.js";
import { extractTailSections } from "../helpers.js";

/**
 * Load project context for SessionStart injection.
 *
 * Reads: _index.md, last 3 devlog sections, active/pending tasks.
 * Gracefully skips any missing files.
 *
 * @param {string} vaultPath - absolute path to vault root
 * @param {string} projectPath - relative path to project (e.g., "01-Projects/MyApp")
 * @returns {string} formatted context text
 */
export async function loadProjectContext(vaultPath, projectPath) {
  const projectName = path.basename(projectPath);
  const projectDir = path.join(vaultPath, projectPath);
  const sections = [];

  sections.push(`## PKM Project Context: ${projectName}`);

  // 1. _index.md
  try {
    const indexContent = await fs.readFile(path.join(projectDir, "_index.md"), "utf-8");
    sections.push(`### Project Index\n${indexContent}`);
  } catch {
    // Missing — skip
  }

  // 2. Devlog (last 3 ## sections)
  try {
    const devlogContent = await fs.readFile(
      path.join(projectDir, "development", "devlog.md"),
      "utf-8"
    );
    const tailSections = extractTailSections(devlogContent, 3, 2);
    sections.push(`### Recent Development Activity\n${tailSections}`);
  } catch {
    // Missing — skip
  }

  // 3. Active tasks
  const tasks = [];
  try {
    const taskDir = path.join(projectDir, "tasks");
    const entries = await fs.readdir(taskDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const content = await fs.readFile(path.join(taskDir, entry), "utf-8");
      const fm = extractFrontmatter(content);
      if (!fm || (fm.status !== "active" && fm.status !== "pending")) continue;

      // Extract title (first # heading) and first 2 lines of body
      const bodyStart = content.indexOf("\n---", 3);
      const body = bodyStart !== -1 ? content.slice(bodyStart + 4).trim() : content;
      const lines = body.split("\n");
      const titleLine = lines.find(l => l.startsWith("# "));
      const title = titleLine ? titleLine.slice(2).trim() : entry.replace(".md", "");
      const descLines = lines
        .filter(l => l.trim() && !l.startsWith("#"))
        .slice(0, 2)
        .map(l => `  ${l.trim()}`)
        .join("\n");

      tasks.push(`- ${title} (status: ${fm.status}, priority: ${fm.priority || "normal"})\n${descLines}`);
    }
  } catch {
    // Missing tasks dir — skip
  }

  if (tasks.length > 0) {
    sections.push(`### Active Tasks\n${tasks.join("\n")}`);
  } else {
    sections.push("### Active Tasks\nNo active tasks");
  }

  return sections.join("\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/load-context.test.js`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add hooks/load-context.js tests/load-context.test.js
git commit -m "feat: add context loader module for SessionStart hook"
```

### Task 4: Create the SessionStart hook entry point

**Files:**
- Create: `hooks/session-start.js`

This is the actual script that Claude Code's SessionStart hook invokes. It reads JSON from stdin, calls resolveProject + loadProjectContext, and outputs the hook response JSON to stdout.

- [ ] **Step 1: Implement session-start.js**

Create `hooks/session-start.js`:

```javascript
#!/usr/bin/env node

/**
 * SessionStart hook for Claude Code.
 *
 * Resolves cwd → vault project, loads project context,
 * and outputs it as additionalContext for injection into Claude's context.
 *
 * Triggered on: startup, clear, compact
 * Not triggered on: resume
 *
 * Input: JSON from stdin with { cwd, source, session_id, ... }
 * Output: JSON to stdout with { hookSpecificOutput: { hookEventName, additionalContext } }
 *
 * Exit codes:
 *   0 — success (JSON parsed from stdout)
 *   non-zero — non-blocking error (session continues without context)
 */

import { resolveProject } from "./resolve-project.js";
import { loadProjectContext } from "./load-context.js";

const VAULT_PATH = process.env.VAULT_PATH;

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
    // Can't parse input — output plain text context (SessionStart supports this)
    console.log("PKM hook error: could not parse hook input JSON.");
    process.exit(0);
  }

  const { cwd } = input;

  if (!VAULT_PATH) {
    const output = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "PKM hook warning: VAULT_PATH environment variable not set. Vault context unavailable."
      }
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  // Resolve project
  const { projectPath, error } = await resolveProject(cwd, VAULT_PATH);

  if (error) {
    const output = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `PKM: ${error}`
      }
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  // Load context
  const context = await loadProjectContext(VAULT_PATH, projectPath);

  const output = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context
    }
  };
  console.log(JSON.stringify(output));
}

main().catch((err) => {
  console.error(`PKM SessionStart hook error: ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x hooks/session-start.js`

- [ ] **Step 3: Manual smoke test**

Run: `echo '{"cwd":"/home/adrian/Projects/Obsidian-MCP","source":"startup","session_id":"test-123"}' | VAULT_PATH="$HOME/Documents/PKM" node hooks/session-start.js | python3 -m json.tool`

Expected: JSON output with `hookSpecificOutput.additionalContext` containing Obsidian-MCP project context.

- [ ] **Step 4: Commit**

```bash
git add hooks/session-start.js
git commit -m "feat: add SessionStart hook entry point"
```

### Task 5: Add vault_capture MCP tool

**Files:**
- Modify: `index.js:347` (add tool definition)
- Modify: `handlers.js:851-870` (add handler + Map entry)

- [ ] **Step 1: Add vault_capture tool definition to index.js**

In `index.js`, add the `vault_capture` tool definition after `vault_move` (after line 347, before the closing `];`):

```javascript
    {
      name: "vault_capture",
      description: "Signal that something is worth capturing in the PKM vault. " +
        "Returns immediately — a background agent handles the actual note creation. " +
        "Use this when you identify a decision, task, or research finding worth preserving.",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["adr", "task", "research", "bug"],
            description: "The type of capture: adr (decision), task, research (finding/pattern), bug (issue/fix)"
          },
          title: {
            type: "string",
            description: "Brief descriptive title (e.g., 'Use sqlite-vec over Chroma')"
          },
          content: {
            type: "string",
            description: "The substance of the capture — context, rationale, details. 1-5 sentences."
          },
          priority: {
            type: "string",
            enum: ["low", "normal", "high", "urgent"],
            description: "Priority level (tasks only, default: normal)"
          },
          project: {
            type: "string",
            description: "Project name for vault routing (e.g., 'Obsidian-MCP'). If omitted, inferred from session context."
          }
        },
        required: ["type", "title", "content"]
      }
    },
```

- [ ] **Step 2: Add vault_capture handler to handlers.js**

In `handlers.js`, add the handler function **inside** the `createHandlers` function, before the `return new Map([` line (before line 851). All handlers are closures inside `createHandlers`, though `handleCapture` doesn't need any closure variables:

```javascript
  async function handleCapture(args) {
    const { type, title } = args;
    return {
      content: [{
        type: "text",
        text: `Capture queued: [${type}] ${title}`
      }]
    };
  }
```

Add to the handler Map (insert before the closing `]);`):

```javascript
    ["vault_capture", handleCapture],
```

- [ ] **Step 3: Run existing tests to verify no regression**

Run: `npm test`
Expected: All existing tests PASS

- [ ] **Step 4: Run lint to verify no issues**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add index.js handlers.js
git commit -m "feat: add vault_capture MCP tool (lightweight signal for hook system)"
```

### Task 5b: Add vault_capture unit test

**Files:**
- Create: `tests/capture.test.js`

- [ ] **Step 1: Write tests for vault_capture handler**

Create `tests/capture.test.js`:

```javascript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createHandlers } from "../handlers.js";

describe("vault_capture handler", () => {
  let tmpDir;
  let handlers;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pkm-cap-"));
    const vaultPath = path.join(tmpDir, "vault");
    await fs.mkdir(path.join(vaultPath, "05-Templates"), { recursive: true });
    // Minimal template so createHandlers doesn't fail
    await fs.writeFile(
      path.join(vaultPath, "05-Templates", "adr.md"),
      "---\ntype: adr\ncreated: <% tp.date.now(\"YYYY-MM-DD\") %>\ntags: []\n---\n# <% tp.file.title %>"
    );
    const { loadTemplates } = await import("../helpers.js");
    const templateRegistry = await loadTemplates(vaultPath);
    handlers = await createHandlers({
      vaultPath,
      templateRegistry,
      semanticIndex: null,
      activityLog: null,
      sessionId: "test-session"
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns queued acknowledgment with type and title", async () => {
    const handler = handlers.get("vault_capture");
    const result = await handler({
      type: "adr",
      title: "Test Decision",
      content: "We decided to test."
    });
    assert.equal(result.content[0].type, "text");
    assert.ok(result.content[0].text.includes("[adr]"));
    assert.ok(result.content[0].text.includes("Test Decision"));
    assert.ok(result.content[0].text.includes("Capture queued"));
  });

  it("includes type in response for all capture types", async () => {
    const handler = handlers.get("vault_capture");
    for (const type of ["adr", "task", "research", "bug"]) {
      const result = await handler({ type, title: "T", content: "C" });
      assert.ok(result.content[0].text.includes(`[${type}]`));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test tests/capture.test.js`
Expected: All 2 tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/capture.test.js
git commit -m "test: add vault_capture handler unit tests"
```

---

## Chunk 3: Hook Configuration + Setup Documentation

### Task 6: Create the hook configuration and setup docs

**Files:**
- Create: `hooks/README.md`

- [ ] **Step 1: Create hooks/README.md with setup instructions**

Create `hooks/README.md`:

```markdown
# PKM Hook System Setup

## Prerequisites

- Claude Code with hooks support
- Obsidian-MCP server configured in `~/.claude/settings.json`
- `VAULT_PATH` environment variable set in your MCP server config

## Installation

Add the following to your `~/.claude/settings.json` under the `hooks` key.

**Important:** Replace `/home/adrian/Projects/Obsidian-MCP` with the actual path to your Obsidian-MCP installation.

### SessionStart Hook (Project Context Loader)

Automatically loads PKM project context when you start a session. Matches your
repo's directory name to a vault project in `01-Projects/`.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "VAULT_PATH=\"/path/to/your/vault\" node /path/to/Obsidian-MCP/hooks/session-start.js",
            "timeout": 15,
            "statusMessage": "Loading PKM project context..."
          }
        ]
      }
    ]
  }
}
```

### Stop Hook (Passive Capture Sweep)

Runs after each Claude response to capture decisions, tasks, and findings.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "agent",
            "model": "claude-sonnet-4-6",
            "async": true,
            "timeout": 120,
            "prompt": "... (see full prompt in the spec: docs/superpowers/specs/2026-03-17-pkm-hook-system-design.md, or copy from Task 7 Step 1 in this plan)"
          }
        ]
      }
    ]
  }
}
```

### PostToolUse Hook (Explicit Capture Agent)

Runs when Claude calls `vault_capture` to create structured vault notes.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__obsidian-pkm__vault_capture",
        "hooks": [
          {
            "type": "agent",
            "model": "claude-opus-4-6",
            "async": true,
            "timeout": 120,
            "prompt": "... (see full prompt in the spec: docs/superpowers/specs/2026-03-17-pkm-hook-system-design.md, or copy from Task 7 Step 1 in this plan)"
          }
        ]
      }
    ]
  }
}
```

## Project Matching

The SessionStart hook resolves your `cwd` to a vault project:

1. **Basename match:** `basename(cwd)` matched against `01-Projects/` folders (case-insensitive)
2. **CLAUDE.md annotation:** Add `# PKM: 01-Projects/YourProject` to your project's CLAUDE.md
3. **Error:** Shows a warning if neither matches

## Troubleshooting

- **No context loaded:** Check that `VAULT_PATH` is set correctly in the hook command
- **Hook not firing:** Verify with `/hooks` command in Claude Code
- **Agent hook errors:** Run Claude Code with `--debug hooks` for detailed logs
```

- [ ] **Step 2: Commit**

```bash
git add hooks/README.md
git commit -m "docs: add hook system setup instructions"
```

### Task 7: Configure the production hooks

**Files:**
- Modify: `~/.claude/settings.json` (add hooks configuration)

- [ ] **Step 1: Add SessionStart hook to settings.json**

Add the SessionStart hook configuration. The full Stop and PostToolUse agent prompts come from the spec (lines 331 and 345). Add the hooks key to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "VAULT_PATH=\"/home/adrian/Documents/PKM\" node /home/adrian/Projects/Obsidian-MCP/hooks/session-start.js",
            "timeout": 15,
            "statusMessage": "Loading PKM project context..."
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "agent",
            "model": "claude-sonnet-4-6",
            "async": true,
            "timeout": 120,
            "prompt": "You are a PKM passive capture agent. Your job is to identify decisions, task changes, and research findings from the most recent conversation exchange and append them to the vault staging inbox.\n\n## Hook Input\n\nThe hook input JSON is: $ARGUMENTS\n\nExtract `transcript_path` and `session_id` from this JSON.\n\n## Transcript Processing\n\nUse the Read tool to read the transcript JSONL file at `transcript_path`. Find the LAST user message and LAST assistant message at the end of the file — these are the current exchange. One exchange = one contiguous user message + one contiguous assistant response (the last complete turn pair in the JSONL). All prior messages are historical context only. Do NOT capture anything from prior messages.\n\n## What to Capture\n\n1. **Decisions**: Technical or architectural choices that were AGREED upon (not proposed, not still being discussed)\n2. **Task changes**: New tasks identified, tasks completed, priority changes, blockers discovered\n3. **Research findings**: Patterns discovered, library behaviors documented, gotchas found\n\n## Noise Suppression\n\nBe conservative. Skip: trivial exchanges, clarification Q&A that hasn't resolved, implementation details obvious from code, anything restating existing project context. When in doubt, don't capture.\n\n## Deduplication\n\nIf the assistant message in the current exchange contains a vault_capture tool call, the content of that capture is already being handled by the explicit capture agent. Do NOT also capture it in the staging inbox — skip it to avoid semantic duplication.\n\n## Output\n\nIf you find PKM-worthy content, use vault_append to add entries to 00-Inbox/captures-{today's date YYYY-MM-DD}.md. If the file doesn't exist, create it first with vault_write (template: fleeting-note, tags: [capture, auto]). Each entry format:\n\n## HH:MM — {Category}: {Title}\n\n{1-3 sentence description}\n\n**Source:** {project name from cwd}, session {first 8 chars of session_id}\n\n---\n\nIf nothing is PKM-worthy, do nothing."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "mcp__obsidian-pkm__vault_capture",
        "hooks": [
          {
            "type": "agent",
            "model": "claude-opus-4-6",
            "async": true,
            "timeout": 120,
            "prompt": "You are a PKM note creation agent. A Claude Code session has explicitly signaled that something is worth capturing.\n\n## Hook Input\n\nThe hook input JSON is: $ARGUMENTS\n\nExtract `tool_input` from this JSON. It contains: type, title, content, and optionally priority and project.\n\n## Instructions\n\nUsing the vault tools available to you, create a properly structured vault note:\n\n- **adr**: vault_write with template 'adr'. Path: 01-Projects/{project}/development/decisions/ADR-NNN-{kebab-title}.md. List existing ADRs with vault_list to determine next number. Expand content into Context, Decision, Consequences sections.\n- **task**: First vault_query to check for existing task with similar title. If exists, vault_update_frontmatter to update. If not, vault_write with template 'task'. Path: 01-Projects/{project}/tasks/{kebab-title}.md.\n- **research**: vault_write with template 'research-note'. Path: 01-Projects/{project}/research/{kebab-title}.md.\n- **bug**: vault_write with template 'troubleshooting-log'. Path: 01-Projects/{project}/development/debug/{kebab-title}.md.\n\nIf project is not specified in tool_input, check vault_activity recent entries to infer the active project.\n\nAlways verify the note was created successfully. If vault_write fails (e.g., file exists), adapt — use vault_append or choose a different filename."
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Verify hooks are recognized**

Start a new Claude Code session and run `/hooks` to verify all three hooks appear.

- [ ] **Step 3: Commit settings (if tracked)**

Settings.json is user-specific and not tracked in git. No commit needed.

---

## Chunk 4: Integration Testing + CLAUDE.md Update

### Task 8: Integration test — SessionStart

- [ ] **Step 1: Test SessionStart in a real session**

Start a new Claude Code session in `/home/adrian/Projects/Obsidian-MCP`. Verify:
- The status message "Loading PKM project context..." appears briefly
- Claude's first response acknowledges having project context (e.g., ask "What project am I working on?" — Claude should know without calling any tools)

- [ ] **Step 2: Test SessionStart with an unknown project**

Start a Claude Code session in a directory that doesn't match any vault project (e.g., `/tmp`). Verify:
- Claude receives the error message about no vault project found

### Task 9: Integration test — vault_capture + PostToolUse

- [ ] **Step 1: Test vault_capture tool call**

In a session, ask Claude to call vault_capture:

```
Please call vault_capture with type "research", title "Agent hooks validation", content "Claude Code agent hooks support async: true, MCP tool access via inherited config, and $ARGUMENTS placeholder for hook input injection."
```

Verify:
- Claude receives immediate "Capture queued" response
- Claude is NOT blocked waiting for the background agent
- After ~30-60 seconds, check the vault for a new research note at `01-Projects/Obsidian-MCP/research/agent-hooks-validation.md`

### Task 10: Integration test — Deduplication

- [ ] **Step 1: Test that vault_capture content is not duplicated by passive sweep**

In a session, explicitly call `vault_capture` for a decision, then check that the Stop sweep's staging inbox (`00-Inbox/captures-*.md`) does NOT contain the same decision. The Opus agent creates the structured note; the Sonnet sweep should skip it.

Verify:
- The structured note exists in the project folder (created by Opus)
- The staging inbox either doesn't exist or doesn't contain an entry about the same topic

### Task 11: Integration test — Stop passive sweep

- [ ] **Step 1: Test passive capture**

In a session, have a conversation where a clear decision is made. For example:

```
User: "Should we use Hono or Express for the HTTP sidecar?"
Claude: "Let's use Hono — it's lighter weight and already in our dependency tree."
User: "Agreed, let's go with Hono."
```

After ~30-60 seconds, check `00-Inbox/captures-2026-03-17.md` in the vault. Verify:
- The capture file exists
- It contains an entry about the Hono decision
- The entry has the correct format (timestamp, category, title, description, source)

### Task 12: Update CLAUDE.md with PKM hooks instructions

**Files:**
- Modify: `~/.claude/CLAUDE.md`

- [ ] **Step 1: Add PKM Hooks section to global CLAUDE.md**

Add the following section to `~/.claude/CLAUDE.md` under the "Plugins & Integrations" section, before the Obsidian PKM subsection:

```markdown
### PKM Hooks (Automatic Context)

PKM project context is automatically loaded at session start via hooks. You do not need to manually call vault_read for _index.md, devlog, or active tasks — this is already in your context.

A passive sweep agent runs after each response to capture implicit decisions, tasks, and findings. You do not need to remember to update the devlog or capture notes manually for routine discoveries.

**When to use `vault_capture`:** Call this tool when you are confident something is PKM-worthy and want it created as a proper structured note (ADR, task, research note, or bug report). The tool returns immediately — a background Opus agent handles the actual note creation. Use this for:
- Significant decisions agreed upon with the user
- New tasks or task completions that should be tracked
- Research findings that will be useful in future sessions
- Bug investigations worth documenting

**When NOT to use `vault_capture`:** Don't use it for minor observations, incremental progress, or things already captured by the passive sweep. The passive sweep handles routine captures — `vault_capture` is for explicitly important items.

**You can still call all vault tools directly** (vault_write, vault_append, etc.) when you need precise control over note creation, editing, or querying.
```

- [ ] **Step 2: No git commit needed**

The CLAUDE.md update is to the user's global config (`~/.claude/CLAUDE.md`), which is not tracked in the repo. All repo changes were already committed in their respective tasks.
