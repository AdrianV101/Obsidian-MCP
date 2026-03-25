# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Claude Code plugin that provides an MCP server and supporting tools for bidirectional knowledge flow between Claude Code and an Obsidian vault. It packages 21 MCP tools, Claude Code hooks, and a setup skill under the `obsidian-pkm` plugin identity.

## Commands

```bash
# Install dependencies
npm install

# Run the MCP server (for testing)
VAULT_PATH="/path/to/your/vault" node cli.js

# Interactive setup wizard
node cli.js init

# Start the server
npm start

# Run unit tests
npm test

# Run linter
npm run lint
```

## Architecture

The project consists of three parts:

**MCP Server**: A Node.js ES module server implementing the Model Context Protocol. The main entry point is `index.js` (tool definitions and request routing), with pure helper functions extracted to `helpers.js`. It provides 21 tools for vault interaction:
- `vault_read` - Read note contents (supports pagination: `heading`, `tail`, `tail_sections` [with optional `section_level` param, default: 2], `chunk`, `lines`; auto-redirects to peek data for files >80k chars; `force` bypasses redirect)
- `vault_peek` - Inspect file metadata/structure without reading full content (size, frontmatter, indented heading tree, preview)
- `vault_write` - Create new notes from templates (enforces frontmatter; settable fields: `status`, `priority`, `project`, `deciders`, `due`, `source`; `variables` param for custom `<%...%>` substitution in template body)
- `vault_append` - Add content to existing files, with optional positional insert (after/before heading, end of section)
- `vault_edit` - Surgical string replacement (exact match, single occurrence)
- `vault_update_frontmatter` - Update YAML frontmatter fields atomically (set, create, remove fields)
- `vault_search` - Full-text search across markdown files
- `vault_semantic_search` - Semantic similarity search using OpenAI embeddings (requires `OPENAI_API_KEY`)
- `vault_suggest_links` - Suggest relevant notes to link based on content similarity; `graph_context: true` for graph-semantic blending (requires `OPENAI_API_KEY`)
- `vault_list` / `vault_recent` - Directory listing and recent files
- `vault_links` - Wikilink analysis (`[[...]]` syntax)
- `vault_neighborhood` - Graph context exploration via BFS wikilink traversal
- `vault_query` - Query notes by YAML frontmatter (type, status, `tags` [ALL must match], `tags_any` [ANY must match], dates, `custom_fields` for arbitrary field matching, `sort_by`/`sort_order` for result ordering)
- `vault_tags` - Discover all tags with per-note counts; supports folder scoping, glob patterns, inline `#tag` parsing
- `vault_activity` - Query/clear activity log (all tool calls with timestamps and session IDs)
- `vault_trash` - Soft-delete to `.trash/` (Obsidian convention), warns about broken incoming links
- `vault_move` - Move/rename files with automatic wikilink updating across vault (`update_links: false` to skip)
- `vault_capture` - Signal a PKM-worthy capture (decision, task, research, bug); returns immediately, background hook creates the note
- `vault_add_links` - Add annotated wikilinks to a note's section with deduplication (default: ## Related)
- `vault_link_health` - Graph health report: orphans, broken links, weakly connected notes, ambiguous links

The server uses `VAULT_PATH` environment variable (defaults to `~/Documents/PKM`) and includes path security to prevent directory escaping.

### vault_neighborhood (Graph Context Exploration)

Explores the graph neighborhood around a note by traversing wikilinks using BFS. Returns notes grouped by hop distance with frontmatter metadata.

- Resolves wikilink targets to actual file paths (handles `[[note]]`, `[[folder/note]]`, `[[note|alias]]`, `[[note#heading]]`)
- Detects ambiguous links (multiple files with same basename) and annotates them
- Per-call indexes: basename resolution map + incoming link index (no persistent state)
- Params: `path` (required), `depth` (default: 2), `direction` (`"both"` | `"outgoing"` | `"incoming"`), `include_semantic` (boolean, appends unlinked semantic results), `semantic_limit` (default: 5)
- Implementation: `graph.js` module (link resolution, BFS traversal, formatting)

### vault_semantic_search (Semantic Similarity Search)

Finds conceptually related notes even when they use different terminology. For example, searching "managing overwhelm" finds notes about "cognitive load" or "information overload".

