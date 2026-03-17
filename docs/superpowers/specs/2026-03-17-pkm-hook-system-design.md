# PKM Hook System Design Spec

**Date:** 2026-03-17
**Status:** Draft
**Author:** Adrian + Claude

## Problem Statement

Currently, all PKM interaction in Claude Code sessions is explicit: Claude must be instructed (via CLAUDE.md) to read project context at session start and write findings/decisions/summaries during or after work. This creates cognitive load on the working Claude instance — it must remember to load context, identify PKM-worthy moments, compose structured vault notes, and manage templates — all while working on the actual task. This consumes context window tokens and attention that should go toward the primary work.

## Goal

Automate the read-at-start and write-continuously lifecycle so that:

1. **Session start:** Claude automatically receives project context (index, devlog, active tasks) without needing to call any tools
2. **Continuous passive capture:** Decisions, task changes, and research findings are extracted from the conversation and staged in the vault automatically — Claude never has to think about it
3. **Explicit capture:** When Claude is confident something is PKM-worthy, it can signal this with a single lightweight tool call. A background agent handles the structured note creation asynchronously — Claude doesn't wait
4. **No regression:** All 18 existing MCP tools remain exactly as-is. Claude can still call any of them manually at any time

## Non-Goals

- Replacing the existing MCP tools or their APIs
- Building a web UI for viewing captures
- Cross-project context (each session scopes to one project)
- Token cost tracking or budgeting
- Automatic devlog summarization at session end (passive sweep handles this incrementally)

## Architecture

```
                     Claude Code Session
                     ===================

  ┌─────────────────────────────────────────────────┐
  │                                                 │
  │  SessionStart hook [command]                    │
  │    session-start.js resolves cwd → project      │
  │    reads _index.md + devlog + tasks             │
  │    injects additionalContext                    │
  │                                                 │
  ├─────────────────────────────────────────────────┤
  │                                                 │
  │  Claude works normally...                       │
  │  All 18 MCP tools available as before           │
  │                                                 │
  │  ┌─────────────────────────────────┐            │
  │  │ Claude calls vault_capture()   │ ◄── explicit│
  │  │ Returns immediately: "queued"   │            │
  │  └──────────────┬──────────────────┘            │
  │                 │                               │
  │    PostToolUse [agent, Opus, async: true]        │
  │    Background: creates structured vault note    │
  │                                                 │
  ├─────────────────────────────────────────────────┤
  │                                                 │
  │  Stop hook [agent, Sonnet, async: true]         │
  │    Reads last exchange from transcript          │
  │    Extracts implicit captures → staging inbox   │
  │                                                 │
  └─────────────────────────────────────────────────┘
```

### Components

| # | Component | Hook Type | Model | Async | Trigger |
|---|-----------|-----------|-------|-------|---------|
| 1 | SessionStart context loader | `command` | N/A (Node script) | No (must complete before session) | `startup`, `clear` |
| 2 | Stop passive sweep | `agent` | `claude-sonnet-4-6` | Yes | Every Stop event |
| 3 | `vault_capture` MCP tool | N/A (MCP tool) | N/A | N/A (returns immediately) | Claude calls it explicitly |
| 4 | PostToolUse capture agent | `agent` | `claude-opus-4-6` | Yes | After `vault_capture` tool call |

## Component 1: SessionStart Hook

### Trigger

Fires on `startup` and `clear` matchers. Does **not** fire on `resume` (Claude already has prior context on resume).

### Resolution Logic

The script resolves the current working directory to a vault project in three steps:

1. **Basename match:** Read `cwd` from hook JSON stdin. List directories under `01-Projects/` in the vault. Case-insensitive match of `basename(cwd)` against project folder names.
2. **CLAUDE.md annotation fallback:** If no basename match, read `<cwd>/CLAUDE.md` and look for a `# PKM: <path>` line (e.g., `# PKM: 01-Projects/Obsidian-MCP`). This supports repos whose names don't match their vault project folder.
3. **Error notification:** If neither resolves, output a visible warning in `additionalContext`: "No vault project found for this repository. To fix: ensure your project folder name matches the repo name, or add `# PKM: 01-Projects/YourProject` to your project's CLAUDE.md."

### Context Loading

Once the project path is resolved, load:

- `{project}/_index.md` — full contents
- `{project}/development/devlog.md` — last 3 heading-level-2 sections (most recent activity)
- Active tasks: all `.md` files under `{project}/tasks/` with `status: active` or `status: pending` in frontmatter

### Output

Return JSON with `hookSpecificOutput.additionalContext` containing a formatted text block:

```
## PKM Project Context: {ProjectName}

### Project Index
{_index.md contents}

### Recent Development Activity
{last 3 devlog sections}

### Active Tasks
- {task title} (status: {status}, priority: {priority})
  {first 2 lines of description}
...
```

