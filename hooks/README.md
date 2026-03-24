# PKM Hook System

Claude Code hooks that enable automatic knowledge capture during coding sessions.

## Overview

The hook system consists of three hooks:

| Hook | Event | Purpose |
|------|-------|---------|
| `session-start.js` | SessionStart | Loads project context from the vault at the start of each session |
| `stop-sweep.js` | Stop | PKM librarian: creates structured, graph-linked vault notes from the latest exchange |
| `capture-handler.sh` | PostToolUse | Explicit capture: creates structured vault notes when `vault_capture` is called |

### How it works

- **SessionStart** (`session-start.js`): Runs synchronously. Resolves the current working directory to a vault project, reads the project index, recent devlog entries, and active tasks, then injects them as context.
- **Stop** (`stop-sweep.js`): Runs asynchronously after each assistant response. Resolves the current working directory to a vault project (no project = no captures). Spawns a background `claude -p` (Sonnet, 15 turns) that reads the transcript, classifies PKM-worthy content from the latest exchange, and creates properly structured vault notes in the project directory with wikilinks to related notes.
- **PostToolUse** (`capture-handler.sh`): Runs asynchronously after `vault_capture` tool use. Spawns a background `claude -p` (Opus, 30 turns) that creates a properly structured vault note (ADR, task, research note, or troubleshooting log) from the capture payload with graph links.

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
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "VAULT_PATH=\"/path/to/your/vault\" node /path/to/obsidian-pkm-plugin/hooks/stop-sweep.js",
            "async": true,
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "mcp__obsidian-pkm__vault_capture",
        "hooks": [
          {
            "type": "command",
            "command": "VAULT_PATH=\"/path/to/your/vault\" /path/to/obsidian-pkm-plugin/hooks/capture-handler.sh",
            "async": true,
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Replace `/path/to/your/vault` with the absolute path to your Obsidian vault (e.g., `~/Documents/PKM`), and `/path/to/obsidian-pkm-plugin` with the absolute path to this repository.

## Architecture Notes

### Command hooks with background subprocesses

The hook system uses `type: "command"` hooks (not `type: "agent"`). The shell scripts themselves exit quickly (within the configured timeout), but they spawn `claude -p` as a detached background process via `nohup ... &`. This means:

- The hook script exits immediately, satisfying the timeout constraint
- The `claude -p` process continues running independently, doing the actual vault work
- `--max-turns` limits how many tool calls the background process can make (15 for stop-sweep, 30 for capture-handler)

### MCP config resolution

The hook scripts resolve their own location to construct the path to `index.js`. `stop-sweep.js` uses the ES module pattern (`import.meta.url` → `fileURLToPath` → `path.dirname`), while `capture-handler.sh` uses the POSIX pattern (`cd "$(dirname "$0")" && pwd -P`). Both work regardless of current working directory. The `VAULT_PATH` environment variable must be set in the hook command because hook scripts run outside the MCP server process.

### Async behavior

Both `stop-sweep.js` and `capture-handler.sh` use `async: true` in the hook config. This means Claude Code does not wait for the hook script to finish before continuing. The script starts, spawns the background `claude -p` process, and exits. The background process runs to completion on its own.

### Noise suppression and deduplication

The stop-sweep hook is conservative by design. It only looks at the last exchange (one user message + one assistant response) and skips trivial interactions. Deduplication is item-level: if the exchange contains a `vault_capture` call, the sweep reads its arguments and skips that specific item, but still captures other PKM-worthy content. The sweep also runs `vault_search` before creating notes to catch duplicates from concurrent sweep instances.

## Troubleshooting

### Hook not firing

- Verify the hook config is valid JSON in `~/.claude/settings.json`
- Check that the `matcher` pattern matches (SessionStart uses `"startup|clear|compact"`, PostToolUse uses the full MCP tool name)
- Ensure the script paths are absolute

### Script errors

- Check that `VAULT_PATH` is set correctly and the directory exists
- Verify `node` is available in the hook's PATH
- Test the script manually: `echo '{"cwd":"/tmp","transcript_path":"/tmp/test","session_id":"abc123"}' | VAULT_PATH="/path/to/vault" node ./hooks/stop-sweep.js`

### Background process not running

- Check for `claude` CLI in PATH
- Look for `claude -p` processes: `ps aux | grep 'claude -p'`
- Test `claude -p` directly: `echo "say hello" | claude -p --model sonnet`
- Check logs in `$VAULT_PATH/.obsidian/hook-logs/` for background process output

### macOS compatibility

The scripts use POSIX-compatible `cd "$(dirname "$0")" && pwd -P` for path resolution, so they work on both Linux and macOS without additional dependencies.