- Requires `OPENAI_API_KEY` env var — tool is hidden from tool list when not set
- Uses OpenAI `text-embedding-3-large` (3072 dimensions)
- Index stored at `$VAULT_PATH/.obsidian/semantic-index.db` (SQLite + sqlite-vec)
- Background `fs.watch` keeps index fresh; startup sync catches changes made while server was stopped
- Chunking: whole-note for short notes, heading-based (`##`) splits for notes > ~2000 tokens
- Params: `query` (required), `limit`, `folder`, `threshold` (0-1 similarity score), `anchor` (optional path for graph-distance weighting), `graph_weight` (0-1, default: 0.3)

```javascript
// Graph-weighted search biased toward a specific note's neighborhood
vault_semantic_search({ query: "cache eviction strategies", anchor: "research/caching.md", graph_weight: 0.3 })
```

The semantic index is a regenerable cache — deleting `semantic-index.db` triggers a full re-embed on next startup. The DB syncs across machines via Obsidian Sync (stored in `.obsidian/`).

### vault_write (Template-Based Note Creation)

Notes must be created from templates to ensure proper frontmatter. The tool:
- Loads templates from `05-Templates/` at startup
- Auto-substitutes `<% tp.date.now("YYYY-MM-DD") %>` and `<% tp.file.title %>`
- Accepts `frontmatter` param for tags and other fields (`status`, `priority`, `project`, `deciders`, `due`, `source`)
- Validates required fields: `type`, `created`, `tags`
- Validates enum fields for task notes: `status` (pending/active/done/cancelled), `priority` (low/normal/high/urgent)
- Errors if file already exists (use `vault_edit` or `vault_append` to modify)

Examples:
```javascript
vault_write({
  template: "adr",
  path: "01-Projects/MyApp/development/decisions/ADR-001-database.md",
  frontmatter: { tags: ["decision", "database"], deciders: "Team" }
})

vault_write({
  template: "task",
  path: "01-Projects/MyApp/planning/task-api-refactor.md",
  frontmatter: { tags: ["task", "api"], priority: "high", project: "MyApp", due: "2026-03-01" }
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
vault_activity({ session: "abc12345" })             // Filter by session ID prefix
vault_activity({ since: "2026-02-08" })             // Today's activity
vault_activity({ path: "01-Projects/MyApp" })       // Activity on specific project
vault_activity({ action: "clear" })                 // Clear all history
vault_activity({ action: "clear", before: "2026-01-01" })  // Clear old entries
```

Implementation: `activity.js` (ActivityLog class)

### vault_update_frontmatter (Atomic Frontmatter Updates)

Safely updates YAML frontmatter fields in an existing note without touching the body content. Parses existing frontmatter, applies changes, and writes back.

- Set fields to new values, add new fields, or remove fields by setting to `null`
- Protected fields (`type`, `created`, `tags`) cannot be removed (only updated)
- Arrays (like `tags`) are replaced wholesale
- Enum validation: task `status` must be one of `pending`, `active`, `done`, `cancelled`; task `priority` must be one of `low`, `normal`, `high`, `urgent` — non-task types are unconstrained
- Requires exact path (no fuzzy resolution — destructive operation)

```javascript
vault_update_frontmatter({
  path: "01-Projects/MyApp/planning/task-api-refactor.md",
  fields: { status: "in-progress", priority: "urgent" }
})

// Remove a field by setting to null
vault_update_frontmatter({
  path: "01-Projects/MyApp/planning/task-api-refactor.md",
  fields: { due: null }  // removes the due field
})
```

Implementation: `updateFrontmatter` pure function in `helpers.js`, handler in `handlers.js`

### vault_add_links (Atomic Link Insertion)

Add annotated wikilinks to a note's section with deduplication. Validates targets exist, skips duplicates by basename (case-insensitive). Creates the section if missing.

- Requires exact path (no fuzzy resolution — destructive operation)
- Deduplicates by basename: `[[note]]` won't be added if `[[note]]` or `[[folder/note]]` already in file
- Section insertion point: end of section (before next same-or-higher heading, or EOF)

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | Exact vault-relative path (required) |
| `links` | array | Links to add: `[{ target, annotation }]` (required) |
| `section` | string | Target section heading (default: `## Related`) |
| `create_section` | boolean | Create section if missing (default: true) |

