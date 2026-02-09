# Project: [Your Project Name]

> Place this file in your code repository root. It configures Claude Code to integrate with your Obsidian PKM system via the `obsidian-pkm` MCP server.

## PKM Integration

- **Vault project path**: `01-Projects/[YourProjectName]/`
- **MCP Server**: `obsidian-pkm` (configured in `~/.claude/settings.json`)

### Session Start: Load Context

Before starting work, load project context:

```
vault_read("01-Projects/[YourProjectName]/_index.md")
vault_recent({ folder: "01-Projects/[YourProjectName]", limit: 5 })
vault_activity({ path: "01-Projects/[YourProjectName]", limit: 10 })
```

Use `vault_activity` to recall what was done in previous sessions (files read, written, searched). This gives continuity across conversations.

### Before Creating or Researching

Always search before creating new notes to avoid duplication:

```
vault_search({ query: "your topic" })
vault_semantic_search({ query: "your concept", folder: "01-Projects/[YourProjectName]" })
vault_query({ tags: ["relevant-tag"], folder: "01-Projects/[YourProjectName]" })
```

`vault_semantic_search` finds conceptually related notes even when different words are used (e.g., searching "managing overwhelm" finds notes about "cognitive load"). Use it for discovery alongside exact-text `vault_search`.

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

After implementing features or making significant progress, append to the devlog:

```
vault_append({
  path: "01-Projects/[YourProjectName]/development/devlog.md",
  heading: "## Recent Activity",
  position: "after_heading",
  content: "## YYYY-MM-DD\n\n### Session Summary\n- What was done\n\n### Key Decisions\n- Decisions made (link to ADRs)\n\n### Next Steps\n- What's next\n\n---\n"
})
```

Use `position: "after_heading"` to prepend new entries (most recent first) or `position: "end_of_section"` to append.

### Reusable Knowledge

When solving a problem that has general applicability:

1. Search for existing related notes first:
   ```
   vault_semantic_search({ query: "the concept you learned" })
   ```
2. Create a permanent note if nothing exists:
   ```
   vault_write({
     template: "permanent-note",
     path: "03-Resources/Development/{topic-name}.md",
     frontmatter: { tags: ["relevant-tags"] }
   })
   ```
3. Find and add bidirectional links:
   ```
   vault_suggest_links({ path: "03-Resources/Development/{topic-name}.md" })
   ```

`vault_suggest_links` uses semantic similarity to find notes worth linking to, and excludes notes already linked via `[[wikilinks]]`.

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

## Session End

Before ending a development session:

1. Append a summary to the devlog
2. Update project status in `_index.md` if changed
3. Note any created files for future reference

## Project-Specific Notes

<!-- Customize the sections below for your project -->

### Tech Stack
-

### Key Patterns
-

### Important Constraints
-
