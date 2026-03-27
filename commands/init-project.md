---
name: init-project
description: Configure this project for Obsidian PKM — connects the repo to a vault project folder and writes CLAUDE.md integration directives
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, mcp__plugin_obsidian-pkm_obsidian-pkm__vault_list, mcp__plugin_obsidian-pkm_obsidian-pkm__vault_write, mcp__plugin_obsidian-pkm_obsidian-pkm__vault_peek]
---

# Initialize Project for Obsidian PKM

You are configuring this code repository for Obsidian PKM integration. Walk the user through these steps.

## Step 1: Detect Vault Project Path

Determine which vault project folder corresponds to this repository.

1. Get the current working directory name (the repo folder name)
2. Use `vault_list` to check if a matching folder exists in `01-Projects/`:
   ```
   vault_list({ path: "01-Projects" })
   ```
3. Look for a case-insensitive basename match between the CWD and the `01-Projects/` entries

**If a match is found**, proceed to Step 2 with the detected path.

**If no match is found**, ask the user:
> "I couldn't find a matching project folder in your vault. What's the vault project path? (e.g., `01-Projects/MyApp`)"

## Step 2: Confirm with User

Present the detected (or provided) path and ask for confirmation:
> "I found `01-Projects/<name>/` in your vault. Is this the right project for this repository?"

If the user corrects the path, use their provided path instead.

## Step 3: Scaffold Vault Folder (if needed)

Use `vault_list` to check if the confirmed path exists in the vault.

**If the folder doesn't exist**, ask:
> "The folder `01-Projects/<name>/` doesn't exist in your vault yet. Want me to create it with a project index?"

If yes:
1. Create the project index:
   ```
   vault_write({
     template: "project-index",
     path: "01-Projects/<name>/_index.md",
     frontmatter: { tags: ["project"], status: "active" }
   })
   ```
2. Subdirectories (`development/decisions/`, `development/debug/`, `research/`, `tasks/`, `planning/`) will be created automatically when notes are first written to them (`vault_write` has `createDirs: true` by default). Inform the user of this.

If no, proceed without scaffolding.

## Step 4: Write CLAUDE.md

Read the existing CLAUDE.md in the current working directory (using the Read tool). If no CLAUDE.md exists, you will create one.

### 4a: Add/update `# PKM:` annotation

The annotation must be on its own line at the top of the file, before any other content:

```
# PKM: 01-Projects/<name>
```

- If the file already has a `# PKM:` line (regex: `/^#\s+PKM:\s*.+$/m`), replace it with the correct path
- If not, prepend it to the file with a blank line after it

### 4b: Add/update `## PKM Integration` section

The section content (substitute the actual project path):

```
## PKM Integration

- **Vault project**: `01-Projects/<name>/`
- **MCP Server**: `obsidian-pkm` plugin

Document decisions, research findings, and debugging sessions as you work. The `knowledge-sweeper` agent captures PKM-worthy content in the background, or use the `obsidian-pkm:pkm-write` skill for structured notes with linking.

Use `obsidian-pkm:pkm-explore` to research what the vault already knows about a topic before creating new content.

At the end of each session, run `obsidian-pkm:pkm-session-end` to update the devlog and capture undocumented work.
```

**If `## PKM Integration` already exists**: replace everything from `## PKM Integration` up to (but not including) the next `## ` heading or end of file. This makes re-runs idempotent.

**If `## PKM Integration` does not exist**: append the section at the end of the file.

## Step 5: Confirm

Tell the user:

> "Done! Your project is connected to the vault at `01-Projects/<name>/`."
>
> The obsidian-pkm plugin will now:
> - Load project context automatically at session start
> - Capture decisions, tasks, and research in the background
> - Document session progress when you run `pkm-session-end`
>
> **Restart your Claude Code session** for the SessionStart hook to pick up the new CLAUDE.md configuration.
