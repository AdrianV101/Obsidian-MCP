# Project: [Your Project Name]

> This file configures Claude Code to integrate with your Obsidian PKM system.
> Place this in your code repository root.

## PKM Integration

- **Vault project path**: `01-Projects/[YourProjectName]/`
- **MCP Server**: `obsidian-pkm` (ensure it's configured in ~/.claude/settings.json)

### Context to Load at Session Start

Before starting work, read these notes for project context:

```
vault_read: 01-Projects/[YourProjectName]/_index.md
vault_read: 01-Projects/[YourProjectName]/planning/requirements.md
vault_recent: folder=01-Projects/[YourProjectName]/development/decisions, limit=3
```

## Documentation Rules

### Architecture Decisions
When a significant technical decision is made (database choice, framework selection, API design, etc.):

1. Create an ADR using `vault_write`
2. Path: `01-Projects/[YourProjectName]/development/decisions/ADR-{NNN}-{kebab-title}.md`
3. Use this format:
   ```markdown
   ---
   type: adr
   status: accepted
   created: {YYYY-MM-DD}
   ---
   # ADR-{NNN}: {Title}
   
   ## Context
   {Why is this decision needed?}
   
   ## Decision
   {What was decided?}
   
   ## Options Considered
   {What alternatives were evaluated?}
   
   ## Consequences
   {What are the implications?}
   ```
4. Update `_index.md` to link the new ADR

### Development Progress
After implementing features or making significant progress:

1. Append to development log using `vault_append`
2. Path: `01-Projects/[YourProjectName]/development/devlog.md`
3. Format:
   ```markdown
   ## {YYYY-MM-DD}
   ### Completed
   - {What was done}
   
   ### Decisions
   - {Any decisions, link to ADRs}
   
   ### Next
   - {What's next}
   ```

### Reusable Knowledge
When solving a problem that has general applicability:

1. Create a permanent note in `03-Resources/Development/`
2. Write it as standalone knowledge (not project-specific)
3. Link back to the project where it was learned
4. Search for related notes and add bidirectional links

### Session End
Before ending a development session:

1. Summarize what was accomplished
2. Update devlog with session summary
3. Update project status in `_index.md` if changed
4. List any notes created during session

## Context Queries

Before implementing a feature, search for relevant prior work:

```
vault_search: {feature keywords}
vault_search: folder=03-Resources/Development, query={technology}
vault_list: 01-Projects/[YourProjectName]/research/
```

## Project-Specific Notes

<!-- Add any project-specific instructions here -->

### Tech Stack
- 

### Key Patterns
- 

### Important Constraints
- 

