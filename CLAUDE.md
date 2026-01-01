# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a PKM (Personal Knowledge Management) + Claude Code Integration Starter Kit. It provides an MCP server that enables bidirectional knowledge flow between Claude Code and an Obsidian vault.

## Commands

```bash
# Install dependencies
cd mcp-server && npm install

# Run the MCP server (for testing)
VAULT_PATH="/path/to/your/vault" node mcp-server/index.js

# Start the server (from mcp-server directory)
npm start
```

## Architecture

The project consists of three parts:

**MCP Server** (`mcp-server/index.js`): A Node.js ES module server implementing the Model Context Protocol. It provides 7 tools for vault interaction:
- `vault_read` / `vault_write` / `vault_append` - File operations
- `vault_search` - Full-text search across markdown files
- `vault_list` / `vault_recent` - Directory listing and recent files
- `vault_links` - Wikilink analysis (`[[...]]` syntax)

The server uses `VAULT_PATH` environment variable (defaults to `~/Documents/PKM`) and includes path security to prevent directory escaping.

**Templates** (`templates/`): Obsidian note templates for project documentation:
- `project-index.md` - Project overview with YAML frontmatter
- `adr.md` - Architecture Decision Record format
- `devlog.md` - Development log with session entries
- `permanent-note.md` - Atomic evergreen notes

**Sample CLAUDE.md** (`sample-project/CLAUDE.md`): Template for code repositories to specify PKM integration paths, context loading, and documentation rules.

## Claude Code Configuration

Register the MCP server in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "obsidian-pkm": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/index.js"],
      "env": {
        "VAULT_PATH": "/absolute/path/to/obsidian/vault"
      }
    }
  }
}
```

## Vault Structure Convention

```
Vault/
├── 00-Inbox/
├── 01-Projects/           # Active projects
│   └── ProjectName/
│       ├── _index.md
│       ├── planning/
│       ├── research/
│       └── development/decisions/
├── 02-Areas/
├── 03-Resources/Development/  # Reusable knowledge
├── 04-Archive/
├── 05-Templates/
└── 06-System/
```

## Key Conventions

- ADR naming: `ADR-{NNN}-{kebab-title}.md`
- Project index files: `_index.md`
- All notes use YAML frontmatter with `type`, `status`, `created` fields
- Paths passed to MCP tools are relative to vault root
