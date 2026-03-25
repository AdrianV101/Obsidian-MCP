---
name: pkm-create
description: Use when creating new vault notes via vault_write — handles duplicate checking, link discovery, annotations, and index updates. Trigger BEFORE any vault_write call for new notes.
---

# PKM Create — Note Creation with Knowledge Graph Integration

Every new note should be connected to the knowledge graph. Follow these steps in order.

## Step 1: Duplicate Check

Before creating, search for existing notes on the same topic:

```
vault_semantic_search({ query: "<topic/title of intended note>", limit: 5 })
```

- If a result has similarity **> 0.8**: **warn the user** and suggest editing the existing note instead of creating a duplicate
- If results are **0.5–0.8**: mention them as potentially related but proceed with creation
- If **no close matches**: proceed

If `vault_semantic_search` is unavailable (no `OPENAI_API_KEY`), use `vault_search` with the note's title and key terms, and `vault_query` with matching tags to check for duplicates.

## Step 2: Create the Note

Use `vault_write` with the appropriate template and frontmatter:

```
vault_write({
  template: "<template>",
  path: "<vault-relative-path>",
  frontmatter: { tags: [...], ... }
})
```

Ensure:
- Correct template for the note type (see CLAUDE.md "What to Document" table)
- At least one meaningful tag
- Path follows vault conventions

## Step 3: Discover Connections

Run `vault_suggest_links` on the new note to find related content:

```
vault_suggest_links({ path: "<path-to-new-note>", limit: 8 })
```

Select the top **3–5** most relevant suggestions.

If `vault_suggest_links` is unavailable (no `OPENAI_API_KEY`), use `vault_search` with key terms from the note's title/topic and `vault_query` with matching tags to manually identify good link targets.

If **no suggestions are returned** (new vault or isolated topic), skip Steps 4–6 — the note's `## Related` section will be filled as the graph grows. Inform the user that no connections were found yet.

## Step 4: Draft Annotations

For each selected link, write a one-line annotation explaining the relationship.

**Good annotations** use specific relationship language:
- "builds on", "supersedes", "implements", "contradicts", "provides context for", "extends", "is an instance of"

**Bad**: `- [[note]] — related to this topic`
**Good**: `- [[architecture-patterns]] — foundational patterns this decision builds on`

Use the note's content, shared tags, and conversation context to produce meaningful explanations.

## Step 5: Insert Links

Add annotated links to the note using `vault_add_links`:

```
vault_add_links({
  path: "<path-to-new-note>",
  links: [
    { target: "<vault-relative-path>", annotation: "relationship explanation" },
    { target: "<vault-relative-path>", annotation: "relationship explanation" }
  ]
})
```

The tool handles deduplication (skips already-linked targets), creates `## Related` if missing, and validates targets exist. Format annotations as specific relationship language (see Step 4).

If the note uses a non-standard section (e.g., `## References`), pass `section: "## References"`.

If the template does not include a `## Related` section, `vault_add_links` will create it automatically (default `create_section: true`). Templates with `## Related` built in: adr, permanent-note, research-note, troubleshooting-log, literature-note, moc, meeting-notes.

Note: MOC notes created before this version may use `## Related Topics` instead of `## Related`. If `vault_add_links` fails with "Section not found", try `section: "## Related Topics"`.

## Step 6: Bidirectional Linking

For **significant note types** (ADR, permanent-note, research-note, troubleshooting-log, literature-note, moc, meeting-notes):
- Check if the top 1–2 target notes would benefit from a backlink to this new note
- If yes, add a backlink to their `## Related` section using `vault_add_links`

**Skip** for ephemeral types (fleeting-note, daily-note) — Obsidian's native backlinks panel is sufficient.

## Step 7: Index Update

- If the note is an **ADR**: add a wikilink to the project's `_index.md`
- If the note is **project-scoped**: ensure the project `_index.md` references it where appropriate
