# Obsidian PKM MCP Server

An MCP (Model Context Protocol) server that gives Claude Code full read/write access to your Obsidian vault. 14 tools for note CRUD, full-text search, semantic search, graph traversal, metadata queries, and session activity tracking.

## Features

| Tool | Description |
|------|-------------|
| `vault_read` | Read note contents |
| `vault_write` | Create notes from templates (enforces frontmatter) |
| `vault_append` | Append to notes, with positional insert (after/before heading, end of section) |
| `vault_edit` | Surgical string replacement |
| `vault_search` | Full-text search across markdown files |
| `vault_semantic_search` | Semantic similarity search via OpenAI embeddings |
| `vault_suggest_links` | Suggest relevant notes to link based on content similarity |
| `vault_list` | List files and folders |
| `vault_recent` | Recently modified files |
| `vault_links` | Wikilink analysis (incoming/outgoing) |
| `vault_neighborhood` | Graph exploration via BFS wikilink traversal |
| `vault_query` | Query notes by YAML frontmatter (type, status, tags, dates) |
| `vault_tags` | Discover tags with counts; folder scoping, glob filters, inline tag parsing |
| `vault_activity` | Session activity log for cross-conversation memory |

## Quick Start

### 1. Install

```bash
cd mcp-server
npm install
```

### 2. Register with Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "obsidian-pkm": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/index.js"],
      "env": {
        "VAULT_PATH": "/absolute/path/to/your/obsidian/vault"
      }
    }
  }
}
```

Restart Claude Code. The server provides all tools except semantic search out of the box.

### 3. Enable Semantic Search (optional)

Add your OpenAI API key to the env block:

```json
"env": {
  "VAULT_PATH": "/absolute/path/to/your/obsidian/vault",
  "OPENAI_API_KEY": "sk-..."
}
```

This enables `vault_semantic_search` and `vault_suggest_links`. Uses `text-embedding-3-large` with a SQLite + sqlite-vec index stored at `.obsidian/semantic-index.db`. The index rebuilds automatically — delete the DB file to force a full re-embed.

## Vault Structure

The server works with any Obsidian vault. The included templates assume this layout:

```
Vault/
├── 00-Inbox/
├── 01-Projects/
│   └── ProjectName/
│       ├── _index.md
│       ├── planning/
│       ├── research/
│       └── development/decisions/
├── 02-Areas/
├── 03-Resources/
├── 04-Archive/
├── 05-Templates/          # Note templates loaded by vault_write
└── 06-System/
```

### Templates

Copy the files from `templates/` into your vault's `05-Templates/` folder. `vault_write` loads templates from there and enforces frontmatter on every note created.

Available templates: `project-index`, `adr`, `devlog`, `permanent-note`

### CLAUDE.md for Your Projects

`sample-project/CLAUDE.md` is a template you can drop into any code repository to wire up Claude Code with your vault. It defines context loading, documentation rules, and ADR/devlog conventions.

## Architecture

```
mcp-server/
├── index.js          # MCP server, tool definitions, request handling
├── embeddings.js     # Semantic index (OpenAI embeddings, SQLite + sqlite-vec)
├── graph.js          # Graph traversal (wikilink resolution, BFS neighborhood)
├── activity.js       # Activity log (session tracking, SQLite)
├── utils.js          # Shared utilities
└── package.json
```

All paths passed to tools are relative to vault root. The server includes path security to prevent directory traversal.

## How It Works

**Note creation** is template-based. `vault_write` loads templates from `05-Templates/`, substitutes Templater-compatible variables (`<% tp.date.now("YYYY-MM-DD") %>`, `<% tp.file.title %>`), and validates required frontmatter fields (`type`, `created`, `tags`).

**Semantic search** embeds notes on startup and watches for changes via `fs.watch`. Long notes are chunked by `##` headings. The index is a regenerable cache stored in `.obsidian/` so it syncs across machines via Obsidian Sync.

**Graph exploration** resolves `[[wikilinks]]` to file paths (handling aliases, headings, and ambiguous basenames), then does BFS traversal to return notes grouped by hop distance.

**Activity logging** records every tool call with timestamps and session IDs, enabling Claude to recall what happened in previous conversations.

## License

MIT

