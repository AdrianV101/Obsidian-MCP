# Project: [Your Project Name]

> Place this file in your code repository root. It configures Claude Code to integrate with your Obsidian PKM system via the `obsidian-pkm` MCP server.

## PKM Integration

- **Vault project path**: `01-Projects/[YourProjectName]/`
- **MCP Server**: `obsidian-pkm` (configured in `~/.claude/settings.json`)

### PKM Skills

The `obsidian-pkm` plugin provides skills that automate common PKM workflows:

- `obsidian-pkm:pkm-write` — Use when creating vault notes (duplicate check, linking, annotations)
- `obsidian-pkm:pkm-explore` — Use when researching what the vault knows about a topic (graph + semantic exploration)
- `obsidian-pkm:pkm-session-end` — Use when wrapping up a session (devlog, link audit, undocumented work capture)

Session-start context loading is handled automatically by the SessionStart hook.

### PKM Agents

The plugin provides 4 specialized agents (visible in `/agents`). Delegate to them proactively:

| Agent | When to Delegate | Mode |
|---|---|---|
| `vault-explorer` | Before creating notes on a topic, when researching existing knowledge | Foreground |
| `devlog-updater` | After completing a significant development block, before session ends | Background |
| `knowledge-sweeper` | After significant work that produced decisions, research, tasks, or gotchas | Background |
| `link-auditor` | After creating/modifying multiple vault notes, periodic health checks | Background |

## Documentation Rules

### Metadata

All notes MUST include YAML frontmatter. See `06-System/metadata-schema.md` for the full schema.

```yaml
---
type: <type>        # Required
created: YYYY-MM-DD # Required (auto-filled by vault_write)
tags: [...]         # Required: at least one tag
status: <status>    # If applicable
---
```

**Never create notes without frontmatter** — use `vault_write` with a template.

### Architecture Decisions

When a significant technical decision is made:

1. Create an ADR using `vault_write` with the `adr` template:
   ```
   vault_write({
     template: "adr",
     path: "01-Projects/[YourProjectName]/development/decisions/ADR-{NNN}-{kebab-title}.md",
     frontmatter: { tags: ["decision", "relevant-topic"], deciders: "Team" }
   })
   ```
2. Fill in Context, Decision, Options Considered, and Consequences sections
3. Update `_index.md` to link the new ADR:
   ```
   vault_append({
     path: "01-Projects/[YourProjectName]/_index.md",
     heading: "## Architecture Decisions",
     position: "end_of_section",
     content: "- [[ADR-{NNN}-{kebab-title}]]"
   })
   ```

### Development Progress

Use the `obsidian-pkm:pkm-session-end` skill at the end of each session — it handles devlog entries, link auditing, and capturing undocumented work from the conversation.

### Reusable Knowledge

Use the `obsidian-pkm:pkm-write` skill when creating any vault note — it handles duplicate checking, template selection, link discovery, and bidirectional linking automatically.

### Troubleshooting

When debugging a complex issue, create a troubleshooting log:

```
vault_write({
  template: "troubleshooting-log",
  path: "01-Projects/[YourProjectName]/development/debug/{issue-name}.md",
  frontmatter: { tags: ["debugging", "relevant-topic"] }
})
```

Fill in: Problem, Symptoms, Root Cause, Solution, Prevention.

## Context Queries

### Find Related Notes

```
vault_search({ query: "keywords", folder: "01-Projects/[YourProjectName]" })
vault_semantic_search({ query: "concept description" })
vault_query({ type: "adr", folder: "01-Projects/[YourProjectName]" })
vault_tags({ folder: "01-Projects/[YourProjectName]" })
```

### Explore Connections

```
vault_neighborhood({ path: "01-Projects/[YourProjectName]/_index.md", depth: 2 })
vault_links({ path: "path/to/note.md", direction: "both" })
```

`vault_neighborhood` traverses wikilinks via BFS and returns notes grouped by hop distance — useful for understanding how notes relate to each other.

### Cross-Session Memory

```
vault_activity({ path: "01-Projects/[YourProjectName]" })
vault_activity({ tool: "vault_write", since: "2026-01-01" })
```

Check what was done in previous sessions to maintain continuity.

## Available Templates

Use these with `vault_write({ template: "name", path: "...", frontmatter: { tags: [...] } })`:

| Template | Use For |
|---|---|
| `project-index` | Project overview (`_index.md`) |
| `adr` | Architecture Decision Records |
| `devlog` | Development logs |
| `permanent-note` | Atomic evergreen knowledge notes |
| `research-note` | Research findings and analysis |
| `troubleshooting-log` | Bug investigations and fixes |
| `fleeting-note` | Quick captures and temporary thoughts |
| `literature-note` | Notes on articles, books, talks |
| `meeting-notes` | Meeting records |
| `moc` | Maps of Content (index/hub notes) |
| `daily-note` | Daily notes |
| `task` | Structured task notes with status, priority, due date |
| `note` | Minimal generic notes |

## Session End

Use the `obsidian-pkm:pkm-session-end` skill — it handles devlog updates, undocumented work capture, link audits, and index updates.

## Project-Specific Notes

<!-- Customize the sections below for your project -->

### Tech Stack
-

### Key Patterns
-

### Important Constraints
-
