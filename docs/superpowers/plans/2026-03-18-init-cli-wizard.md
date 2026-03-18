# Init CLI Wizard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `pkm-mcp-server init` wizard that walks users through vault setup and Claude Code registration in a single interactive session.

**Architecture:** New `cli.js` bin dispatcher routes `init` to `init.js` wizard or falls through to `index.js` MCP server (refactored to export `startServer()`). Pure helper functions in `init.js` are unit-tested independently of the interactive prompts.

**Tech Stack:** Node.js ES modules, `@inquirer/prompts` for interactive prompts, `node:test` for testing.

**Spec:** `docs/superpowers/specs/2026-03-18-init-cli-wizard-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `cli.js` | Create | Bin entry point. Routes subcommands (`init`, `--version`) or starts MCP server. |
| `init.js` | Create | Wizard orchestration (`runInit`) + pure helper functions for each wizard step. |
| `templates/note.md` | Create | Minimal generic note template for the "minimal only" wizard option. |
| `index.js` | Modify | Wrap all code in `export async function startServer()`. Remove shebang. |
| `package.json` | Modify | Update `bin`, `main`, `exports`, `scripts.start`. Add `@inquirer/prompts`. |
| `tests/init.test.js` | Create | Unit tests for all pure helper functions in `init.js`. |

---

### Task 1: Refactor `index.js` to export `startServer()`

This is the prerequisite for everything else. The MCP server must work identically after this refactor.

**Files:**
- Modify: `index.js` (entire file)

- [ ] **Step 1: Read the full `index.js` and understand the structure**

Current structure:
- Lines 1-16: shebang + static imports
- Lines 18-20: `createRequire` + `PKG_VERSION` (side-effect-free)
- Lines 22-37: module-level mutable state (`VAULT_PATH`, `templateRegistry`, `templateDescriptions`, `semanticIndex`, `activityLog`, `SESSION_ID`, `handlers`, `server`)
- Lines 39-43: `new Server(...)` construction
- Lines 45-416: `server.setRequestHandler(ListToolsRequestSchema, ...)`
- Lines 418-439: `server.setRequestHandler(CallToolRequestSchema, ...)`
- Lines 441-503: `initializeServer()` function
- Lines 505-524: `shuttingDown` + `shutdown()` function
- Lines 526-527: signal handlers
- Lines 529-532: top-level `initializeServer().catch(...)`

- [ ] **Step 2: Wrap everything in `startServer()` and export it**

Remove the shebang (`#!/usr/bin/env node`). Keep static imports and `createRequire`/`PKG_VERSION` at module level. Move everything else (lines 22-532) inside:

```javascript
export async function startServer() {
  // Get vault path from environment
  const VAULT_PATH = process.env.VAULT_PATH || (os.homedir() + "/Documents/PKM");

  // Template registry (populated at startup)
  let templateRegistry = new Map();
  let templateDescriptions = "";

  // Semantic index (populated at startup if OPENAI_API_KEY is set)
  let semanticIndex = null;

  // Activity log (populated at startup)
  let activityLog = null;
  const SESSION_ID = crypto.randomUUID();

  // Handler map (populated at startup)
  let handlers;

  // Create the server
  const server = new Server(
    { name: "pkm-mcp-server", version: PKG_VERSION },
    { capabilities: { tools: {} } }
  );

  // ... existing setRequestHandler blocks, unchanged ...

  async function initializeServer() {
    // ... existing code, unchanged ...
  }

  let shuttingDown = false;

  async function shutdown() {
    // ... existing code, unchanged ...
  }

  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());

  initializeServer().catch(err => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
```

- [ ] **Step 3: Verify the existing test suite still passes**

Run: `npm test`
Expected: All 408+ tests pass. This refactor is purely structural — no logic changed.

- [ ] **Step 4: Verify the MCP server starts correctly**

Run: `VAULT_PATH=/tmp/test-vault node -e "import('./index.js').then(m => m.startServer())"`
Expected: Server starts (or errors about vault path, which confirms `startServer()` was called).

- [ ] **Step 5: Run linter**

Run: `npm run lint`
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add index.js
git commit -m "refactor: wrap index.js in exported startServer() for CLI dispatcher"
```

---

### Task 2: Create `cli.js` and update `package.json`

**Files:**
- Create: `cli.js`
- Modify: `package.json`

- [ ] **Step 1: Install `@inquirer/prompts`**

Run: `npm install @inquirer/prompts`

- [ ] **Step 2: Create `cli.js`**

```javascript
#!/usr/bin/env node

import { createRequire } from "module";

const subcommand = process.argv[2];

