---
name: pkm-session-end
description: Use when wrapping up a work session — creates devlog entry, captures undocumented decisions/research/debugging, audits link health of session work, and updates project index. Primarily used via the devlog-updater agent.
---

# PKM Session End — Knowledge Capture and Graph Maintenance

Workflow for session wrap-up. When running as a subagent, the delegation prompt provides the project path and devlog boundary context. The agent's system prompt handles transcript discovery (Step 0) before this workflow begins.

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

Where `<project>` is the vault project path from session context. See `pkm-write` Step 2 for the full mapping and Resources guidance.

Follow the pkm-write creation workflow for each note to get proper duplicate checking and linking.

Skip if the session was purely mechanical (config changes, minor fixes) with nothing worth documenting beyond the devlog.

## Step 4: Quick Link Check

Run a targeted link health check on files touched during this session:

```
vault_link_health({ folder: "<project-folder>", checks: ["orphans", "broken"] })
```

For any **orphan** notes found (no connections), add links using `vault_add_links`. Broken links (pointing to non-existent files) may self-resolve if the missing notes were created earlier in this session — otherwise note them for manual review. For deeper audit (weak connections, ambiguous links, full vault scan), delegate to the link-auditor agent separately.

## Step 5: Index Update

Check and update if changed during the session:
- **Project `_index.md`**: Add links to new ADRs, update project status, add key links
- **Relevant MOCs**: Add links to new notes that belong in topic index maps