```javascript
vault_add_links({
  path: "research/caching.md",
  links: [
    { target: "decisions/ADR-003-caching.md", annotation: "supersedes this earlier approach" },
    { target: "research/architecture-patterns.md", annotation: "foundational patterns referenced" }
  ]
})
```

### vault_link_health (Graph Health Report)

Audit link quality across the vault or a specific folder. Returns categorized report of link issues.

- **orphans**: Notes with zero incoming AND zero outgoing wikilinks
- **broken**: Wikilinks that resolve to no existing file
- **weak**: Notes with only 1 total resolved link (incoming + outgoing; broken links don't count)
- **ambiguous**: Wikilinks where basename resolves to multiple files

| Parameter | Type | Description |
|-----------|------|-------------|
| `folder` | string | Optional: scope to folder (fuzzy resolution supported) |
| `checks` | array | Which checks: `orphans`, `broken`, `weak`, `ambiguous` (default: all) |
| `limit` | number | Max results per category (default: 20) |

```javascript
vault_link_health({ folder: "01-Projects/MyApp", checks: ["orphans", "broken"] })
```

Implementation: `handleLinkHealth` in `handlers.js`, uses `buildIncomingIndex` from `graph.js` for O(M) performance.

### vault_query (Enhanced Filtering and Sorting)

In addition to the standard filters (type, status, `tags` [ALL must match], `tags_any` [ANY must match], dates, folder), `vault_query` supports:

- `custom_fields` — filter by arbitrary frontmatter fields (exact match); use `null` to match notes where a field is missing
- `sort_by` — sort results by any frontmatter field; smart ordering for priority (`urgent > high > normal > low`), chronological for dates, alphabetical otherwise; nulls sort last
- `sort_order` — `"asc"` (default) or `"desc"`

```javascript
vault_query({ type: "task", custom_fields: { priority: "high" }, sort_by: "due" })
vault_query({ tags: ["task"], sort_by: "priority", sort_order: "asc" })
vault_query({ custom_fields: { project: "MyApp", due: null } })  // tasks with no due date
```

### Fuzzy Path Resolution

Read-only tools (`vault_read`, `vault_peek`, `vault_links`, `vault_neighborhood`, `vault_suggest_links`) support fuzzy path resolution:
- Exact paths still work as before (zero overhead)
- Short names resolve by basename: `"devlog"` → `"01-Projects/MyApp/development/devlog.md"`
- `.md` extension is optional: `"devlog"` and `"devlog.md"` both work
- Ambiguous names (multiple files with same basename) return an error listing all candidates
- Use a more specific path or the `folder` param to disambiguate

Folder-scoped tools (`vault_search`, `vault_query`, `vault_tags`, `vault_recent`, `vault_link_health`) support fuzzy folder resolution:
- Exact folder paths still work as before
- Partial names match by substring: `"MyApp"` → `"01-Projects/MyApp"`
- Ambiguous matches return an error listing candidates

Write/destructive tools (`vault_write`, `vault_append`, `vault_edit`, `vault_trash`, `vault_move`, `vault_add_links`) require exact paths to prevent accidental modifications.

Implementation: `helpers.js` (`buildBasenameMap`, `resolveFuzzyPath`, `resolveFuzzyFolder`)

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
- `task.md` - Structured task notes with status, priority, due date, project, and source fields
- `note.md` - Minimal generic note

**Sample CLAUDE.md** (`sample-project/CLAUDE.md`): Template for code repositories to specify PKM integration paths, context loading, and documentation rules.

## Claude Code Configuration

**Via Claude Code plugin marketplace** (recommended):

```bash
claude plugin marketplace add AdrianV101/obsidian-pkm-plugin
claude plugin install obsidian-pkm
```

Then run `/obsidian-pkm:setup` in Claude Code.

**Via npm** (fallback):

```bash
# Interactive setup
obsidian-pkm init

# Or register manually
claude mcp add -s user \
  -e VAULT_PATH=/absolute/path/to/obsidian/vault \
  -e OPENAI_API_KEY=sk-... \
  -- obsidian-pkm npx -y obsidian-pkm@latest
```

`OPENAI_API_KEY` is optional — without it, all tools except `vault_semantic_search` and `vault_suggest_links` work normally.

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

Common types: `fleeting`, `research`, `adr`, `bug`, `planning`, `transcript`, `permanent`, `task`

**Never create notes without frontmatter** — even quick research docs or ad-hoc files.
