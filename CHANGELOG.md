# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- 4 canonical plugin agents: vault-explorer, devlog-updater, knowledge-sweeper, link-auditor
- Agents visible in `/agents`, can be @-mentioned, run foreground or background
- pkm-write skill (renamed from pkm-create) with new Modifying Existing Notes section

### Changed
- pkm-explore and pkm-session-end skills adapted for dual-context use (subagent + main conversation)
- hooks.json simplified to SessionStart only
- Tool count: 21 -> 20 (removed vault_capture)

### Removed
- `vault_capture` MCP tool (replaced by pkm-write skill + knowledge-sweeper agent)
- `stop-sweep.js` hook (replaced by knowledge-sweeper agent)
- `capture-handler.sh` hook (replaced by pkm-write skill)

## [2.1.6] - 2026-03-26

### Changed
- OpenAI API key now read from `OBSIDIAN_PKM_OPENAI_KEY` (with `OPENAI_API_KEY` fallback) — plugin-scoped variable avoids conflicts with project-level keys
- Setup command updated to use `OBSIDIAN_PKM_OPENAI_KEY` in `settings.json` env

## [2.1.5] - 2026-03-26

### Added
- Setup command offers to auto-approve all plugin vault tools via wildcard permission (`mcp__plugin_obsidian-pkm_obsidian-pkm__*`)

## [2.1.4] - 2026-03-26

### Security
- Setup command no longer asks user to type API key in chat — keys are configured via `~/.claude/settings.json` env block, never exposed in conversation history

### Changed
- Setup command uses `~/.claude/settings.json` env block for both `VAULT_PATH` and `OPENAI_API_KEY` (was recommending `.zshrc`) — Claude Code-native, scoped to Claude Code only

## [2.1.3] - 2026-03-26

### Fixed
- Remove `OPENAI_API_KEY` from `.mcp.json` env block — Claude Code requires declared env vars to be set, but this key is optional. The server reads it from process.env automatically when available.
- Remove explicit `hooks` field from `plugin.json` — Claude Code auto-discovers `hooks/hooks.json` at the standard location; declaring it explicitly caused a "duplicate hooks file" error.

## [2.1.2] - 2026-03-26

### Fixed
- Unresolved `${OPENAI_API_KEY}` template string treated as valid key — server now detects unresolved template variables and gracefully disables semantic search
- `vault_capture` PostToolUse hook matcher used old MCP prefix (`mcp__obsidian-pkm__vault_capture`) that doesn't match plugin tool name — changed to `vault_capture` for portability

## [2.1.1] - 2026-03-26

### Fixed
- MCP server fails to connect after marketplace install — changed `.mcp.json` from `node ${CLAUDE_PLUGIN_ROOT}/cli.js` to `npx -y obsidian-pkm@latest` so npm dependencies are resolved automatically
- `plugin.json` version (2.0.0) out of sync with `package.json` — both now 2.1.1

## [2.1.0] - 2026-03-26

### Added
- **`vault_add_links` tool** — Atomic link insertion with annotations, deduplication by basename (case-insensitive), section creation, and ambiguous basename disambiguation (uses full path when needed)
- **`vault_link_health` tool** — Graph health report: orphans (no links), broken links (missing targets), weakly connected (only 1 link), and ambiguous links (basename resolves to multiple files). Uses `buildIncomingIndex` for single-pass O(M) performance
- **`vault_suggest_links` `graph_context` param** — Blends semantic scores with graph proximity, flags notes not in the graph as missing links. Overfetches candidates and trims post-blending for optimal re-ranking
- **`vault_neighborhood` `include_semantic` param** — Appends semantically related but unlinked notes with frontmatter metadata (type, tags). Shows "(Semantic expansion skipped)" when OPENAI_API_KEY not set
- **`vault_semantic_search` `anchor` + `graph_weight` params** — Graph-distance weighted results biased toward an anchor note's neighborhood. Validates graph_weight (0-1, rejects NaN), excludes anchor from its own results
- **`computeProximityBonus` utility** — Shared depth-to-score mapping for graph-semantic blending (depth 0-1: 1.0, 2: 0.5, 3: 0.25, 4+: 0)
- **`pkm-create` skill** — Note creation with duplicate checking, link discovery, annotations, bidirectional linking, and index updates
- **`pkm-explore` skill** — Topic exploration combining graph traversal with semantic search and gap analysis
- **`pkm-session-end` skill** — Session wrap-up with devlog entry, undocumented work capture, link audit, and index updates
- **`vault_activity` session ID prefix matching** — Session filter now uses LIKE prefix matching instead of exact match, fixing the truncated 8-char ID issue
- Standardized `## Related` sections across 7 templates with format hint comments
- Exported `buildIncomingIndex` from `graph.js` for external use

