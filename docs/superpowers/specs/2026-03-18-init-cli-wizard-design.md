# pkm-mcp-server init — End-to-End Onboarding Wizard

## Overview

A CLI wizard that bootstraps a vault and registers the MCP server with Claude Code in a single interactive session. This is the primary onboarding entry point — it replaces the current multi-step manual setup (copy templates, create folders, hand-edit JSON) with guided prompts.

The wizard is always interactive. Every step that modifies something shows what it will do and asks for confirmation before acting. Nothing is automatic; nothing is forced.

## Architecture

### New Files

**`cli.js`** — New bin entry point (~20 lines). Reads `process.argv[2]`:
- `init` → imports and calls `runInit()` from `init.js`
- No subcommand → imports and calls `startServer()` from `index.js` (MCP server)
- Future: `status`, `register` subcommands can be added here

**`init.js`** — Wizard logic. Exports:
- `runInit()` — orchestrates the interactive flow using `@inquirer/prompts`
- Pure helper functions (for unit testing without prompts):
  - `resolveInputPath(raw)` — expand `~`, `$HOME`, resolve to absolute
  - `copyTemplates(src, dest, mode)` — copy full/minimal/skip; returns `{created, skipped}`
  - `scaffoldFolders(vaultPath)` — create PARA folders + stubs; returns `{created, skipped}`
  - `backupVault(vaultPath)` — copy to timestamped backup; returns backup path
  - `updateSettingsJson(settingsPath, config)` — read → merge → atomic write; returns updated config

**`templates/note.md`** — Minimal generic template for the "minimal only" option:
```markdown
---
type: note
created: <% tp.date.now("YYYY-MM-DD") %>
tags: []
---

# <% tp.file.title %>
```

### Modified Files