### Implementation

- File: `hooks/session-start.js` in this repo
- Imports `helpers.js` directly — reads vault files using the same functions the MCP server uses (no MCP protocol overhead)
- Requires `VAULT_PATH` environment variable (same as the MCP server)
- Node.js script, reads JSON from stdin, outputs JSON to stdout, exits 0

### Edge Cases

- Missing `_index.md`: skip that section, include others
- Missing devlog: skip that section, include others
- No tasks directory or no matching tasks: show "No active tasks"
- Vault path not configured: exit 0 with error in additionalContext
- Script errors: exit non-zero (non-blocking, session continues without context)

## Component 2: Stop Hook — Passive Sweep

### Trigger

Every `Stop` event. Runs with `async: true` so Claude and the user are not blocked.

### Transcript Processing

The agent receives `transcript_path` pointing to the session's JSONL transcript file. The agent prompt explicitly defines "current exchange" as:

> **One exchange = the last contiguous user message + the last contiguous assistant message at the end of the JSONL file.** Each line in the JSONL has a `role` field (`"user"` or `"assistant"`). Read the file, locate the final user message and the final assistant message. These two messages are the current exchange. All prior messages are historical context — they provide understanding of what is being discussed but must NOT be captured (they were already processed by previous Stop events).

### Extraction Criteria

The agent looks for three categories in the current exchange:

1. **Decisions:** Technical or architectural choices that were agreed upon (not proposed, not discussed — agreed). Example: "We decided to use sqlite-vec instead of Chroma."
2. **Task state changes:** New tasks identified, tasks marked complete, priorities changed, blockers discovered. Example: "The API refactor is done" or "We need to add input validation before release."
3. **Research findings:** Patterns discovered, gotchas found, library behaviors documented, approaches evaluated. Example: "Claude Code hooks only support `type: command` for SessionStart."

### Output Destination

Captures are appended to `00-Inbox/captures-YYYY-MM-DD.md` (a daily staging note). If the file doesn't exist, the agent creates it with minimal frontmatter:

```yaml
---
type: fleeting
created: YYYY-MM-DD
tags: [capture, auto]
---

# Captures — YYYY-MM-DD
```

Each capture entry is appended as:

```markdown
## HH:MM — {Category}: {Brief Title}

{1-3 sentence description}

**Source:** {project name}, session {session_id first 8 chars}

---
```

### Noise Suppression

The agent prompt includes explicit guidance:

> Be conservative. Skip: trivial exchanges (greetings, acknowledgments), back-and-forth clarifications that haven't resolved into a decision, implementation details that are obvious from the code diff, anything that restates what's already in the project context. When in doubt, don't capture. A missed capture is better than inbox noise.

### Model

`claude-sonnet-4-6`. If cost is a concern, can be downgraded to `claude-haiku-4-5-20251001`, but Sonnet's better judgment on "is this PKM-worthy?" is worth the cost difference.

## Component 3: `vault_capture` MCP Tool

### Purpose

A lightweight signaling tool that Claude calls when it explicitly identifies something PKM-worthy. The tool itself does minimal work — it validates inputs and returns immediately. The real work happens in the async PostToolUse agent hook (Component 4).

### Tool Definition

```javascript
{
  name: "vault_capture",
  description: "Signal that something is worth capturing in the PKM vault. " +
    "Returns immediately — a background agent handles the actual note creation. " +
    "Use this when you identify a decision, task, or research finding worth preserving.",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["adr", "task", "research", "bug"],
        description: "The type of capture: adr (decision), task, research (finding/pattern), bug (issue/fix)"
      },
      title: {
        type: "string",
        description: "Brief descriptive title (e.g., 'Use sqlite-vec over Chroma')"
      },
      content: {
        type: "string",
        description: "The substance of the capture — context, rationale, details. 1-5 sentences."
      },
      priority: {
        type: "string",
        enum: ["low", "normal", "high", "urgent"],
        description: "Priority level (tasks only, default: normal)"
      },
      project: {
        type: "string",
        description: "Project name for vault routing (e.g., 'Obsidian-MCP'). If omitted, inferred from session context."
      }
    },
    required: ["type", "title", "content"]
  }
}
```

### Handler Implementation

Minimal — validates required fields, returns acknowledgment:

```javascript
async function handleVaultCapture(args) {
  const { type, title, content } = args;
  if (!type || !title || !content) {
    throw new Error("vault_capture requires type, title, and content");
  }
  return {
    content: [{
      type: "text",
      text: `Capture queued: [${type}] ${title}`
    }]
  };
}
```

The tool does NOT write to the vault. That's the PostToolUse agent's job.