### Changed
- Tool count: 19 → 21 (added `vault_add_links` and `vault_link_health`)
- Skills updated to use `vault_add_links` (was `vault_append`) and `vault_link_health` (was manual checking)
- `sample-project/CLAUDE.md` simplified — procedural PKM workflow sections replaced with skill references
- Devlog template stripped of placeholder session entry (skill appends real entries)
- CLAUDE.md fuzzy resolution lists updated with new tools

### Fixed
- `vault_activity` session filter used exact match on truncated 8-char IDs (now prefix matching via LIKE)
- Stale JSDoc references to `buildLinkResolutionMap` (renamed to `buildBasenameMap`)
- Devlog template `## Sessions` heading structure (date entries demoted to `###`, sub-sections to `####`)

## [2.0.0] - 2026-03-24

### Breaking Changes
- **Package renamed**: `pkm-mcp-server` → `obsidian-pkm`
- **CLI binary renamed**: `pkm-mcp-server` → `obsidian-pkm`
- **GitHub repo renamed**: `Obsidian-MCP` → `obsidian-pkm-plugin`

### Added
- Claude Code plugin structure (`.claude-plugin/plugin.json`)
- Declarative hook registration (`hooks/hooks.json`) — no more manual hook copying
- `/obsidian-pkm:setup` slash command for guided configuration
- Self-hosted marketplace for `claude plugin install` support
- `.mcp.json` for plugin-managed MCP server

### Changed
- Version jump from 1.6.x to 2.0.0 reflects the structural migration to a full plugin
- Init wizard simplified for npm fallback path

## [1.6.0] - 2026-03-23

### Security
- **Fix command injection in capture-handler.sh** — replaced `eval` of Node.js output with safe per-variable stdout capture. Previously, crafted `title` or `content` values containing shell metacharacters (e.g., `$(...)`) could execute arbitrary commands.
- `handleTrash` and `handleMove` now catch ENOENT errors and return relative paths instead of leaking absolute vault paths in error messages

### Changed
- Wikilink extraction in `handleLinks` and `handleSuggestLinks` now uses shared `extractWikilinks` from `graph.js` instead of duplicating the regex
- Extracted `addToBasenameMap`/`removeFromBasenameMap` helpers in `handlers.js` (replaces 3 inline copies)
- Named constant `SESSION_ID_DISPLAY_LEN` replaces magic number `8` for session ID truncation
- `@modelcontextprotocol/sdk` version range tightened from `^1.0.0` to `^1.27.0` to reflect actual minimum tested version

### Fixed
- README hook configuration referenced deleted `stop-sweep.sh` (renamed to `stop-sweep.js` in v1.5.0)
- `vault_peek` tool description no longer claims "line numbers" in heading outline (removed in v1.1.0)
- CHANGELOG: added missing entries for v1.5.3, v1.5.2, v1.1.1; fixed all comparison links
- CLAUDE.md and sample-project/CLAUDE.md: added missing `note.md` template to template lists
- CONTRIBUTING.md: clarified that double quotes and semicolons are conventions, not lint-enforced
- CI workflow: added `permissions: {}` for least privilege; added `npm audit --omit=dev` step

## [1.5.3] - 2026-03-21

### Fixed
- Init wizard `patchMcpConfig()` now handles multi-line `MCP_CONFIG=` blocks correctly — previously only replaced the first line, leaving orphaned continuation lines

## [1.5.2] - 2026-03-21