if (subcommand === "init") {
  const { runInit } = await import("./init.js");
  await runInit();
} else if (subcommand === "--version" || subcommand === "-v") {
  const require = createRequire(import.meta.url);
  const { version } = require("./package.json");
  console.log(`pkm-mcp-server v${version}`);
} else if (!subcommand) {
  const { startServer } = await import("./index.js");
  await startServer();
} else {
  console.error(`Unknown command: ${subcommand}`);
  console.error("Usage: pkm-mcp-server [init]");
  process.exit(1);
}
```

- [ ] **Step 3: Update `package.json`**

Change these fields:
```json
{
  "main": "cli.js",
  "exports": { ".": "./cli.js" },
  "bin": { "pkm-mcp-server": "cli.js" },
  "scripts": {
    "start": "node cli.js"
  }
}
```

- [ ] **Step 4: Verify MCP server starts via `cli.js`**

Run: `VAULT_PATH=/tmp/test-vault node cli.js`
Expected: Server starts (same as before, just routed through `cli.js`).

- [ ] **Step 5: Verify `--version` works**

Run: `node cli.js --version`
Expected: `pkm-mcp-server v1.2.1` (or current version).

- [ ] **Step 6: Verify unknown subcommand errors**

Run: `node cli.js foobar`
Expected: `Unknown command: foobar` + usage message, exit code 1.

- [ ] **Step 7: Run full test suite and linter**

Run: `npm test && npm run lint`
Expected: All tests pass, lint clean.

- [ ] **Step 8: Commit**

```bash
git add cli.js package.json package-lock.json
git commit -m "feat: add cli.js dispatcher with init/version subcommands"
```

---

### Task 3: Create `templates/note.md` (minimal generic template)

**Files:**
- Create: `templates/note.md`

- [ ] **Step 1: Create the minimal template**

```markdown
---
type: note
created: <% tp.date.now("YYYY-MM-DD") %>
tags: []
---

# <% tp.file.title %>
```

- [ ] **Step 2: Verify the MCP server picks it up**

Run: `VAULT_PATH=<your-vault> node cli.js` and confirm template list includes `note`.
Or check with a quick script:
```bash
node -e "import('./helpers.js').then(async m => { const r = await m.loadTemplates('<vault-path>'); console.log([...r.keys()]); })"
```
Expected: `note` appears in the template list alongside the existing 12.

- [ ] **Step 3: Commit**

```bash
git add templates/note.md
git commit -m "feat: add minimal generic note template for init wizard"
```

---

### Task 4: Implement `resolveInputPath` helper + tests

**Files:**
- Create: `init.js` (start with this one function + export)
- Create: `tests/init.test.js`

- [ ] **Step 1: Write failing tests for `resolveInputPath`**

```javascript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import { resolveInputPath } from "../init.js";