### Activity Logging

`vault_capture` calls are logged in the activity log like all other tools. This provides an audit trail of what was captured and when.

## Component 4: PostToolUse Agent Hook on `vault_capture`

### Trigger

Fires after every `vault_capture` tool call. Matcher: `mcp__obsidian-pkm__vault_capture`. Runs with `async: true` — Claude continues immediately.

### Agent Capabilities

The agent inherits the full MCP configuration, giving it access to all 18+ vault tools. It uses:

- `vault_query` — check for existing notes (deduplication, especially for tasks)
- `vault_write` — create new structured notes from templates
- `vault_update_frontmatter` — update existing task status/priority
- `vault_append` — add content to existing notes

### Agent Prompt

The agent receives `tool_input` (the arguments Claude passed to `vault_capture`) and `tool_response` in its context. Its prompt:

> You are a PKM note creation agent. You have received a capture signal from a Claude Code session. Using the vault tools available to you, create a properly structured vault note.
>
> **Instructions by capture type:**
>
> - **adr**: Use `vault_write` with template `adr`. Path: `01-Projects/{project}/development/decisions/ADR-NNN-{kebab-title}.md`. Determine the next ADR number by listing existing ADRs with `vault_list`. Expand the provided content into proper ADR sections (Context, Decision, Consequences).
> - **task**: First use `vault_query` to check if a task with a similar title already exists in the project. If it does, use `vault_update_frontmatter` to update its status/priority. If not, use `vault_write` with template `task`. Path: `01-Projects/{project}/tasks/{kebab-title}.md`.
> - **research**: Use `vault_write` with template `research-note`. Path: `01-Projects/{project}/research/{kebab-title}.md`. Structure the content into the template's sections.
> - **bug**: Use `vault_write` with template `troubleshooting-log`. Path: `01-Projects/{project}/development/debug/{kebab-title}.md`.
>
> If the `project` field is missing, check the most recent `vault_activity` entries to infer which project is active.

### Model

`claude-opus-4-6`. These captures are explicitly flagged as important by the working Claude instance, so the higher-quality model is justified for proper structuring, deduplication checking, and template expansion.

## Hook Configuration

The following JSON is added to `~/.claude/settings.json` under the `hooks` key:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear",
        "hooks": [
          {
            "type": "command",
            "command": "node /home/adrian/Projects/Obsidian-MCP/hooks/session-start.js",
            "timeout": 15,
            "statusMessage": "Loading PKM project context..."
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "agent",
            "model": "claude-sonnet-4-6",
            "async": true,
            "timeout": 120,
            "prompt": "You are a PKM passive capture agent. Your job is to identify decisions, task changes, and research findings from the most recent conversation exchange and append them to the vault staging inbox.\n\n## Transcript Processing\n\nRead the transcript JSONL file. Find the LAST user message and LAST assistant message at the end of the file — these are the current exchange. All prior messages are historical context only. Do NOT capture anything from prior messages.\n\n## What to Capture\n\n1. **Decisions**: Technical or architectural choices that were AGREED upon (not proposed, not still being discussed)\n2. **Task changes**: New tasks identified, tasks completed, priority changes, blockers discovered\n3. **Research findings**: Patterns discovered, library behaviors documented, gotchas found\n\n## Noise Suppression\n\nBe conservative. Skip: trivial exchanges, clarification Q&A that hasn't resolved, implementation details obvious from code, anything restating existing project context. When in doubt, don't capture.\n\n## Output\n\nIf you find PKM-worthy content, use vault_append to add entries to 00-Inbox/captures-{today's date YYYY-MM-DD}.md. If the file doesn't exist, create it first with vault_write (type: fleeting, tags: [capture, auto]). Each entry format:\n\n## HH:MM — {Category}: {Title}\n\n{1-3 sentence description}\n\n---\n\nIf nothing is PKM-worthy, do nothing."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "mcp__obsidian-pkm__vault_capture",
        "hooks": [
          {
            "type": "agent",
            "model": "claude-opus-4-6",
            "async": true,
            "timeout": 120,
            "prompt": "You are a PKM note creation agent. A Claude Code session has explicitly signaled that something is worth capturing. The tool_input contains: type, title, content, and optionally priority and project.\n\nUsing the vault tools available to you, create a properly structured vault note:\n\n- **adr**: vault_write with template 'adr'. Path: 01-Projects/{project}/development/decisions/ADR-NNN-{kebab-title}.md. List existing ADRs to determine next number. Expand content into Context, Decision, Consequences sections.\n- **task**: First vault_query to check for existing task with similar title. If exists, vault_update_frontmatter to update. If not, vault_write with template 'task'. Path: 01-Projects/{project}/tasks/{kebab-title}.md.\n- **research**: vault_write with template 'research-note'. Path: 01-Projects/{project}/research/{kebab-title}.md.\n- **bug**: vault_write with template 'troubleshooting-log'. Path: 01-Projects/{project}/development/debug/{kebab-title}.md.\n\nIf project is not specified, check vault_activity recent entries to infer the active project.\n\nAlways verify the note was created successfully. If vault_write fails (e.g., file exists), adapt — use vault_append or choose a different filename."
          }
        ]
      }
    ]
  }
}
```

## CLAUDE.md Addition

Add the following to the global `~/.claude/CLAUDE.md` under a new section:

```markdown
### PKM Hooks (Automatic Context)