**`index.js`** — Wrap all code in an exported `startServer()` function so nothing executes on import. Specifically:
- All module-level declarations (`VAULT_PATH`, `templateRegistry`, `templateDescriptions`, `semanticIndex`, `activityLog`, `SESSION_ID`, `handlers`, `server`) become local variables inside `startServer()`. Note: `shuttingDown` (used by the `shutdown()` inner function) must also move inside.
- The `server.setRequestHandler(...)` registrations move inside `startServer()`
- `initializeServer()` and `shutdown()` become inner functions of `startServer()`
- Signal handlers (`process.on("SIGINT", ...)`, `process.on("SIGTERM", ...)`) register inside `startServer()`
- The top-level `initializeServer().catch(...)` call is removed; `startServer()` calls it internally
- Static imports (`@modelcontextprotocol/sdk`, `crypto`, `os`, etc.) stay at module level (they're side-effect-free)
- `createRequire(import.meta.url)` and `const { version: PKG_VERSION } = require("./package.json")` also stay at module level (side-effect-free, needed by `startServer()` for the `Server(...)` constructor)
- Remove the `#!/usr/bin/env node` shebang (no longer a bin entry point; `cli.js` has the shebang now)
- The file exports only: `export async function startServer() { ... }`

**`package.json`**:
- `bin`: `"pkm-mcp-server": "cli.js"` (was `index.js`)
- `main`: `"cli.js"` (was `index.js`)
- `exports`: `{ ".": "./cli.js" }` (was `./index.js`)
- `scripts.start`: `"node cli.js"` (was `node index.js`)
- `dependencies`: add `"@inquirer/prompts": "^7.0.0"` (or latest stable)
- `files`: no change needed — the existing `"*.js"` glob already catches `cli.js` and `init.js`, and `"templates/"` already catches `note.md`

### Untouched Files

`handlers.js`, `helpers.js`, `graph.js`, `activity.js`, `embeddings.js`, `utils.js`, `eslint.config.js` — no changes.

### Dependency

`@inquirer/prompts` — the official modular successor to `inquirer`. ESM-native, tree-shakeable. We use: `input`, `password`, `confirm`, `select`. Lightweight dependency tree (small internal packages like `@inquirer/core`, `ansi-escapes`, `strip-ansi`).

## Wizard Flow

### Step 1 — Welcome

Print:
```
pkm-mcp-server setup wizard

This will walk you through setting up your Obsidian vault for use with the
PKM MCP server. You'll be asked about 5 things:

  1. Where your vault is (or where to create one)
  2. Whether to install note templates
  3. Whether to set up the recommended folder structure
  4. An optional OpenAI API key for semantic search
  5. Registering the server with Claude Code

Nothing is written until you confirm each step. Press Ctrl+C at any time to cancel.
```

### Step 2 — Vault Path

**Prompt**: "Do you have an existing Obsidian vault you'd like to use?"

If **yes**: prompt for the path to the existing vault.
If **no**: prompt for where to create a new vault (suggest `~/Documents/PKM`).

**Path input handling** (`resolveInputPath`):
- Empty string (user presses Enter without typing): use the suggested default path (e.g., `~/Documents/PKM`); the `input` prompt is configured with a `default` value
- `~` and `~/...` → `os.homedir()` expansion
- `$HOME` and `${HOME}` → environment variable expansion
- Relative paths → resolved to absolute via `path.resolve()`
- Trailing slashes stripped
- Double slashes normalised
- Result shown back as resolved absolute path before any action

**Path validation matrix**:

| Scenario | Action |
|---|---|
| Path doesn't exist | Show resolved path. "This directory doesn't exist. Create it?" Confirm (catches typos). |
| Path exists, is a file | Error: "That's a file, not a directory. Please enter a directory path." Re-prompt. |
| Path exists, empty directory | Confirm: "Use `<path>` as your vault?" |
| Path exists, non-empty, user said they HAVE a vault | Confirm: "Use `<path>` as your vault?" Then offer backup. |
| Path exists, non-empty, user said they DON'T have a vault | 3-way select: (1) "Actually, treat this as my vault" (2) "Create a new vault folder inside it" → prompt for subfolder name (3) "Wipe it and start fresh" → see Wipe flow below |

**Wipe flow** (triple confirmation):
1. First confirm: "This will permanently delete everything in `<path>`. Are you sure?"
2. Second confirm: "This cannot be undone. Type the folder name to confirm:" (user must type the exact folder basename)
3. Third confirm: "Last chance. Delete all contents of `<path>`? (yes/no)"
4. Implementation: recursively remove all contents of the directory (`fs.rm` with `recursive: true` on each child entry), leaving the directory itself. Never `rm -rf` the directory itself (the user specified it as their vault location).

**Backup** (offered when working with non-empty directory):
- Prompt: "Back up your vault before making changes? (Recommended)"
- Copies entire directory using `fs.cp(src, dest, { recursive: true })` (stable in Node 20+, matches engine requirement). Includes `.obsidian/`, `.trash/`, and all hidden files. Symlinks are preserved (not dereferenced) via the default `fs.cp` behavior.
- For large vaults: checks total size via recursive `fs.stat` walk (summing `stat.size` for files, skipping symlinks) and warns if >500MB (e.g., "Your vault is 1.2GB. Backup may take a moment.")
- Prints backup path after completion
- If backup fails: abort wizard entirely ("Backup failed: <error>. Aborting to keep your data safe.")

### Step 3 — Templates

**Prompt** (select):
```
Install note templates? These are used by the vault_write tool to create
structured notes with proper frontmatter.

  > Full set (recommended) — 13 templates for projects, research, decisions, tasks, and more
    Minimal — A single generic note template (you can add your own later)
    Skip — No templates (vault_write won't work until you add templates manually)
```

**Full set**: Copy all files from bundled `templates/` directory (13 files, including the new `note.md`) to `<vault>/05-Templates/`. Skip files that already exist. Print summary: `Created: 13` or `Created: 9, Skipped: 4 (already exist)`.

**Minimal**: Copy only `templates/note.md` to `<vault>/05-Templates/note.md`. Same skip-if-exists logic.

**Skip**: Print warning: "Note: vault_write requires at least one template in 05-Templates/ to function. All other tools work without templates."

### Step 4 — Folder Structure

**Prompt**: "Set up the recommended folder structure? This creates top-level folders for organising your notes."

If **yes**, show what will be created:
```
Will create:
  00-Inbox/          — Quick captures and unsorted notes
  01-Projects/       — Active project folders
  02-Areas/          — Ongoing areas of responsibility
  03-Resources/      — Reference material and reusable knowledge
  04-Archive/        — Completed or inactive items
  05-Templates/      — Note templates
  06-System/         — System configuration and metadata
```

The `05-Templates/` line is shown conditionally: if templates were already installed in Step 3, show "(already set up)"; if not, include it in the creation list. Each folder gets a brief `_index.md` with frontmatter and a one-line description. Skip folders and `_index.md` files that already exist. Print summary.

**`_index.md` stub format** (consistent with the project's "never create notes without frontmatter" rule):
```markdown
---
type: moc
created: 2026-03-18
tags:
  - index
---

# Inbox

Quick captures and unsorted notes.
```

The `type` is `moc` (Map of Content) since these are structural index files. The title and description vary per folder.

If **no**: skip. Note that if the user chose templates in Step 3, `05-Templates/` was already created implicitly by that step.

### Step 5 — OpenAI API Key (Optional)

**Prompt**: "Enable semantic search? This lets you find conceptually related notes even when they use different words. It requires an OpenAI API key."

If **yes**:
```
Get an API key at: https://platform.openai.com/api-keys

This key is stored only in your local Claude Code settings file
(~/.claude/settings.json) and is never sent to us or anyone else.
It's used solely for generating text embeddings via OpenAI's API.
```

Password input (masked). User can press Enter to skip if they change their mind.

If **no**: skip. Print: "You can add this later by setting OPENAI_API_KEY in your Claude Code settings."

### Step 6 — Claude Code Registration

**Detection**: Check if `~/.claude/settings.json` exists and whether it already contains an `mcpServers.obsidian-pkm` entry.

**If already registered**: "Claude Code is already configured for pkm-mcp-server." Then ask: "Overwrite the existing configuration?" (default: No). If the user declines, skip registration.

**If not registered**: Show the exact JSON block that will be added:
```
The following will be added to ~/.claude/settings.json:

{
  "mcpServers": {
    "obsidian-pkm": {
      "command": "npx",
      "args": ["-y", "pkm-mcp-server"],
      "env": {
        "VAULT_PATH": "/resolved/path/to/vault",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}

This only adds the "obsidian-pkm" key under "mcpServers".
No other settings will be changed.
```

Confirm before writing. `OPENAI_API_KEY` is only included if the user provided one in step 5.

**settings.json handling** (`updateSettingsJson`):
1. Create `~/.claude/` directory if it doesn't exist (`fs.mkdir` with `{ recursive: true }`)
2. Read existing `settings.json`, or start with `{}` if it doesn't exist
3. If file exists but isn't valid JSON: warn the user, show the raw content, and offer to skip registration (don't corrupt the file)
4. Deep-merge: set `config.mcpServers = config.mcpServers || {}`, then set `config.mcpServers["obsidian-pkm"]` to the new block
5. Serialize with `JSON.stringify(config, null, 2)`. Note: this re-formats the file with 2-space indentation. Any custom formatting or key ordering in the original file will not be preserved. This is standard for machine-edited JSON and matches how Claude Code itself writes settings.
6. Write atomically: write to `settings.json.tmp`, then `fs.rename()` to `settings.json`

**Installation detection for registration**: The registration block detects whether the user installed from npm or from source (by checking if the running script is inside a `node_modules` directory or a global npm prefix). For npm installs: `"command": "npx", "args": ["-y", "pkm-mcp-server"]`. For source installs: `"command": "node", "args": ["/absolute/path/to/cli.js"]`.

### Step 7 — Summary

```
Setup complete!

  Vault:      /home/user/Documents/PKM
  Templates:  13 installed in 05-Templates/
  Folders:    7 created (00-Inbox through 06-System)
  Semantic:   Enabled (API key configured)
  Claude Code: Registered in ~/.claude/settings.json

To verify, restart Claude Code and try:
  "List the folders in my vault"

Claude should call vault_list and show your vault's directory structure.
If that doesn't work, check: https://github.com/AdrianV101/Obsidian-MCP#troubleshooting
```

Adjust lines based on what was actually done (skip lines for steps the user skipped).

## Error Handling

- **User-friendly messages**: All filesystem and JSON errors are caught and presented as plain English. No raw stack traces.
- **Backup failure aborts**: If backup is requested and fails, the wizard stops immediately. Never proceed with modifications if the safety net failed.
- **Atomic settings write**: Write to `.tmp` then rename. Never write directly to `settings.json`.
- **Malformed settings.json**: Warn and offer to skip registration. Never silently corrupt.
- **Path safety**: If the resolved path looks like a system directory (e.g., `/`, `/home`, `/usr`), warn before proceeding.
- **Ctrl+C handling**: `@inquirer/prompts` throws on Ctrl+C. Catch at the top level and print: "Setup cancelled. Nothing was changed." Exit cleanly.
- **Permissions**: If any write operation fails with EACCES, print a clear message about directory permissions.

## Testing

Pure helper functions are unit-tested following the existing project pattern (`node:test`, `assert/strict`, temp dirs):

| Function | Test coverage |
|---|---|
| `resolveInputPath(raw)` | `~` expansion, `$HOME` expansion, relative paths, trailing slashes, double slashes |
| `copyTemplates(src, dest, mode)` | Full set, minimal, skip; fresh dir, existing files (skip logic), missing source |
| `scaffoldFolders(vaultPath)` | Fresh dir, existing folders (skip logic), existing `_index.md` files |
| `backupVault(vaultPath)` | Successful backup, source doesn't exist, permissions error |
| `updateSettingsJson(path, config)` | New file, existing file with other settings, existing obsidian-pkm entry, malformed JSON, missing directory |

The wizard orchestration (`runInit`) is tested manually — it's thin glue over the helpers + prompts.

Test file: `tests/init.test.js`

## CLI Integration

### `cli.js` structure

```javascript
#!/usr/bin/env node

const subcommand = process.argv[2];

if (subcommand === "init") {
  const { runInit } = await import("./init.js");
  await runInit();
} else if (subcommand === "--version" || subcommand === "-v") {
  const { createRequire } = await import("module");
  const { version } = createRequire(import.meta.url)("./package.json");
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

Unknown subcommands print a usage message and exit with code 1, rather than silently falling through to the MCP server.

Dynamic imports ensure the MCP server modules (heavy: `better-sqlite3`, `sqlite-vec`) are not loaded when running `init`. The wizard only needs `fs`, `path`, `os`, and `@inquirer/prompts`.

### `index.js` refactor

The current `index.js` has module-level declarations (lines 23-38: `VAULT_PATH`, `templateRegistry`, `semanticIndex`, `activityLog`, `SESSION_ID`, `handlers`, `server`), `server.setRequestHandler(...)` registrations, `initializeServer()`, `shutdown()`, signal handlers, and a top-level `initializeServer().catch(...)` call.

All of these move inside a single exported function:

```javascript
// Static imports stay at module level (side-effect-free)
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
// ... other imports ...

// Side-effect-free setup stays at module level
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("./package.json");

export async function startServer() {
  const VAULT_PATH = process.env.VAULT_PATH || (os.homedir() + "/Documents/PKM");
  let templateRegistry = new Map();
  // ... other declarations ...
  const server = new Server(...);

  server.setRequestHandler(ListToolsRequestSchema, async () => { ... });
  server.setRequestHandler(CallToolRequestSchema, async (request) => { ... });

  async function initializeServer() { ... }
  async function shutdown() { ... }

  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());

  await initializeServer();
}
```

When `cli.js` does `import("./index.js")`, nothing executes. `startServer()` must be called explicitly.

## Future Extensibility

`cli.js` is designed to grow:
- `pkm-mcp-server status` — health check (separate pending task)
- `pkm-mcp-server register` — standalone registration (subsumed by init for new users, but useful for re-registration)
- `pkm-mcp-server --version` / `pkm-mcp-server --help` — standard CLI flags

These are out of scope for this spec but the architecture supports them trivially.