### Fixed
- Hook scripts now auto-detect repo vs installed location — `capture-handler.sh` no longer hardcodes `node $SCRIPT_DIR/../index.js`, falling back to `npx pkm-mcp-server@latest` when `index.js` is not present

## [1.5.1] - 2026-03-21

### Fixed
- Init wizard failed to copy `stop-sweep.js` — hook file references still pointed to the old `stop-sweep.sh` filename from before the v1.5.0 bash-to-Node conversion. Updated all references and removed stop-sweep from shell patching (it auto-detects MCP config).

## [1.5.0] - 2026-03-21

### Changed
- **Passive sweep hook upgraded to "PKM librarian"** — replaces inbox dumping with structured note creation in the correct project directory. Creates properly templated notes (tasks, ADRs, research notes, troubleshooting logs) with wikilinks to related notes via `vault_suggest_links`.
- Passive sweep: Haiku → Sonnet, 5 → 15 max turns, 3 → 17 tools
- Capture handler: Sonnet → Opus, 25 → 30 max turns, 8 → 17 tools
- Both hook agents now get all vault tools except `vault_trash` and `vault_capture`
- Capture handler prompt now includes `vault_suggest_links` for graph linking and `vault_search` for duplicate detection
- Stop hook converted from bash (`stop-sweep.sh`) to Node.js (`stop-sweep.js`) for direct `resolveProject()` import and cleaner prompt construction

### Added
- Auto-detection of repo vs installed location for MCP config — `stop-sweep.js` checks for `../index.js` (repo) and falls back to `npx pkm-mcp-server@latest` (installed). Eliminates need for text replacement during hook installation.
- `OPENAI_API_KEY` passthrough in both hook agents' MCP config when set, enabling `vault_semantic_search` and `vault_suggest_links`

### Fixed
- Sweep log files were empty due to pipe-based logging — parent process owned the FDs and exited before child could write. Now uses `openSync` FDs owned directly by the child process.
- Missing `child.on("error")` handler in sweep agent — spawn failures (e.g., `claude` not on PATH) now logged gracefully instead of crashing.

### Removed
- `hooks/stop-sweep.sh` — superseded by `hooks/stop-sweep.js`
- Inbox capture pattern (`00-Inbox/captures-{date}.md`) — all captures now go to project-specific typed notes

## [1.4.2] - 2026-03-21

### Fixed
- SessionStart hook crash — `load-context.js` imported `extractFrontmatter` and `extractTailSections` from parent-relative paths (`../utils.js`, `../helpers.js`) that don't exist when hooks are copied to `~/.claude/hooks/pkm/`. Inlined all three functions to make hooks fully self-contained.

## [1.4.1] - 2026-03-21

### Fixed
- SessionStart hook crash when installed via `init` — `resolve-project.js` imported `resolvePath` from `../helpers.js` which doesn't exist at `~/.claude/hooks/pkm/`. Inlined the path security check to remove the external dependency.

## [1.4.0] - 2026-03-21

### Added
- `pkm-mcp-server init` now configures PKM hooks for Claude Code — copies hook scripts to `~/.claude/hooks/pkm/` and writes hook entries to `~/.claude/settings.json`
- Individual opt-in for each hook: project context loading (SessionStart), passive capture (Stop), and explicit capture (PostToolUse)
- Merge-aware settings.json writing — preserves unrelated hooks, replaces PKM entries on re-run
- Hook script MCP config patching — works for both npx and cloned-repo installations
- 32 new unit tests for hook setup functions (`patchMcpConfig`, `isPkmHookEntry`, `buildHookEntries`, `mergeHooksIntoSettings`, `copyHooks`)

## [1.3.3] - 2026-03-21

### Fixed
- Use `pkm-mcp-server@latest` in npx registration command to ensure users always get the latest version (previously npx could serve stale cached versions)

## [1.3.2] - 2026-03-21

### Fixed
- Fix `claude mcp add` argument ordering — the `-e` flag is variadic and was greedily consuming the server name. Moved `--` separator before the server name to terminate option parsing.

## [1.3.1] - 2026-03-21