PKM project context is automatically loaded at session start via hooks. You do not need to manually call vault_read for _index.md, devlog, or active tasks — this is already in your context.

A passive sweep agent runs after each response to capture implicit decisions, tasks, and findings. You do not need to remember to update the devlog or capture notes manually for routine discoveries.

**When to use `vault_capture`:** Call this tool when you are confident something is PKM-worthy and want it created as a proper structured note (ADR, task, research note, or bug report). The tool returns immediately — a background Opus agent handles the actual note creation. Use this for:
- Significant decisions agreed upon with the user
- New tasks or task completions that should be tracked
- Research findings that will be useful in future sessions
- Bug investigations worth documenting

**When NOT to use `vault_capture`:** Don't use it for minor observations, incremental progress, or things already captured by the passive sweep. The passive sweep handles routine captures — `vault_capture` is for explicitly important items.

**You can still call all vault tools directly** (vault_write, vault_append, etc.) when you need precise control over note creation, editing, or querying.
```

## New Files

| File | Purpose |
|------|---------|
| `hooks/session-start.js` | SessionStart command hook — resolves project, loads context |
| `hooks/README.md` | Setup instructions with hook config snippets |
| Addition to `index.js` | `vault_capture` tool definition |
| Addition to `handlers.js` | `vault_capture` handler (validation + "queued" response) |

## Safety & Edge Cases

### Recursion Prevention

- Agent hooks spawned by Stop trigger `SubagentStop`, not `Stop` — no infinite loop
- Agent hooks spawned by PostToolUse trigger `SubagentStop`, not PostToolUse — no infinite loop
- The `stop_hook_active` flag is available in the Stop event input as an additional guard

### Concurrent Write Safety

- Stop passive sweep writes to `00-Inbox/captures-YYYY-MM-DD.md` (staging)
- PostToolUse capture agent writes to `01-Projects/{project}/...` (structured notes)
- Different destinations — no file-level race condition between the two agents

### Idempotency

- Each Stop event processes only the most recent exchange (last user+assistant turn pair)
- If Stop fires multiple times rapidly (unlikely), each processes its own exchange — no duplication since the transcript grows monotonically

### Graceful Degradation

- If SessionStart script fails (exit non-zero): session continues without PKM context, non-blocking error shown in verbose mode
- If Stop agent fails: session is unaffected (async, non-blocking)
- If PostToolUse agent fails: Claude already received "queued" acknowledgment and continued. The failure is silent unless the user checks the vault
- Missing vault_capture project field: agent infers from vault_activity

### Cost Considerations

- **SessionStart:** Free (Node script, no AI)
- **Stop passive sweep (Sonnet):** Runs on every response. Cost proportional to session length. For a typical session with 20 exchanges, ~20 Sonnet agent invocations. Most will find nothing and exit quickly.
- **PostToolUse capture (Opus):** Only runs when Claude explicitly calls `vault_capture`. Expect 1-5 per significant session. Higher per-invocation cost but very low frequency.

## Testing Strategy

1. **session-start.js unit tests:** Test project resolution logic (basename match, CLAUDE.md fallback, error case) with mock vault directories
2. **vault_capture handler tests:** Test input validation, response format
3. **Integration tests:** Manual testing with a real vault — verify SessionStart injects context, Stop writes captures, vault_capture triggers background agent
4. **Hook config validation:** Verify the JSON config is accepted by Claude Code's hook system

## Open Questions

1. **Stop hook frequency:** Should the passive sweep run on literally every Stop event, or should there be a debounce/cooldown (e.g., skip if last sweep was < 2 minutes ago)? Initial implementation: every Stop. Adjust if cost/noise is an issue.
2. **Capture promotion workflow:** How should users review and promote captures from `00-Inbox/captures-*.md` to proper notes? For now, this is manual (or Claude does it when asked). Could be automated later.
3. **Multi-project sessions:** If the user switches to a different repo mid-session, SessionStart doesn't re-fire. The Stop agent would continue writing to the inbox. Is this acceptable, or should there be mid-session project detection?
