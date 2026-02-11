# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.0] - 2026-02-11

### Added
- MCP server with 18 tools for Obsidian vault interaction
- `vault_read` with pagination support (heading-based, tail lines, tail sections, chunk, line range); auto-redirects large files (>80k chars) to peek data; `force` param to bypass redirect (hard-capped at ~400k chars)
- `vault_peek` for inspecting file metadata and structure without reading full content (size, frontmatter, heading outline with line numbers, preview)
- `vault_write` with template-based note creation enforcing YAML frontmatter
- `vault_append` with positional insert (after heading, before heading, end of section)
- `vault_edit` for surgical single-occurrence string replacement
- `vault_update_frontmatter` — safe, atomic YAML frontmatter field updates (set, create, delete fields with protected required fields)
- `vault_search` for full-text search across markdown files
- `vault_semantic_search` using OpenAI `text-embedding-3-large` embeddings with SQLite-vec storage
- `vault_suggest_links` for smart link discovery based on content similarity
- `vault_list` and `vault_recent` for directory listing and recently modified files
- `vault_links` for wikilink analysis (`[[...]]` syntax)
- `vault_neighborhood` for graph context exploration via BFS wikilink traversal
- `vault_query` for querying notes by YAML frontmatter metadata (type, status, tags, dates, custom fields, sorting)
- `vault_tags` for tag discovery with per-note counts, folder scoping, and glob patterns
- `vault_activity` for cross-session memory via activity logging with session IDs
- `vault_trash` — soft-delete to `.trash/` (Obsidian convention) with broken incoming link warnings
- `vault_move` — move/rename files with automatic wikilink updating across vault
- Fuzzy path resolution for read-only tools (resolve by basename, `.md` extension optional)
- Fuzzy folder resolution for search/query/tags/recent tools (partial name matching)
- 12 Obsidian note templates (project index, ADR, devlog, permanent note, research note, troubleshooting log, fleeting note, literature note, meeting notes, map of content, daily note, task)
- Sample `CLAUDE.md` for integrating PKM workflows into code repositories
- Background `fs.watch` indexer for keeping semantic search index fresh
- Metadata schema documentation (`06-System/metadata-schema.md`)
- GitHub Actions CI workflow
- Comprehensive test suite (417 tests) for helpers, handlers, graph module, and activity log
- ESLint configuration for code quality
- EditorConfig for consistent formatting
- Community files: CONTRIBUTING.md, CODE_OF_CONDUCT.md, LICENSE (MIT)

### Security
- Path traversal prevention on all vault operations
- Write tools require exact paths to prevent accidental modifications
- Ambiguous fuzzy path matches return errors instead of guessing
- Prototype pollution protection on frontmatter key validation (`__proto__`, `constructor`, `prototype` blocked)
- ReDoS vulnerability prevention in `vault_list` glob pattern — linear-time glob matching
- Atomic file creation in `vault_write` (`wx` flag) prevents race conditions
- Error messages sanitized to prevent leaking absolute vault paths

[Unreleased]: https://github.com/AdrianV101/Obsidian-MCP/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/AdrianV101/Obsidian-MCP/releases/tag/v1.0.0