### Fixed
- `pkm-mcp-server init` now correctly registers the MCP server with Claude Code via `claude mcp add` instead of writing to the wrong config file (`~/.claude/settings.json`). Previously, the server appeared to register successfully but was never visible to Claude Code.

## [1.3.0] - 2026-03-19

### Added
- `pkm-mcp-server init` — interactive onboarding wizard that walks users through vault setup, template installation, folder structure, OpenAI API key configuration, and Claude Code registration in a single session
- `cli.js` — new CLI dispatcher with `init` and `--version` subcommands; existing MCP server behavior unchanged when run without arguments
- `templates/note.md` — minimal generic note template for users who prefer to define their own templates
- 36 unit tests for init wizard helpers

### Changed
- `index.js` refactored to export `startServer()` for CLI dispatcher (backward compatible — `node index.js` still works)
- Entry point updated from `index.js` to `cli.js` in package.json (`bin`, `main`, `exports`)

### Dependencies
- Added `@inquirer/prompts` for interactive CLI prompts

## [1.2.1] - 2026-03-17

### Added
- CI workflow for automated npm publishing via GitHub releases (OIDC trusted publishing, no tokens)

### Fixed
- Hook setup instructions now included in main README Quick Start (previously only in `hooks/README.md`, invisible on npm)
- `hooks/` directory added to architecture file tree in README

## [1.2.0] - 2026-03-17

### Added
- `vault_capture` tool — signal a PKM-worthy capture (decision, task, research, bug); returns immediately while a background hook creates the note
- PKM hook scripts for Claude Code integration:
  - SessionStart hook (`session-start.js`) — loads project context from vault automatically
  - PostToolUse hook (`capture-handler.sh`) — spawns Sonnet agent for explicit `vault_capture` calls
  - Stop hook (`stop-sweep.sh`) — spawns Haiku agent for passive decision/task sweep at session end
- Enum validation for task `status` (pending/active/done/cancelled) and `priority` (low/normal/high/urgent) fields in `vault_write` and `vault_update_frontmatter` — non-task note types are unaffected

### Changed
- `sqlite-vec` upgraded from pinned alpha (0.1.7-alpha.2) to stable release (0.1.7)
- `@modelcontextprotocol/sdk` updated to 1.27.1
- `better-sqlite3` updated to 12.8.0

### Security
- Resolved 7 transitive dependency vulnerabilities (hono, @hono/node-server, ajv, express-rate-limit, flatted, minimatch, qs)

## [1.1.1] - 2026-02-24

### Added
- Enum validation for task `status` and `priority` fields in `vault_write` and `vault_update_frontmatter`

## [1.1.0] - 2026-02-23

### Changed
- `vault_peek` heading outline now displays as an indented tree instead of a flat list — hierarchy is conveyed by 2-space indentation per level, `#` markers stripped
- `vault_peek` heading outline no longer includes line number prefixes (`L13`, `L15`, etc.)
- `vault_peek` size line now always includes chunk count (e.g. "1 chunk", "3 chunks") instead of showing a separate `**Chunks:**` line only for multi-chunk files

## [1.0.0] - 2026-02-11

### Added
- MCP server with 18 tools for Obsidian vault interaction
- `vault_read` with pagination support (heading-based, tail lines, tail sections, chunk, line range); auto-redirects large files (>80k chars) to peek data; `force` param to bypass redirect (hard-capped at ~400k chars)
- `vault_peek` for inspecting file metadata and structure without reading full content (size, frontmatter, indented heading tree, preview)
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

[Unreleased]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v2.1.6...HEAD
[2.1.6]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v2.1.5...v2.1.6
[2.1.5]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v2.1.4...v2.1.5
[2.1.4]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v2.1.3...v2.1.4
[2.1.3]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v2.1.2...v2.1.3
[2.1.2]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v2.1.1...v2.1.2
[2.1.1]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.6.0...v2.0.0
[1.6.0]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.5.3...v1.6.0
[1.5.3]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.4.2...v1.5.0
[1.4.2]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.3.3...v1.4.0
[1.3.3]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/AdrianV101/obsidian-pkm-plugin/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/AdrianV101/obsidian-pkm-plugin/releases/tag/v1.0.0
