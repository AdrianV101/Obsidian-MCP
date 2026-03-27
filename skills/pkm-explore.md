---
name: pkm-explore
description: Use when researching what the vault knows about a topic — performs graph + semantic exploration with gap analysis to map existing knowledge and find missing connections. Primarily used via the vault-explorer agent. Not for routine session-start context loading (hooks handle that).
---

# PKM Explore — Knowledge Discovery and Gap Analysis

Understand what the vault already knows about a topic before creating new notes or doing research. Combines graph traversal with semantic search to find both explicit connections and hidden relationships.

**When to use**: Researching vault knowledge on a topic, finding related notes, exploring a topic area before writing.

## Step 1: Identify Seed Note

Find the most relevant existing note for the topic:

```
vault_semantic_search({ query: "<topic>", limit: 5 })
```

- If a specific note path was provided, use that directly as the seed
- Otherwise, pick the highest-scoring result as the seed
- If **no relevant notes** exist (all scores < 0.3), report that the vault has minimal coverage and suggest creating a seed note using pkm-write

If `vault_semantic_search` is unavailable (no `OPENAI_API_KEY`), use `vault_search` with key terms and `vault_query` by tags/type to locate a seed note.

## Step 2: Graph Context

Explore the structural neighborhood around the seed note:

```
vault_neighborhood({ path: "<seed-note-path>", depth: 2, direction: "both" })
```

This reveals the **intentional** knowledge structure — what someone explicitly linked. If the seed note has no links (new or isolated note), this is expected — rely on Step 3 results for connection discovery. If `vault_neighborhood` returns an error (e.g., 'File not found'), the seed note may have been deleted or the path misresolved — try the next-best result from Step 1, or verify with `vault_search`.

## Step 3: Semantic Expansion

Search for conceptually related notes that may not be in the graph:

```
vault_semantic_search({ query: "<topic>", limit: 10 })
```

If `vault_semantic_search` is unavailable (no `OPENAI_API_KEY`), use `vault_search` with multiple keyword variations and `vault_query` with relevant tags.

## Step 4: Gap Analysis

Compare the graph results (step 2) with semantic results (step 3):

| Category | Meaning | Action |
|----------|---------|--------|
| In graph AND semantic | Well-connected, established knowledge | No action needed |
| In graph but NOT semantic | Structurally linked but topically distant | May indicate weak/outdated link |
| **In semantic but NOT graph** | **Missing links** — conceptually related but unconnected | **Highest-value findings** — suggest linking |

**Note**: If Step 3 used `vault_search`/`vault_query` (no `OPENAI_API_KEY`), the gap analysis is less precise — text search misses conceptually related notes that use different terminology. Flag this reduced fidelity when presenting findings.

## Step 5: Synthesize

Return findings organized as:

1. **What exists**: Key notes on this topic with brief summaries (type, status, tags)
2. **How it's connected**: Graph structure — which notes link to which, at what depth
3. **Missing links**: Conceptually related notes not yet in the graph (candidates for linking — note reduced precision if semantic search was unavailable)
4. **Knowledge gaps**: Topics referenced but not covered by any note — candidates for new notes via pkm-write
