# PKM Hook System

Claude Code hook that loads project context from the vault at the start of each session.

## Overview

The hook system consists of one hook:

| Hook | Event | Purpose |
|------|-------|---------|
| `session-start.js` | SessionStart | Loads project context from the vault at the start of each session |

### How it works

- **SessionStart** (`session-start.js`): Runs synchronously at session start, clear, or compact. Resolves the current working directory to a vault project, reads the project index, recent devlog entries, and active tasks, then injects them as context into the session.

Passive knowledge capture (decisions, research findings, tasks, bug root causes) is handled by the **knowledge-sweeper** and **devlog-updater** canonical agents, which can be invoked directly or run in the background after significant work blocks.

## Setup

### Prerequisites

- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) installed and authenticated
- This repository cloned locally
- An Obsidian vault following the [vault structure convention](../CLAUDE.md#vault-structure-convention)

### Configuration

Add the following to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "VAULT_PATH=\"/path/to/your/vault\" node /path/to/obsidian-pkm-plugin/hooks/session-start.js",
            "timeout": 15,
            "statusMessage": "Loading PKM project context..."
          }
        ]
      }
    ]
  }
}
```

Replace `/path/to/your/vault` with the absolute path to your Obsidian vault (e.g., `~/Documents/PKM`), and `/path/to/obsidian-pkm-plugin` with the absolute path to this repository.

## Architecture Notes

### Command hook

The hook system uses a `type: "command"` hook that runs synchronously. `session-start.js` reads vault files directly and writes the context to stdout, which Claude Code injects into the session. It exits cleanly within the configured timeout.

### MCP config resolution

`session-start.js` imports its helper modules (`resolve-project.js`, `load-context.js`) using relative paths from the same directory. The `VAULT_PATH` environment variable must be set in the hook command because the hook script runs outside the MCP server process.

### Helper modules

`load-context.js` and `resolve-project.js` are shared helpers used by `session-start.js`:

- **`resolve-project.js`**: Maps the current working directory to a vault project path by reading the `# PKM:` annotation from the repo's `CLAUDE.md`
- **`load-context.js`**: Reads the project index, recent devlog entries, and active tasks from the vault and formats them as a context block

## Troubleshooting

### Hook not firing

- Verify the hook config is valid JSON in `~/.claude/settings.json`
- Check that the `matcher` pattern matches (`"startup|clear|compact"`)
- Ensure the script path is absolute

### Script errors

- Check that `VAULT_PATH` is set correctly and the directory exists
- Verify `node` is available in the hook's PATH
- Test the script manually: `echo '{"cwd":"/tmp","transcript_path":"/tmp/test","session_id":"abc123"}' | VAULT_PATH="/path/to/vault" node ./hooks/session-start.js`

### macOS compatibility

The scripts use standard ES module patterns for path resolution, so they work on both Linux and macOS without additional dependencies.
