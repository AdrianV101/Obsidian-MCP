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

# Run unit tests
npm test

# Run linter
npm run lint
```

## Architecture

The project consists of three parts:

**MCP Server** (`mcp-server/`): A Node.js ES module server implementing the Model Context Protocol. The main entry point is `index.js` (tool definitions and request routing), with pure helper functions extracted to `helpers.js`. It provides 14 tools for vault interaction:
- `vault_read` - Read note contents
- `vault_write` - Create new notes from templates (enforces frontmatter)
- `vault_append` - Add content to existing files, with optional positional insert (after/before heading, end of section)
- `vault_edit` - Surgical string replacement (exact match, single occurrence)
- `vault_search` - Full-text search across markdown files
- `vault_semantic_search` - Semantic similarity search using OpenAI embeddings (requires `OPENAI_API_KEY`)
- `vault_suggest_links` - Suggest relevant notes to link to based on content similarity (requires `OPENAI_API_KEY`)
- `vault_list` / `vault_recent` - Directory listing and recent files
- `vault_links` - Wikilink analysis (`[[...]]` syntax)
- `vault_neighborhood` - Graph context exploration via BFS wikilink traversal
- `vault_query` - Query notes by YAML frontmatter (type, status, tags, dates)
- `vault_tags` - Discover all tags with per-note counts; supports folder scoping, glob patterns, inline `#tag` parsing
- `vault_activity` - Query/clear activity log (all tool calls with timestamps and session IDs)

The server uses `VAULT_PATH` environment variable (defaults to `~/Documents/PKM`) and includes path security to prevent directory escaping.

### vault_neighborhood (Graph Context Exploration)

Explores the graph neighborhood around a note by traversing wikilinks using BFS. Returns notes grouped by hop distance with frontmatter metadata.

- Resolves wikilink targets to actual file paths (handles `[[note]]`, `[[folder/note]]`, `[[note|alias]]`, `[[note#heading]]`)
- Detects ambiguous links (multiple files with same basename) and annotates them
- Per-call indexes: basename resolution map + incoming link index (no persistent state)
- Params: `path` (required), `depth` (default: 2), `direction` (`"both"` | `"outgoing"` | `"incoming"`)
- Implementation: `mcp-server/graph.js` module (link resolution, BFS traversal, formatting)

### vault_semantic_search (Semantic Similarity Search)

Finds conceptually related notes even when they use different terminology. For example, searching "managing overwhelm" finds notes about "cognitive load" or "information overload".

- Requires `OPENAI_API_KEY` env var — tool is hidden from tool list when not set
- Uses OpenAI `text-embedding-3-large` (3072 dimensions)
- Index stored at `$VAULT_PATH/.obsidian/semantic-index.db` (SQLite + sqlite-vec)
- Background `fs.watch` keeps index fresh; startup sync catches changes made while server was stopped
- Chunking: whole-note for short notes, heading-based (`##`) splits for notes > ~2000 tokens
- Params: `query` (required), `limit`, `folder`, `threshold` (0-1 similarity score)

The semantic index is a regenerable cache — deleting `semantic-index.db` triggers a full re-embed on next startup. The DB syncs across machines via Obsidian Sync (stored in `.obsidian/`).

### vault_write (Template-Based Note Creation)

Notes must be created from templates to ensure proper frontmatter. The tool:
- Loads templates from `05-Templates/` at startup
- Auto-substitutes `<% tp.date.now("YYYY-MM-DD") %>` and `<% tp.file.title %>`
- Accepts `frontmatter` param for tags and other fields
- Validates required fields: `type`, `created`, `tags`
- Errors if file already exists (use `vault_edit` or `vault_append` to modify)

Example:
```javascript
vault_write({
  template: "adr",
  path: "01-Projects/MyApp/development/decisions/ADR-001-database.md",
  frontmatter: { tags: ["decision", "database"], deciders: "Team" }
})
```

### vault_activity (Session Memory / Activity Log)

Logs all MCP tool calls with timestamps and session IDs. Enables cross-session memory — Claude can recall what was read, written, or searched in previous sessions.

- Storage: SQLite DB at `$VAULT_PATH/.obsidian/activity-log.db` (separate from semantic index)
- Session ID: generated via `crypto.randomUUID()` at MCP server startup (each conversation gets its own)
- Logs every tool call except `vault_activity` itself
- Supports filtering by tool name, session ID, date range, and path substring
- Privacy: `action: "clear"` deletes entries (with optional filters), or delete the DB file

```javascript
vault_activity()                                    // Recent 50 entries
vault_activity({ tool: "vault_write" })             // Only writes
vault_activity({ since: "2026-02-08" })             // Today's activity
vault_activity({ path: "01-Projects/MyApp" })       // Activity on specific project
vault_activity({ action: "clear" })                 // Clear all history
vault_activity({ action: "clear", before: "2026-01-01" })  // Clear old entries
```

Implementation: `mcp-server/activity.js` (ActivityLog class)

**Templates** (`templates/`): Obsidian note templates for project documentation:
- `project-index.md` - Project overview with YAML frontmatter
- `adr.md` - Architecture Decision Record format
- `devlog.md` - Development log with session entries
- `permanent-note.md` - Atomic evergreen notes
- `research-note.md` - Research findings and analysis
- `troubleshooting-log.md` - Bug investigations and fixes
- `fleeting-note.md` - Quick captures and temporary thoughts
- `literature-note.md` - Notes on articles, books, talks
- `meeting-notes.md` - Meeting records
- `moc.md` - Maps of Content (index/hub notes)
- `daily-note.md` - Daily notes

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
        "VAULT_PATH": "/absolute/path/to/obsidian/vault",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

`OPENAI_API_KEY` is optional — without it, all tools except `vault_semantic_search` work normally.

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

## Metadata Schema

**Canonical reference:** `06-System/metadata-schema.md`

When creating ANY note via MCP, ALWAYS include frontmatter:
```yaml
---
type: <type>        # Required: see schema for allowed values
created: YYYY-MM-DD # Required
tags: [...]         # Required: at least one tag
status: <status>    # If applicable for the type
---
```

Common types: `fleeting`, `research`, `adr`, `bug`, `planning`, `transcript`, `permanent`

**Never create notes without frontmatter** — even quick research docs or ad-hoc files.
