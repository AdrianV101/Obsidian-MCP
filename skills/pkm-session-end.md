---
name: pkm-session-end
description: Use when wrapping up a work session — creates devlog entry, captures undocumented decisions/research/debugging from conversation, audits link health of session work, and updates project index
---

# PKM Session End — Knowledge Capture and Graph Maintenance

Run this workflow when wrapping up a session to ensure no knowledge is lost and the graph stays healthy.

## Step 1: Devlog Entry

Append a session summary to the project devlog, most recent entry first.

**If the devlog file doesn't exist yet** (new project, first session), create it first:

```
vault_write({
  template: "devlog",
  path: "01-Projects/<Project>/development/devlog.md",
  frontmatter: { tags: ["devlog"], project: "<Project>" }
})
```

Then append the session entry:

```
vault_append({
  path: "01-Projects/<Project>/development/devlog.md",
  heading: "## Sessions",
  position: "after_heading",
  content: "### YYYY-MM-DD HH:mm\n\n#### Session Summary\n- <what was accomplished>\n\n#### Key Decisions\n- <decisions made, link to ADRs if created>\n\n#### Blockers / Issues\n- <problems encountered, or \"None\">\n\n#### Next Steps\n- <what remains>\n\n---\n"
})
```

Use the **actual date** and fill in real content from the session. Keep entries concise but specific. Using `after_heading` inserts each new entry at the top, keeping the log in reverse-chronological order.

**Existing devlogs**: Older devlogs may use `## YYYY-MM-DD` entries without a `## Sessions` heading. If `vault_append` fails with "Heading not found", add the heading first: `vault_append({ path: "...", content: "\n## Sessions\n" })`.

## Step 2: Review Session Work

Query the activity log to find all notes created or modified this session:

```
vault_activity({ limit: 1 })
```

The response header shows `current session: <id>` (an 8-character prefix). Use that prefix to filter:

```
vault_activity({ session: "<id-from-header>", limit: 50 })
```

Note which files were created, modified, and searched.

## Step 3: Capture Undocumented Work

Review the session's conversation for significant work that only exists in chat history:

| Found in conversation | Template | Default Path |
|---|---|---|
| Architecture/design decisions | `adr` | `<project>/development/decisions/ADR-NNN-{title}.md` |
| Research findings or evaluations | `research-note` | `<project>/research/{title}.md` |
| Complex debugging sessions | `troubleshooting-log` | `<project>/development/debug/{title}.md` |
| Reusable insights or patterns | `permanent-note` | `03-Resources/Development/{title}.md` |
| New tasks identified | `task` | `<project>/tasks/{title}.md` |

Where `<project>` is the vault project path from session context. See `pkm-create` Step 2 for the full mapping and Resources guidance.

**Use the pkm-create skill** for each note to get proper duplicate checking and linking.

Skip if the session was purely mechanical (config changes, minor fixes) with nothing worth documenting beyond the devlog.

## Step 4: Link Audit

Run a link health check on the project folder to find disconnected notes:

```
vault_link_health({ folder: "<project-folder>", checks: ["orphans", "weak"] })
```

Flag notes with **zero links** (orphans) or **only 1 link** (weak) — these are knowledge islands that need connections.

## Step 5: Patch Gaps

For each under-connected note found in Step 4:

```
vault_suggest_links({ path: "<under-connected-note>", limit: 5 })
```

If `vault_suggest_links` is unavailable (no `OPENAI_API_KEY`), use `vault_search` with the note's title and key terms, and `vault_query` with matching tags to find link candidates manually.

Then insert links using `vault_add_links`:

```
vault_add_links({
  path: "<under-connected-note>",
  links: [
    { target: "<path>", annotation: "relationship" }
  ]
})
```

## Step 6: Index Update

Check and update if changed during the session:
- **Project `_index.md`**: Add links to new ADRs, update project status, add key links
- **Relevant MOCs**: Add links to new notes that belong in topic index maps
