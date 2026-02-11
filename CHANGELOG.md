# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.1.0] - 2026-02-11

### Added
- `vault_update_frontmatter` tool — safe, atomic YAML frontmatter field updates (set, create, delete fields with protected required fields)
- `vault_trash` tool — soft-delete to `.trash/` (Obsidian convention) with broken incoming link warnings
- `vault_move` tool — move/rename files with automatic wikilink updating across vault
- `task` template for `vault_write` — structured task notes with status, priority, due date, project, and source fields
- `vault_query` enhancements: `custom_fields` filter for arbitrary frontmatter matching, `sort_by`/`sort_order` for result ordering with smart priority and date handling

### Fixed
- Startup crash on invalid `VAULT_PATH` now exits with clear error message
- `process.env.HOME` replaced with `os.homedir()` for Windows compatibility
- Unhandled promise rejection on server initialization failure
- Race condition in `vault_write` using atomic file creation (`wx` flag)
- Memory leak in semantic search file watcher debounce timers
- File watcher now closes on persistent errors instead of logging indefinitely
- `findFilesLinkingTo` and `buildIncomingIndex` gracefully skip deleted files instead of crashing
- Prototype pollution protection on frontmatter key validation (`__proto__`, `constructor`, `prototype` blocked)
- ReDoS vulnerability in `vault_list` glob pattern — replaced regex with linear-time glob matching
- `exploreNeighborhood` bare catch now only suppresses ENOENT, re-throws unexpected errors

### Changed
- Minimum Node.js version bumped from 18 to 20 (Node 18 is EOL)

## [1.0.0] - 2026-02-09

### Added
- Core MCP server with 15 tools for Obsidian vault interaction
- `vault_read` with pagination support (heading-based, tail lines, tail sections, chunk, line range); auto-redirects large files (>80k chars) to peek data; `force` param to bypass redirect (hard-capped at ~400k chars)
- `vault_peek` for inspecting file metadata and structure without reading full content (size, frontmatter, heading outline with line numbers, preview)
- `vault_write` with template-based note creation enforcing YAML frontmatter
- `vault_append` with positional insert (after heading, before heading, end of section)
- `vault_edit` for surgical single-occurrence string replacement
- `vault_search` for full-text search across markdown files
- `vault_semantic_search` using OpenAI `text-embedding-3-large` embeddings with SQLite-vec storage
- `vault_suggest_links` for smart link discovery based on content similarity
- `vault_list` and `vault_recent` for directory listing and recently modified files
- `vault_links` for wikilink analysis (`[[...]]` syntax)
- `vault_neighborhood` for graph context exploration via BFS wikilink traversal
- `vault_query` for querying notes by YAML frontmatter metadata (type, status, tags, dates)
- `vault_tags` for tag discovery with per-note counts, folder scoping, and glob patterns
- `vault_activity` for cross-session memory via activity logging with session IDs
- Fuzzy path resolution for read-only tools (resolve by basename, `.md` extension optional)
- Fuzzy folder resolution for search/query/tags/recent tools (partial name matching)
- 11 Obsidian note templates (project index, ADR, devlog, permanent note, research note, troubleshooting log, fleeting note, literature note, meeting notes, map of content, daily note)
- Sample `CLAUDE.md` for integrating PKM workflows into code repositories
- Background `fs.watch` indexer for keeping semantic search index fresh
- Metadata schema documentation (`06-System/metadata-schema.md`)
- GitHub Actions CI workflow
- Comprehensive test suite for helpers, handlers, graph module, and activity log
- ESLint configuration for code quality
- EditorConfig for consistent formatting
- Community files: CONTRIBUTING.md, CODE_OF_CONDUCT.md, LICENSE (MIT)

### Fixed
- Null tag handling in `vault_query`
- Shutdown race condition in semantic search indexer
- WAL size limits for SQLite databases
- Fetch timeout for OpenAI API calls to prevent hangs
- Path security to prevent directory traversal escapes

### Security
- Path traversal prevention on all vault operations
- Write tools require exact paths to prevent accidental modifications
- Ambiguous fuzzy path matches return errors instead of guessing

[Unreleased]: https://github.com/AdrianV101/Obsidian-MCP/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/AdrianV101/Obsidian-MCP/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/AdrianV101/Obsidian-MCP/releases/tag/v1.0.0