describe("resolveInputPath", () => {
  it("expands ~ to home directory", () => {
    assert.equal(resolveInputPath("~/Documents/PKM"), path.join(os.homedir(), "Documents/PKM"));
  });

  it("expands lone ~", () => {
    assert.equal(resolveInputPath("~"), os.homedir());
  });

  it("expands $HOME", () => {
    assert.equal(resolveInputPath("$HOME/vault"), path.join(os.homedir(), "vault"));
  });

  it("expands ${HOME}", () => {
    assert.equal(resolveInputPath("${HOME}/vault"), path.join(os.homedir(), "vault"));
  });

  it("resolves relative paths to absolute", () => {
    const result = resolveInputPath("my/vault");
    assert.ok(path.isAbsolute(result));
    assert.ok(result.endsWith("my/vault"));
  });

  it("strips trailing slashes", () => {
    const result = resolveInputPath("/tmp/vault/");
    assert.equal(result, "/tmp/vault");
  });

  it("normalises double slashes", () => {
    const result = resolveInputPath("/tmp//vault///notes");
    assert.equal(result, "/tmp/vault/notes");
  });

  it("handles absolute paths unchanged (except normalisation)", () => {
    assert.equal(resolveInputPath("/tmp/vault"), "/tmp/vault");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/init.test.js`
Expected: FAIL — `init.js` doesn't exist yet.

- [ ] **Step 3: Implement `resolveInputPath` in `init.js`**

```javascript
import os from "os";
import path from "path";

/**
 * Resolve user-provided path input: expand ~, $HOME, resolve relative, normalise.
 */
export function resolveInputPath(raw) {
  let p = raw;

  // Expand ~ at start
  if (p === "~") {
    p = os.homedir();
  } else if (p.startsWith("~/")) {
    p = path.join(os.homedir(), p.slice(2));
  }

  // Expand $HOME and ${HOME}
  p = p.replace(/\$\{HOME\}/g, os.homedir());
  p = p.replace(/\$HOME/g, os.homedir());

  // Resolve to absolute
  p = path.resolve(p);

  // Normalise (path.resolve already handles double slashes and trailing slashes)
  // But strip any remaining trailing slash (path.resolve keeps root /)
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }

  return p;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/init.test.js`
Expected: All 8 tests PASS.

- [ ] **Step 5: Run linter**

Run: `npm run lint`
Expected: Clean. (May need to add `tests/` glob if eslint config doesn't already cover it — it does per memory: `eslint *.js tests/`.)

- [ ] **Step 6: Commit**

```bash
git add init.js tests/init.test.js
git commit -m "feat(init): add resolveInputPath helper with tests"
```

---

### Task 5: Implement `copyTemplates` helper + tests

**Files:**
- Modify: `init.js`
- Modify: `tests/init.test.js`

- [ ] **Step 1: Write failing tests for `copyTemplates`**

```javascript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { copyTemplates } from "../init.js";

describe("copyTemplates", () => {
  let tmpDir, srcDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-test-"));
    srcDir = path.join(tmpDir, "src-templates");
    await fs.mkdir(srcDir);
    // Create 3 fake templates
    await fs.writeFile(path.join(srcDir, "adr.md"), "# ADR");
    await fs.writeFile(path.join(srcDir, "task.md"), "# Task");
    await fs.writeFile(path.join(srcDir, "note.md"), "# Note");
  });

  it("copies all templates in full mode", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    const result = await copyTemplates(srcDir, dest, "full");
    assert.equal(result.created, 3);
    assert.equal(result.skipped, 0);
    const files = await fs.readdir(dest);
    assert.equal(files.length, 3);
  });

  it("copies only note.md in minimal mode", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    const result = await copyTemplates(srcDir, dest, "minimal");
    assert.equal(result.created, 1);
    assert.equal(result.skipped, 0);
    const files = await fs.readdir(dest);
    assert.deepEqual(files, ["note.md"]);
  });

  it("returns zeros in skip mode", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    const result = await copyTemplates(srcDir, dest, "skip");
    assert.equal(result.created, 0);
    assert.equal(result.skipped, 0);
    // Directory should not exist
    await assert.rejects(fs.access(dest), { code: "ENOENT" });
  });

  it("skips files that already exist", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, "adr.md"), "# Existing ADR");
    const result = await copyTemplates(srcDir, dest, "full");
    assert.equal(result.created, 2);
    assert.equal(result.skipped, 1);
    // Existing file should NOT be overwritten
    const content = await fs.readFile(path.join(dest, "adr.md"), "utf8");
    assert.equal(content, "# Existing ADR");
  });

  it("creates destination directory if it doesn't exist", async () => {
    const dest = path.join(tmpDir, "deep", "nested", "05-Templates");
    const result = await copyTemplates(srcDir, dest, "full");
    assert.equal(result.created, 3);
  });

  it("throws if source directory does not exist", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    await assert.rejects(
      copyTemplates("/nonexistent/templates", dest, "full"),
      (err) => err.code === "ENOENT"
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/init.test.js`
Expected: FAIL — `copyTemplates` not exported from `init.js`.

- [ ] **Step 3: Implement `copyTemplates`**

Add to `init.js`:

```javascript
import fs from "fs/promises";

/**
 * Copy templates from src to dest directory.
 * @param {string} src - Source templates directory (bundled)
 * @param {string} dest - Destination 05-Templates/ directory in vault
 * @param {"full"|"minimal"|"skip"} mode
 * @returns {Promise<{created: number, skipped: number}>}
 */
export async function copyTemplates(src, dest, mode) {
  if (mode === "skip") return { created: 0, skipped: 0 };

  await fs.mkdir(dest, { recursive: true });

  const files = mode === "minimal"
    ? ["note.md"]
    : await fs.readdir(src);

  let created = 0, skipped = 0;

  for (const file of files) {
    const destFile = path.join(dest, file);
    try {
      await fs.access(destFile);
      skipped++;
    } catch {
      await fs.copyFile(path.join(src, file), destFile);
      created++;
    }
  }

  return { created, skipped };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/init.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add init.js tests/init.test.js
git commit -m "feat(init): add copyTemplates helper with tests"
```

---

### Task 6: Implement `scaffoldFolders` helper + tests

**Files:**
- Modify: `init.js`
- Modify: `tests/init.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
describe("scaffoldFolders", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-scaffold-"));
  });

  it("creates all 7 PARA folders with _index.md stubs", async () => {
    const result = await scaffoldFolders(tmpDir);
    assert.equal(result.created, 7);
    assert.equal(result.skipped, 0);
    const dirs = await fs.readdir(tmpDir);
    assert.ok(dirs.includes("00-Inbox"));
    assert.ok(dirs.includes("06-System"));
    // Check _index.md has frontmatter
    const content = await fs.readFile(path.join(tmpDir, "00-Inbox", "_index.md"), "utf8");
    assert.ok(content.includes("type: moc"));
    assert.ok(content.includes("tags:"));
    assert.ok(content.includes("# Inbox"));
  });

  it("creates _index.md in existing folders that lack one", async () => {
    // Folder exists but has no _index.md
    await fs.mkdir(path.join(tmpDir, "00-Inbox"), { recursive: true });
    const result = await scaffoldFolders(tmpDir);
    // created/skipped counts _index.md files only (folders are created idempotently via mkdir recursive)
    assert.equal(result.created, 7); // All 7 _index.md files created (including for existing 00-Inbox)
    assert.equal(result.skipped, 0);
    const indexContent = await fs.readFile(path.join(tmpDir, "00-Inbox", "_index.md"), "utf8");
    assert.ok(indexContent.includes("type: moc"));
  });

  it("skips existing _index.md files without overwriting", async () => {
    await fs.mkdir(path.join(tmpDir, "00-Inbox"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "00-Inbox", "_index.md"), "# My custom index");
    const result = await scaffoldFolders(tmpDir);
    assert.ok(result.skipped >= 1);
    const content = await fs.readFile(path.join(tmpDir, "00-Inbox", "_index.md"), "utf8");
    assert.equal(content, "# My custom index"); // Not overwritten
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/init.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `scaffoldFolders`**

Add to `init.js`:

```javascript
const PARA_FOLDERS = [
  { name: "00-Inbox", title: "Inbox", desc: "Quick captures and unsorted notes." },
  { name: "01-Projects", title: "Projects", desc: "Active project folders." },
  { name: "02-Areas", title: "Areas", desc: "Ongoing areas of responsibility." },
  { name: "03-Resources", title: "Resources", desc: "Reference material and reusable knowledge." },
  { name: "04-Archive", title: "Archive", desc: "Completed or inactive items." },
  { name: "05-Templates", title: "Templates", desc: "Note templates for vault_write." },
  { name: "06-System", title: "System", desc: "System configuration and metadata." },
];

function makeIndexStub(title, desc) {
  const today = new Date().toISOString().split("T")[0];
  return `---\ntype: moc\ncreated: ${today}\ntags:\n  - index\n---\n\n# ${title}\n\n${desc}\n`;
}

/**
 * Create PARA folder structure with _index.md stubs.
 * @param {string} vaultPath
 * @returns {Promise<{created: number, skipped: number}>}
 */
export async function scaffoldFolders(vaultPath) {
  let created = 0, skipped = 0;

  for (const folder of PARA_FOLDERS) {
    const dirPath = path.join(vaultPath, folder.name);
    await fs.mkdir(dirPath, { recursive: true });

    const indexPath = path.join(dirPath, "_index.md");
    try {
      await fs.access(indexPath);
      skipped++;
    } catch {
      await fs.writeFile(indexPath, makeIndexStub(folder.title, folder.desc));
      created++;
    }
  }

  return { created, skipped };
}
```

Also export `PARA_FOLDERS` for test assertions if needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/init.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add init.js tests/init.test.js
git commit -m "feat(init): add scaffoldFolders helper with tests"
```

---

### Task 7: Implement `backupVault` helper + tests

**Files:**
- Modify: `init.js`
- Modify: `tests/init.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
describe("backupVault", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-backup-"));
    // Create some files in the vault
    await fs.writeFile(path.join(tmpDir, "note.md"), "# Hello");
    await fs.mkdir(path.join(tmpDir, "subdir"));
    await fs.writeFile(path.join(tmpDir, "subdir", "deep.md"), "# Deep");
  });

  it("copies vault to timestamped backup directory", async () => {
    const backupPath = await backupVault(tmpDir);
    assert.ok(backupPath.includes("-backup-"));
    const content = await fs.readFile(path.join(backupPath, "note.md"), "utf8");
    assert.equal(content, "# Hello");
    const deepContent = await fs.readFile(path.join(backupPath, "subdir", "deep.md"), "utf8");
    assert.equal(deepContent, "# Deep");
  });

  it("does not modify the original vault", async () => {
    await backupVault(tmpDir);
    const content = await fs.readFile(path.join(tmpDir, "note.md"), "utf8");
    assert.equal(content, "# Hello");
  });

  it("throws if source does not exist", async () => {
    await assert.rejects(
      backupVault("/nonexistent/path/vault"),
      (err) => err.code === "ENOENT" || err.message.includes("ENOENT")
    );
  });

  it("throws on permissions error", async () => {
    // Create a directory that can't be read
    const noReadDir = path.join(tmpDir, "no-read");
    await fs.mkdir(noReadDir);
    await fs.writeFile(path.join(noReadDir, "file.md"), "test");
    await fs.chmod(noReadDir, 0o000);
    await assert.rejects(
      backupVault(noReadDir),
      (err) => err.code === "EACCES" || err.code === "EPERM"
    );
    // Restore permissions for cleanup
    await fs.chmod(noReadDir, 0o755);
  });
});

describe("dirSize", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-dirsize-"));
  });

  it("sums file sizes in a directory", async () => {
    await fs.writeFile(path.join(tmpDir, "a.txt"), "hello"); // 5 bytes
    await fs.writeFile(path.join(tmpDir, "b.txt"), "world!"); // 6 bytes
    const size = await dirSize(tmpDir);
    assert.equal(size, 11);
  });

  it("recurses into subdirectories", async () => {
    await fs.mkdir(path.join(tmpDir, "sub"));
    await fs.writeFile(path.join(tmpDir, "a.txt"), "hi"); // 2 bytes
    await fs.writeFile(path.join(tmpDir, "sub", "b.txt"), "hey"); // 3 bytes
    const size = await dirSize(tmpDir);
    assert.equal(size, 5);
  });

  it("returns 0 for empty directory", async () => {
    const size = await dirSize(tmpDir);
    assert.equal(size, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/init.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `backupVault`**

Add to `init.js`:

```javascript
/**
 * Back up a vault directory to a timestamped sibling directory.
 * @param {string} vaultPath
 * @returns {Promise<string>} Path to the backup directory.
 */
export async function backupVault(vaultPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = `${vaultPath}-backup-${timestamp}`;
  await fs.cp(vaultPath, backupPath, { recursive: true });
  return backupPath;
}

/**
 * Calculate total size of a directory (in bytes). Skips symlinks.
 * @param {string} dirPath
 * @returns {Promise<number>}
 */
export async function dirSize(dirPath) {
  let total = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(fullPath);
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath);
      total += stat.size;
    }
  }
  return total;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/init.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add init.js tests/init.test.js
git commit -m "feat(init): add backupVault and dirSize helpers with tests"
```

---

### Task 8: Implement `updateSettingsJson` helper + tests

**Files:**
- Modify: `init.js`
- Modify: `tests/init.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
describe("updateSettingsJson", () => {
  let tmpDir, settingsPath;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-settings-"));
    settingsPath = path.join(tmpDir, "settings.json");
  });

  it("creates settings.json if it does not exist", async () => {
    const config = { command: "npx", args: ["-y", "pkm-mcp-server"], env: { VAULT_PATH: "/v" } };
    const result = await updateSettingsJson(settingsPath, config);
    assert.deepEqual(result.mcpServers["obsidian-pkm"], config);
    const written = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    assert.deepEqual(written.mcpServers["obsidian-pkm"], config);
  });

  it("merges into existing settings without overwriting other keys", async () => {
    await fs.writeFile(settingsPath, JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" } } }, null, 2));
    const config = { command: "npx", args: ["-y", "pkm-mcp-server"], env: {} };
    const result = await updateSettingsJson(settingsPath, config);
    assert.equal(result.theme, "dark");
    assert.deepEqual(result.mcpServers.other, { command: "x" });
    assert.deepEqual(result.mcpServers["obsidian-pkm"], config);
  });

  it("creates parent directory if it does not exist", async () => {
    const deepPath = path.join(tmpDir, "sub", "dir", "settings.json");
    const config = { command: "npx", args: [], env: {} };
    await updateSettingsJson(deepPath, config);
    const written = JSON.parse(await fs.readFile(deepPath, "utf8"));
    assert.ok(written.mcpServers["obsidian-pkm"]);
  });

  it("throws on malformed JSON", async () => {
    await fs.writeFile(settingsPath, "{ not valid json");
    const config = { command: "npx", args: [], env: {} };
    await assert.rejects(
      updateSettingsJson(settingsPath, config),
      (err) => err.message.includes("not valid JSON")
    );
  });

  it("overwrites existing obsidian-pkm entry", async () => {
    await fs.writeFile(settingsPath, JSON.stringify({
      mcpServers: { "obsidian-pkm": { command: "old" } }
    }, null, 2));
    const config = { command: "new", args: [], env: {} };
    const result = await updateSettingsJson(settingsPath, config);
    assert.equal(result.mcpServers["obsidian-pkm"].command, "new");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/init.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `updateSettingsJson`**

Add to `init.js`:

```javascript
/**
 * Read/merge/write settings.json atomically.
 * @param {string} settingsPath - Absolute path to settings.json
 * @param {object} serverConfig - The obsidian-pkm server config block
 * @returns {Promise<object>} The full merged config object
 */
export async function updateSettingsJson(settingsPath, serverConfig) {
  // Create parent directory
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });

  // Read existing or start fresh
  let config = {};
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    try {
      config = JSON.parse(raw);
    } catch {
      throw new Error(`${settingsPath} is not valid JSON. Please fix it manually or delete it to start fresh.`);
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    // File doesn't exist — start with {}
  }

  // Merge
  config.mcpServers = config.mcpServers || {};
  config.mcpServers["obsidian-pkm"] = serverConfig;

  // Atomic write
  const tmpPath = settingsPath + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2) + "\n");
  await fs.rename(tmpPath, settingsPath);

  return config;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/init.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Run linter**

Run: `npm run lint`
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add init.js tests/init.test.js
git commit -m "feat(init): add updateSettingsJson helper with tests"
```

---

### Task 9: Implement `runInit` wizard orchestration

This is the interactive wizard that ties all the helpers together. No unit tests — manual testing only.

**Files:**
- Modify: `init.js`

- [ ] **Step 1: Add `detectInstallType` helper + tests**

Add to `init.js`:

```javascript
import { fileURLToPath } from "url";

/**
 * Detect whether running from npm install or from source.
 * @param {string} filePath - The path to check (defaults to current file for production use)
 * @returns {{ command: string, args: string[] }}
 */
export function detectInstallType(filePath) {
  const thisFile = filePath || fileURLToPath(import.meta.url);
  // If inside node_modules or a global npm prefix, it's an npm install
  if (thisFile.includes("node_modules") || thisFile.includes("/lib/node_modules/")) {
    return { command: "npx", args: ["-y", "pkm-mcp-server"] };
  }
  // Source install — use absolute path to cli.js
  const cliPath = path.join(path.dirname(thisFile), "cli.js");
  return { command: "node", args: [cliPath] };
}
```

Add to `tests/init.test.js`:

```javascript
describe("detectInstallType", () => {
  it("returns npx for a path inside node_modules", () => {
    const result = detectInstallType("/usr/lib/node_modules/pkm-mcp-server/init.js");
    assert.equal(result.command, "npx");
    assert.deepEqual(result.args, ["-y", "pkm-mcp-server"]);
  });

  it("returns node with absolute cli.js path for a source install", () => {
    const result = detectInstallType("/home/user/Projects/Obsidian-MCP/init.js");
    assert.equal(result.command, "node");
    assert.ok(result.args[0].endsWith("cli.js"));
    assert.ok(path.isAbsolute(result.args[0]));
  });
});
```

- [ ] **Step 2: Implement `runInit` — Welcome + Vault Path (Step 1-2)**

```javascript
import { confirm, input, select, password } from "@inquirer/prompts";

export async function runInit() {
  try {
    console.log(`
pkm-mcp-server setup wizard

This will walk you through setting up your Obsidian vault for use with the
PKM MCP server. You'll be asked about 5 things:

  1. Where your vault is (or where to create one)
  2. Whether to install note templates
  3. Whether to set up the recommended folder structure
  4. An optional OpenAI API key for semantic search
  5. Registering the server with Claude Code

Nothing is written until you confirm each step. Press Ctrl+C at any time to cancel.
`);

    // --- Step 2: Vault Path ---
    const hasVault = await confirm({ message: "Do you have an existing Obsidian vault you'd like to use?" });

    const defaultPath = "~/Documents/PKM";
    const rawPath = await input({
      message: hasVault ? "Path to your vault:" : "Where should we create your vault?",
      default: hasVault ? undefined : defaultPath,
    });

    let vaultPath = resolveInputPath(rawPath);
    console.log(`\n  Resolved path: ${vaultPath}\n`);

    // Validate path
    vaultPath = await resolveVaultPath(vaultPath, hasVault);

    // ... remaining steps follow in Step 3-6 below ...
  } catch (e) {
    // @inquirer/prompts throws ExitPromptError on Ctrl+C
    // Verify the exact error class name matches the installed version during implementation
    if (e.name === "ExitPromptError") {
      console.log("\nSetup cancelled. Nothing was changed.");
      process.exit(0);
    }
    console.error(`\nError: ${e.message}`);
    process.exit(1);
  }
}
```

- [ ] **Step 3: Implement vault path validation (`resolveVaultPath` inner function)**

This handles the path validation matrix from the spec: doesn't exist, is a file, empty dir, non-empty dir. Also includes the backup offer and wipe flow.

```javascript
// System directories that should trigger a safety warning
const DANGEROUS_PATHS = new Set(["/", "/home", "/usr", "/var", "/etc", "/tmp", "/opt", "/bin", "/sbin"]);

async function resolveVaultPath(vaultPath, hasVault) {
  // Path safety check
  if (DANGEROUS_PATHS.has(vaultPath) || vaultPath === os.homedir()) {
    console.log(`\n  Warning: ${vaultPath} is a system directory. Using it as a vault could cause problems.\n`);
    const proceed = await confirm({ message: "Are you sure you want to continue with this path?", default: false });
    if (!proceed) { console.log("Setup cancelled."); process.exit(0); }
  }

  let stat;
  try {
    stat = await fs.stat(vaultPath);
  } catch (e) {
    if (e.code === "ENOENT") {
      const create = await confirm({ message: `This directory doesn't exist. Create ${vaultPath}?` });
      if (!create) { console.log("Setup cancelled."); process.exit(0); }
      try {
        await fs.mkdir(vaultPath, { recursive: true });
      } catch (mkdirErr) {
        if (mkdirErr.code === "EACCES") {
          console.error(`\n  Permission denied: cannot create ${vaultPath}`);
          console.error("  Check that you have write permission to the parent directory.\n");
          process.exit(1);
        }
        throw mkdirErr;
      }
      return vaultPath;
    }
    throw e;
  }

  if (!stat.isDirectory()) {
    console.error("  That's a file, not a directory. Please enter a directory path.\n");
    // Re-prompt for a new path
    const rawPath = await input({ message: hasVault ? "Path to your vault:" : "Where should we create your vault?" });
    const newPath = resolveInputPath(rawPath);
    console.log(`\n  Resolved path: ${newPath}\n`);
    return resolveVaultPath(newPath, hasVault);
  }

  const entries = await fs.readdir(vaultPath);
  const isEmpty = entries.length === 0;

  if (isEmpty) {
    const ok = await confirm({ message: `Use ${vaultPath} as your vault?` });
    if (!ok) { console.log("Setup cancelled."); process.exit(0); }
    return vaultPath;
  }

  // Non-empty directory
  if (hasVault) {
    const ok = await confirm({ message: `Use ${vaultPath} as your vault?` });
    if (!ok) { console.log("Setup cancelled."); process.exit(0); }
  } else {
    const choice = await select({
      message: `${vaultPath} is not empty, but you said you don't have a vault. What would you like to do?`,
      choices: [
        { name: "Actually, treat this as my vault", value: "use" },
        { name: "Create a new vault folder inside it", value: "subfolder" },
        { name: "Wipe it and start fresh", value: "wipe" },
      ],
    });

    if (choice === "subfolder") {
      const subName = await input({ message: "Subfolder name:", default: "PKM" });
      vaultPath = path.join(vaultPath, subName);
      await fs.mkdir(vaultPath, { recursive: true });
      return vaultPath;
    }

    if (choice === "wipe") {
      const c1 = await confirm({ message: `This will permanently delete everything in ${vaultPath}. Are you sure?` });
      if (!c1) { console.log("Wipe cancelled."); process.exit(0); }
      const basename = path.basename(vaultPath);
      const typed = await input({ message: `This cannot be undone. Type "${basename}" to confirm:` });
      if (typed !== basename) { console.log("Name didn't match. Wipe cancelled."); process.exit(0); }
      const c3 = await confirm({ message: `Last chance. Delete all contents of ${vaultPath}?` });
      if (!c3) { console.log("Wipe cancelled."); process.exit(0); }
      const children = await fs.readdir(vaultPath);
      for (const child of children) {
        await fs.rm(path.join(vaultPath, child), { recursive: true, force: true });
      }
      console.log("  Contents deleted.\n");
      return vaultPath;
    }
    // choice === "use" — fall through
  }

  // Offer backup for non-empty directories
  const size = await dirSize(vaultPath);
  const sizeMB = (size / 1024 / 1024).toFixed(0);
  const sizeWarning = size > 500 * 1024 * 1024 ? ` (${sizeMB}MB — backup may take a moment)` : "";
  const doBackup = await confirm({ message: `Back up your vault before making changes?${sizeWarning} (Recommended)`, default: true });
  if (doBackup) {
    try {
      const backupPath = await backupVault(vaultPath);
      console.log(`  Backup created: ${backupPath}\n`);
    } catch (e) {
      console.error(`Backup failed: ${e.message}. Aborting to keep your data safe.`);
      process.exit(1);
    }
  }

  return vaultPath;
}
```

- [ ] **Step 4: Implement remaining wizard steps (3-7)**

Add to `runInit()` after the vault path resolution:

```javascript
    // --- Step 3: Templates ---
    const bundledTemplatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "templates");
    const templatesDest = path.join(vaultPath, "05-Templates");

    const templateMode = await select({
      message: "Install note templates? (Used by vault_write to create structured notes)",
      choices: [
        { name: "Full set (recommended) — 13 templates for projects, research, decisions, tasks, and more", value: "full" },
        { name: "Minimal — A single generic note template (you can add your own later)", value: "minimal" },
        { name: "Skip — No templates (vault_write won't work until you add templates manually)", value: "skip" },
      ],
    });

    const templateResult = await copyTemplates(bundledTemplatesDir, templatesDest, templateMode);
    if (templateMode === "skip") {
      console.log("  Skipped. Note: vault_write requires at least one template in 05-Templates/ to function.\n");
    } else {
      console.log(`  Templates: ${templateResult.created} created${templateResult.skipped ? `, ${templateResult.skipped} skipped (already exist)` : ""}.\n`);
    }

    // --- Step 4: Folder Structure ---
    const doScaffold = await confirm({ message: "Set up the recommended folder structure? (Creates top-level folders for organising notes)" });

    let scaffoldResult = { created: 0, skipped: 0 };
    if (doScaffold) {
      // Show preview of what will be created (per spec)
      const templatesAlreadySetUp = templateMode !== "skip";
      console.log("\n  Will create:");
      console.log("    00-Inbox/          — Quick captures and unsorted notes");
      console.log("    01-Projects/       — Active project folders");
      console.log("    02-Areas/          — Ongoing areas of responsibility");
      console.log("    03-Resources/      — Reference material and reusable knowledge");
      console.log("    04-Archive/        — Completed or inactive items");
      console.log(`    05-Templates/      — Note templates${templatesAlreadySetUp ? " (already set up)" : ""}`);
      console.log("    06-System/         — System configuration and metadata\n");

      scaffoldResult = await scaffoldFolders(vaultPath);
      console.log(`  Folders: ${scaffoldResult.created} created${scaffoldResult.skipped ? `, ${scaffoldResult.skipped} skipped (already exist)` : ""}.\n`);
    }

    // --- Step 5: OpenAI API Key ---
    let openaiKey = null;
    const wantSemantic = await confirm({ message: "Enable semantic search? (Requires an OpenAI API key)" });

    if (wantSemantic) {
      console.log(`
  Get an API key at: https://platform.openai.com/api-keys

  This key is stored only in your local Claude Code settings file
  (~/.claude/settings.json) and is never sent to us or anyone else.
  It's used solely for generating text embeddings via OpenAI's API.
`);
      openaiKey = await password({ message: "OpenAI API key (Enter to skip):", mask: "*" });
      if (!openaiKey) {
        openaiKey = null;
        console.log("  Skipped.\n");
      }
    } else {
      console.log("  You can add this later by setting OPENAI_API_KEY in your Claude Code settings.\n");
    }

    // --- Step 6: Claude Code Registration ---
    const homedir = os.homedir();
    const settingsPath = path.join(homedir, ".claude", "settings.json");

    // Check for existing registration
    let alreadyRegistered = false;
    try {
      const raw = await fs.readFile(settingsPath, "utf8");
      const existing = JSON.parse(raw);
      alreadyRegistered = !!existing?.mcpServers?.["obsidian-pkm"];
    } catch { /* doesn't exist or malformed — fine */ }

    let didRegister = false;
    if (alreadyRegistered) {
      const overwrite = await confirm({
        message: "Claude Code is already configured for pkm-mcp-server. Overwrite?",
        default: false,
      });
      if (!overwrite) {
        console.log("  Registration skipped.\n");
      } else {
        didRegister = true;
      }
    } else {
      didRegister = true;
    }

    if (didRegister) {
      const install = detectInstallType();
      const env = { VAULT_PATH: vaultPath };
      if (openaiKey) env.OPENAI_API_KEY = openaiKey;
      const serverConfig = { command: install.command, args: install.args, env };

      console.log(`\n  The following will be added to ${settingsPath}:\n`);
      const preview = { mcpServers: { "obsidian-pkm": serverConfig } };
      console.log("  " + JSON.stringify(preview, null, 2).split("\n").join("\n  "));
      console.log(`\n  This only adds the "obsidian-pkm" key under "mcpServers".`);
      console.log("  No other settings will be changed.\n");

      const doRegister = await confirm({ message: "Write this configuration?" });
      if (doRegister) {
        try {
          await updateSettingsJson(settingsPath, serverConfig);
          console.log("  Registered.\n");
        } catch (e) {
          console.error(`  Registration failed: ${e.message}`);
          console.error("  You can register manually — see: https://github.com/AdrianV101/Obsidian-MCP#quick-start\n");
        }
      } else {
        didRegister = false;
        console.log("  Registration skipped.\n");
      }
    }

    // --- Step 7: Summary ---
    console.log("Setup complete!\n");
    console.log(`  Vault:       ${vaultPath}`);
    if (templateMode !== "skip") {
      console.log(`  Templates:   ${templateResult.created} installed in 05-Templates/`);
    }
    if (doScaffold) {
      console.log(`  Folders:     ${scaffoldResult.created} created`);
    }
    console.log(`  Semantic:    ${openaiKey ? "Enabled (API key configured)" : "Disabled (no API key)"}`);
    console.log(`  Claude Code: ${didRegister ? `Registered in ${settingsPath}` : "Not registered"}`);
    console.log(`
To verify, restart Claude Code and try:
  "List the folders in my vault"

Claude should call vault_list and show your vault's directory structure.
If that doesn't work, check: https://github.com/AdrianV101/Obsidian-MCP#troubleshooting
`);
```

- [ ] **Step 5: Test wizard manually end-to-end**

Run: `node cli.js init`
Walk through the entire wizard with a temp directory. Verify:
- All prompts appear and flow correctly
- Ctrl+C shows "Setup cancelled" at any point
- Templates are copied
- Folders are created
- Settings.json is written correctly
- Summary is accurate

- [ ] **Step 6: Run full test suite and linter**

Run: `npm test && npm run lint`
Expected: All tests pass, lint clean.

- [ ] **Step 7: Commit**

```bash
git add init.js
git commit -m "feat(init): implement interactive wizard orchestration (runInit)"
```

---

### Task 10: Integration verification and final cleanup

**Files:**
- Modify: `tests/init.test.js` (if any edge cases found)
- Possibly: `init.js` (lint fixes, edge cases)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (existing 408+ tests + new init tests).

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: Clean.

- [ ] **Step 3: Test wizard fresh install scenario**

Create a fresh empty temp dir and run through the wizard:
```bash
mkdir /tmp/test-vault-fresh && node cli.js init
```
- Provide the fresh dir path
- Choose "Full set" templates
- Choose "Yes" for scaffold
- Skip OpenAI key
- Register with Claude Code
- Verify the summary

Check the vault directory: templates in `05-Templates/`, all PARA folders with `_index.md` stubs, `~/.claude/settings.json` updated.

- [ ] **Step 4: Test wizard existing vault scenario**

Run wizard pointing at a pre-populated directory:
- Verify backup offer appears
- Verify skip-if-exists for templates and folders
- Verify existing registration detection

- [ ] **Step 5: Test `--version` and unknown subcommand**

Run: `node cli.js --version` → prints version
Run: `node cli.js -v` → prints version
Run: `node cli.js unknown` → prints error + usage

- [ ] **Step 6: Verify MCP server still works via cli.js**

Run: `VAULT_PATH=<valid-vault> node cli.js`
Expected: MCP server starts normally, all tools available.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete pkm-mcp-server init wizard

End-to-end onboarding wizard: vault setup, templates, folder structure,
OpenAI key, and Claude Code registration in a single interactive session."
```
