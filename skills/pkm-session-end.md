---
name: pkm-session-end
description: Use when wrapping up a work session — creates devlog entry, captures undocumented decisions/research/debugging from conversation, audits link health of session work, and updates project index
---

# PKM Session End — Knowledge Capture and Graph Maintenance

Run this workflow when wrapping up a session to ensure no knowledge is lost and the graph stays healthy.

## Step 1: Devlog Entry

Append a session summary to the project devlog, most recent entry first:

```
vault_append({
  path: "01-Projects/<Project>/development/devlog.md",
  heading: "## Recent Activity",
  position: "after_heading",
  content: "## YYYY-MM-DD\n\n### Session Summary\n- <what was accomplished>\n\n### Key Decisions\n- <decisions made, link to ADRs if created>\n\n### Next Steps\n- <what remains>\n\n---\n"
})
```

Use the **actual date** and fill in real content from the session. Keep entries concise but specific.

## Step 2: Review Session Work

Query the activity log to find all notes created or modified this session:

```
vault_activity({ limit: 50 })
```

Filter to the current session's entries. Note which files were created, modified, and searched.

## Step 3: Capture Undocumented Work

Review the session's conversation for significant work that only exists in chat history:

| Found in conversation | Create with pkm-create |
|----------------------|----------------------|
| Architecture/design decisions | ADR (template: `adr`) |
| Research findings or evaluations | Research note (template: `research-note`) |
| Complex debugging sessions | Troubleshooting log (template: `troubleshooting-log`) |
| Reusable insights or patterns | Permanent note (template: `permanent-note`) |

**Use the pkm-create skill** for each note to get proper duplicate checking and linking.

Skip if the session was purely mechanical (config changes, minor fixes) with nothing worth documenting beyond the devlog.

## Step 4: Link Audit

For each note **created or significantly modified** this session:

1. Read the note (`vault_read` or `vault_peek`)
2. Check if it has a `## Related` section with actual links (not just the placeholder `- `)
3. Flag notes with **zero links** — these are knowledge islands, findable by search but invisible in the graph

## Step 5: Patch Gaps

For each under-connected note found in step 4:

```
vault_suggest_links({ path: "<under-connected-note>", limit: 5 })
```

Draft annotations and insert the top 3–5 links using:

```
vault_append({
  path: "<under-connected-note>",
  heading: "## Related",
  position: "end_of_section",
  content: "- [[target]] — annotation"
})
```

## Step 6: Index Update

Check and update if changed during the session:
- **Project `_index.md`**: Add links to new ADRs, update project status, add key links
- **Relevant MOCs**: Add links to new notes that belong in topic index maps
