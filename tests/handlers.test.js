import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createHandlers } from "../handlers.js";

let tmpDir;
let handlers;

const TEMPLATE_CONTENT = `---
type: research
created: <% tp.date.now("YYYY-MM-DD") %>
tags:
  - research
---
# <% tp.file.title %>

## What It Is
<!-- Describe -->
`;

const ADR_TEMPLATE = `---
type: adr
status: proposed
created: <% tp.date.now("YYYY-MM-DD") %>
tags:
  - decision
  - architecture
deciders:
---
# ADR-XXX: <% tp.file.title %>

## Context
<!-- Why -->

## Decision
<!-- What -->
`;

const TASK_TEMPLATE = `---
type: task
created: <% tp.date.now("YYYY-MM-DD") %>
status: pending
priority: normal
due: null
project: null
source: null
tags:
  - task
---

# <% tp.file.title %>

## Description


## Context


## Acceptance Criteria

`;

/**
 * Helper to build a template registry from the given tmpDir.
 * Mimics what index.js does at startup.
 */
async function buildTemplateRegistry(tmpDir) {
  const templateRegistry = new Map();
  const tdir = path.join(tmpDir, "05-Templates");
  for (const file of await fs.readdir(tdir)) {
    const name = path.basename(file, ".md");
    const content = await fs.readFile(path.join(tdir, file), "utf-8");
    templateRegistry.set(name, { content, description: name });
  }
  return templateRegistry;
}

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "handlers-test-"));

  // Set up template directory
  const templateDir = path.join(tmpDir, "05-Templates");
  await fs.mkdir(templateDir, { recursive: true });
  await fs.writeFile(path.join(templateDir, "research-note.md"), TEMPLATE_CONTENT);
  await fs.writeFile(path.join(templateDir, "adr.md"), ADR_TEMPLATE);
  await fs.writeFile(path.join(templateDir, "task.md"), TASK_TEMPLATE);

  // Create some test notes
  const notesDir = path.join(tmpDir, "notes");
  await fs.mkdir(notesDir, { recursive: true });

  await fs.writeFile(path.join(notesDir, "devlog.md"), `---
type: devlog
created: 2026-01-01
tags:
  - dev
---
# Project Devlog

## 2026-01-01

First entry.

## 2026-01-15

Second entry.

### Sub-detail

Some detail.

## 2026-02-01

Third entry.
`);

  await fs.writeFile(path.join(notesDir, "alpha.md"), `---
type: research
status: active
created: 2026-01-15
tags:
  - dev
  - mcp
---
# Alpha Note

Some content about [[beta]] and the MCP server.
Also references [[gamma|Gamma Note]].
`);

  await fs.writeFile(path.join(notesDir, "beta.md"), `---
type: adr
status: accepted
created: 2026-02-01
tags:
  - decision
  - architecture
---
# Beta Note

Links to [[alpha]] and contains architecture decisions.
`);

  await fs.writeFile(path.join(notesDir, "gamma.md"), `---
type: permanent
status: active
created: 2025-12-01
tags:
  - knowledge
---
# Gamma Note

A permanent note with no outgoing links.
`);

  // Create nested directory for fuzzy folder testing
  const projectDir = path.join(tmpDir, "projects", "my-app", "research");
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, "findings.md"), `---
type: research
created: 2026-01-01
tags:
  - research
  - project
---
# Research Findings
`);

  // Create files for ambiguity testing
  const otherDir = path.join(tmpDir, "other");
  await fs.mkdir(otherDir, { recursive: true });
  await fs.writeFile(path.join(otherDir, "index.md"), `---
type: fleeting
created: 2026-01-01
tags:
  - test
---
# Other Index
`);
  await fs.writeFile(path.join(notesDir, "index.md"), `---
type: fleeting
created: 2026-01-01
tags:
  - test
---
# Notes Index
`);

  // ── Notes for trash/move testing ──
  const moveDir = path.join(tmpDir, "moveable");
  await fs.mkdir(moveDir, { recursive: true });

  await fs.writeFile(path.join(moveDir, "target.md"), `---
type: research
created: 2026-01-01
tags:
  - test
---
# Target Note

Content of the target note.
`);

  await fs.writeFile(path.join(moveDir, "linker-a.md"), `---
type: fleeting
created: 2026-01-01
tags:
  - test
---
# Linker A

This links to [[target]] and also [[target#heading]].
`);

  await fs.writeFile(path.join(moveDir, "linker-b.md"), `---
type: fleeting
created: 2026-01-01
tags:
  - test
---
# Linker B

This links to [[target|Target Display]] and [[gamma]].
`);

  // A file with no incoming links (safe to trash)
  await fs.writeFile(path.join(moveDir, "orphan.md"), `---
type: fleeting
created: 2026-01-01
tags:
  - test
---
# Orphan Note

No other file links here.
`);

  // A destination file for collision testing (in .trash/)
  const trashDir = path.join(tmpDir, ".trash", "moveable");
  await fs.mkdir(trashDir, { recursive: true });
  await fs.writeFile(path.join(trashDir, "orphan.md"), "previously trashed");

  // Create large test files for auto-redirect and chunk testing
  const largeContent = "---\ntype: research\ncreated: 2026-01-01\ntags:\n  - test\n---\n# Large File\n\n## Section A\n\n" +
    "x".repeat(90_000) + "\n\n## Section B\n\nSmall section content.\n";
  await fs.writeFile(path.join(notesDir, "large-file.md"), largeContent);

  const headinglessLines = Array.from({ length: 5000 }, (_, i) => `Line ${i + 1}: ${"data ".repeat(20)}`);
  const headinglessContent = "---\ntype: dump\ncreated: 2026-01-01\ntags:\n  - test\n---\n" + headinglessLines.join("\n") + "\n";
  await fs.writeFile(path.join(notesDir, "headingless-large.md"), headinglessContent);

  // ── Task notes for query sort/filter testing ──
  const tasksDir = path.join(tmpDir, "tasks");
  await fs.mkdir(tasksDir, { recursive: true });

  await fs.writeFile(path.join(tasksDir, "task-a.md"), `---
type: task
status: pending
priority: high
due: "2026-03-01"
project: Supergrant
created: 2026-02-08
tags:
  - task
---
# Task A
`);

  await fs.writeFile(path.join(tasksDir, "task-b.md"), `---
type: task
status: done
priority: low
due: "2026-02-15"
project: Home
created: 2026-02-09
tags:
  - task
---
# Task B
`);

  await fs.writeFile(path.join(tasksDir, "task-c.md"), `---
type: task
status: pending
priority: urgent
created: 2026-02-10
tags:
  - task
---
# Task C - no due date
`);

  // Build template registry (mimicking what index.js does)
  const templateRegistry = await buildTemplateRegistry(tmpDir);

  handlers = await createHandlers({
    vaultPath: tmpDir,
    templateRegistry,
    semanticIndex: null,
    activityLog: null,
    sessionId: "test-session-id-1234",
  });
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

// ─── vault_read ────────────────────────────────────────────────────────

describe("handleRead", () => {
  it("reads an existing file", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/alpha.md" });
    assert.equal(result.content[0].type, "text");
    assert.ok(result.content[0].text.includes("# Alpha Note"));
  });

  it("throws on non-existent file", async () => {
    const handler = handlers.get("vault_read");
    await assert.rejects(() => handler({ path: "notes/nonexistent.md" }), /not found|No matching file/i);
  });

  it("throws on directory traversal", async () => {
    const handler = handlers.get("vault_read");
    await assert.rejects(() => handler({ path: "../etc/passwd" }), /not found|escapes vault/i);
  });

  it("returns full content when no pagination params given (regression)", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/devlog.md" });
    const text = result.content[0].text;
    assert.ok(text.includes("# Project Devlog"));
    assert.ok(text.includes("## 2026-01-01"));
    assert.ok(text.includes("## 2026-02-01"));
  });

  it("reads a specific section with heading param", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/devlog.md", heading: "## 2026-01-15" });
    const text = result.content[0].text;
    assert.ok(text.includes("## 2026-01-15"));
    assert.ok(text.includes("Second entry."));
    assert.ok(text.includes("### Sub-detail"));
    assert.ok(!text.includes("First entry."));
    assert.ok(!text.includes("Third entry."));
  });

  it("returns error with available headings when heading not found", async () => {
    const handler = handlers.get("vault_read");
    await assert.rejects(
      () => handler({ path: "notes/devlog.md", heading: "## Nonexistent" }),
      (err) => {
        assert.ok(err.message.includes("Heading not found"));
        assert.ok(err.message.includes("## 2026-01-01"));
        assert.ok(err.message.includes("## 2026-02-01"));
        return true;
      }
    );
  });

  it("returns last N lines with tail param, with frontmatter prepended", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/devlog.md", tail: 3 });
    const text = result.content[0].text;
    assert.ok(text.startsWith("---"), "Should start with frontmatter");
    assert.ok(text.includes("type: devlog"));
    assert.ok(text.includes("Third entry."));
    assert.ok(!text.includes("First entry."));
  });

  it("returns last N sections with tail_sections param", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/devlog.md", tail_sections: 2 });
    const text = result.content[0].text;
    assert.ok(text.startsWith("---"), "Should start with frontmatter");
    assert.ok(text.includes("## 2026-01-15"));
    assert.ok(text.includes("## 2026-02-01"));
    assert.ok(!text.includes("## 2026-01-01"));
  });

  it("tail_sections respects custom section_level", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/devlog.md", tail_sections: 1, section_level: 1 });
    const text = result.content[0].text;
    assert.ok(text.includes("# Project Devlog"));
    assert.ok(text.includes("## 2026-01-01"));
  });

  it("rejects heading + tail (mutual exclusivity)", async () => {
    const handler = handlers.get("vault_read");
    await assert.rejects(
      () => handler({ path: "notes/devlog.md", heading: "## 2026-01-01", tail: 5 }),
      /Only one of/
    );
  });

  it("rejects tail + tail_sections (mutual exclusivity)", async () => {
    const handler = handlers.get("vault_read");
    await assert.rejects(
      () => handler({ path: "notes/devlog.md", tail: 5, tail_sections: 2 }),
      /Only one of/
    );
  });
});

// ─── vault_read chunk param ──────────────────────────────────────────

describe("handleRead chunk param", () => {
  it("reads chunk 1 of a large file", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/large-file.md", chunk: 1 });
    const text = result.content[0].text;
    assert.ok(text.includes("Chunk 1 of"));
    assert.ok(text.includes("# Large File"));
  });

  it("reads chunk 2 of a large file", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/large-file.md", chunk: 2 });
    const text = result.content[0].text;
    assert.ok(text.includes("Chunk 2 of"));
  });

  it("chunk 1 on a small file returns entire content", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/alpha.md", chunk: 1 });
    const text = result.content[0].text;
    assert.ok(text.includes("Chunk 1 of 1"));
    assert.ok(text.includes("# Alpha Note"));
  });

  it("throws on chunk 0", async () => {
    const handler = handlers.get("vault_read");
    await assert.rejects(
      () => handler({ path: "notes/large-file.md", chunk: 0 }),
      /Invalid chunk/
    );
  });

  it("throws on chunk exceeding total", async () => {
    const handler = handlers.get("vault_read");
    await assert.rejects(
      () => handler({ path: "notes/large-file.md", chunk: 999 }),
      /Invalid chunk/
    );
  });

  it("rejects chunk combined with heading (mutual exclusivity)", async () => {
    const handler = handlers.get("vault_read");
    await assert.rejects(
      () => handler({ path: "notes/alpha.md", chunk: 1, heading: "# Alpha Note" }),
      /Only one of/
    );
  });

  it("rejects chunk combined with tail (mutual exclusivity)", async () => {
    const handler = handlers.get("vault_read");
    await assert.rejects(
      () => handler({ path: "notes/alpha.md", chunk: 1, tail: 5 }),
      /Only one of/
    );
  });
});

// ─── vault_read lines param ─────────────────────────────────────────

describe("handleRead lines param", () => {
  it("reads a line range", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/headingless-large.md", lines: { start: 7, end: 11 } });
    const text = result.content[0].text;
    assert.ok(text.includes("Lines 7-11"));
    assert.ok(text.includes("Line 1:"));  // line 7 of file = "Line 1: data data..."
  });

  it("clamps end beyond file length", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/alpha.md", lines: { start: 1, end: 99999 } });
    const text = result.content[0].text;
    assert.ok(text.includes("Lines 1-"));
    assert.ok(text.includes("# Alpha Note"));
  });

  it("reads a single line when start equals end", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/alpha.md", lines: { start: 1, end: 1 } });
    const text = result.content[0].text;
    assert.ok(text.includes("Lines 1-1"));
  });

  it("throws on start < 1", async () => {
    const handler = handlers.get("vault_read");
    await assert.rejects(
      () => handler({ path: "notes/alpha.md", lines: { start: 0, end: 5 } }),
      /Invalid line range/
    );
  });

  it("throws on start > end", async () => {
    const handler = handlers.get("vault_read");
    await assert.rejects(
      () => handler({ path: "notes/alpha.md", lines: { start: 10, end: 5 } }),
      /Invalid line range/
    );
  });

  it("throws on start beyond file length", async () => {
    const handler = handlers.get("vault_read");
    await assert.rejects(
      () => handler({ path: "notes/alpha.md", lines: { start: 99999, end: 100000 } }),
      /Invalid line range/
    );
  });

  it("rejects lines combined with chunk (mutual exclusivity)", async () => {
    const handler = handlers.get("vault_read");
    await assert.rejects(
      () => handler({ path: "notes/alpha.md", lines: { start: 1, end: 5 }, chunk: 1 }),
      /Only one of/
    );
  });
});

// ─── vault_read auto-redirect ────────────────────────────────────────

describe("handleRead auto-redirect", () => {
  it("auto-redirects to peek for large files without pagination params", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/large-file.md" });
    const text = result.content[0].text;
    // Should contain peek data, not raw content
    assert.ok(text.includes("Section A"));
    assert.ok(text.includes("Section B"));
    assert.ok(text.includes("auto-read threshold") || text.includes("exceeds"));
    // Should NOT contain bulk filler content (preview truncates lines to 200 chars)
    assert.ok(!text.includes("x".repeat(500)));
  });

  it("does NOT auto-redirect when heading param is given", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/large-file.md", heading: "## Section B" });
    const text = result.content[0].text;
    assert.ok(text.includes("Small section content."));
    assert.ok(!text.includes("auto-read threshold"));
  });

  it("does NOT auto-redirect when chunk param is given", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/large-file.md", chunk: 1 });
    const text = result.content[0].text;
    assert.ok(text.includes("Chunk 1 of"));
    assert.ok(!text.includes("auto-read threshold"));
  });

  it("does NOT auto-redirect when tail param is given", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/large-file.md", tail: 5 });
    const text = result.content[0].text;
    assert.ok(!text.includes("auto-read threshold"));
  });

  it("does NOT auto-redirect for small files", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/alpha.md" });
    const text = result.content[0].text;
    assert.ok(text.includes("# Alpha Note"));
    assert.ok(!text.includes("auto-read threshold"));
  });

  it("auto-redirects headingless large files with chunk guidance", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/headingless-large.md" });
    const text = result.content[0].text;
    assert.ok(text.includes("auto-read threshold") || text.includes("exceeds"));
    assert.ok(text.includes("chunk"));
  });
});

// ─── vault_read force param ─────────────────────────────────────────

describe("handleRead force param", () => {
  it("force=true returns full content for large file within hard cap", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/large-file.md", force: true });
    const text = result.content[0].text;
    assert.ok(text.length > 80000);
    assert.ok(!text.includes("auto-read threshold"));
  });

  it("force=true on small file returns content normally", async () => {
    const handler = handlers.get("vault_read");
    const result = await handler({ path: "notes/alpha.md", force: true });
    const text = result.content[0].text;
    assert.ok(text.includes("# Alpha Note"));
  });
});

// ─── fuzzy path resolution (read tools) ─────────────────────────────

describe("fuzzy path resolution (read tools)", () => {
  it("vault_read resolves basename without extension", async () => {
    const read = handlers.get("vault_read");
    const result = await read({ path: "alpha" });
    assert.match(result.content[0].text, /Alpha Note/);
  });

  it("vault_read resolves basename with .md extension", async () => {
    const read = handlers.get("vault_read");
    const result = await read({ path: "alpha.md" });
    assert.match(result.content[0].text, /Alpha Note/);
  });

  it("vault_read still works with exact path", async () => {
    const read = handlers.get("vault_read");
    const result = await read({ path: "notes/alpha.md" });
    assert.match(result.content[0].text, /Alpha Note/);
  });

  it("vault_read throws on ambiguous basename", async () => {
    await assert.rejects(
      () => handlers.get("vault_read")({ path: "index" }),
      (err) => {
        assert.match(err.message, /matches \d+ files/);
        return true;
      }
    );
  });

  it("vault_links resolves fuzzy path", async () => {
    const links = handlers.get("vault_links");
    const result = await links({ path: "alpha" });
    assert.ok(result.content[0].text);
  });

  it("vault_neighborhood resolves fuzzy path", async () => {
    const neighborhood = handlers.get("vault_neighborhood");
    const result = await neighborhood({ path: "alpha", depth: 1 });
    assert.match(result.content[0].text, /alpha/);
  });
});

// ─── fuzzy folder resolution ─────────────────────────────────────────

describe("fuzzy folder resolution", () => {
  it("vault_search resolves exact folder name", async () => {
    const search = handlers.get("vault_search");
    const result = await search({ query: "Devlog", folder: "notes" });
    assert.match(result.content[0].text, /devlog/);
  });

  it("vault_query resolves exact folder name", async () => {
    const query = handlers.get("vault_query");
    const result = await query({ type: "devlog", folder: "notes" });
    assert.match(result.content[0].text, /devlog/);
  });

  it("vault_recent resolves exact folder name", async () => {
    const recent = handlers.get("vault_recent");
    const result = await recent({ folder: "notes" });
    assert.match(result.content[0].text, /\.md/);
  });

  it("vault_tags resolves exact folder name", async () => {
    const tags = handlers.get("vault_tags");
    const result = await tags({ folder: "notes" });
    assert.match(result.content[0].text, /dev/);
  });

  it("vault_search resolves partial folder name (fuzzy)", async () => {
    const search = handlers.get("vault_search");
    // "my-app" should resolve to "projects/my-app" via substring match
    const result = await search({ query: "Findings", folder: "my-app" });
    assert.match(result.content[0].text, /findings/);
  });

  it("vault_query resolves partial folder name (fuzzy)", async () => {
    const query = handlers.get("vault_query");
    const result = await query({ type: "research", folder: "my-app" });
    assert.match(result.content[0].text, /findings/);
  });

  it("vault_search rejects unknown folder", async () => {
    const search = handlers.get("vault_search");
    await assert.rejects(
      () => search({ query: "test", folder: "nonexistent-folder-xyz" }),
      (err) => {
        assert.match(err.message, /not found|No matching|ENOENT/i);
        return true;
      }
    );
  });

  it("folder resolution rejects directory traversal", async () => {
    const search = handlers.get("vault_search");
    await assert.rejects(
      () => search({ query: "test", folder: "../../etc" }),
      /escapes vault/
    );
  });
});

// ─── vault_write ───────────────────────────────────────────────────────

describe("handleWrite", () => {
  let writeCount = 0;
  function uniquePath() {
    return `output/write-test-${++writeCount}.md`;
  }

  it("creates a note from a template", async () => {
    const handler = handlers.get("vault_write");
    const outPath = uniquePath();
    const result = await handler({
      template: "research-note",
      path: outPath,
      frontmatter: { tags: ["test"] },
    });

    assert.ok(result.content[0].text.includes("Created"));
    assert.ok(result.content[0].text.includes("research-note"));

    // Verify file was written
    const content = await fs.readFile(path.join(tmpDir, outPath), "utf-8");
    assert.ok(content.includes("type: research"));
    assert.ok(content.includes("tags:"));
  });

  it("substitutes template variables", async () => {
    const handler = handlers.get("vault_write");
    const outPath = uniquePath();
    await handler({
      template: "research-note",
      path: outPath,
      frontmatter: { tags: ["test"] },
    });

    const content = await fs.readFile(path.join(tmpDir, outPath), "utf-8");
    // tp.date.now should be substituted with today's date
    const today = new Date().toISOString().split("T")[0];
    assert.ok(content.includes(today));
    // tp.file.title should be the filename without .md
    const expectedTitle = path.basename(outPath, ".md");
    assert.ok(content.includes(expectedTitle));
  });

  it("rejects unknown template", async () => {
    const handler = handlers.get("vault_write");
    await assert.rejects(
      () => handler({ template: "nonexistent", path: "out.md", frontmatter: { tags: ["x"] } }),
      /not found/
    );
  });

  it("rejects if file already exists", async () => {
    const handler = handlers.get("vault_write");
    await assert.rejects(
      () => handler({ template: "research-note", path: "notes/alpha.md", frontmatter: { tags: ["x"] } }),
      /already exists/
    );
  });

  it("creates parent directories when createDirs is true", async () => {
    const handler = handlers.get("vault_write");
    const outPath = `deep/nested/dir/${uniquePath()}`;
    await handler({
      template: "research-note",
      path: outPath,
      frontmatter: { tags: ["nested"] },
    });
    const stat = await fs.stat(path.join(tmpDir, outPath));
    assert.ok(stat.isFile());
  });

  it("merges frontmatter overrides", async () => {
    const handler = handlers.get("vault_write");
    const outPath = uniquePath();
    await handler({
      template: "adr",
      path: outPath,
      frontmatter: { tags: ["custom-tag"], deciders: "The Team" },
    });

    const content = await fs.readFile(path.join(tmpDir, outPath), "utf-8");
    assert.ok(content.includes("custom-tag"));
    assert.ok(content.includes("The Team"));
  });

  it("creates a task note with custom frontmatter fields", async () => {
    const result = await handlers.get("vault_write")({
      template: "task",
      path: "tasks/buy-groceries.md",
      frontmatter: {
        tags: ["task", "grocery"],
        status: "pending",
        priority: "high",
        project: "Home",
        source: "telegram",
      }
    });
    const content = await fs.readFile(path.join(tmpDir, "tasks/buy-groceries.md"), "utf-8");
    assert.ok(content.includes("type: task"));
    assert.ok(content.includes("priority: high"));
    assert.ok(content.includes("project: Home"));
    assert.ok(content.includes("source: telegram"));
    assert.ok(content.includes("## Description"));
    assert.ok(result.content[0].text.includes("task"));
  });
});

// ─── vault_append ──────────────────────────────────────────────────────

describe("handleAppend", () => {
  let appendFile;

  beforeEach(async () => {
    appendFile = `notes/append-${Date.now()}-${Math.random().toString(36).slice(2)}.md`;
    await fs.writeFile(path.join(tmpDir, appendFile), `---
type: research
created: 2026-01-01
tags:
  - test
---
# Test Note

## Section One

Some content here.

## Section Two

More content.
`);
  });

  it("appends to end of file when no heading given", async () => {
    const handler = handlers.get("vault_append");
    await handler({ path: appendFile, content: "New stuff" });

    const content = await fs.readFile(path.join(tmpDir, appendFile), "utf-8");
    assert.ok(content.includes("\nNew stuff"));
  });

  it("appends after a heading by default", async () => {
    const handler = handlers.get("vault_append");
    await handler({ path: appendFile, heading: "## Section One", content: "Inserted line" });

    const content = await fs.readFile(path.join(tmpDir, appendFile), "utf-8");
    const lines = content.split("\n");
    const headingIdx = lines.findIndex(l => l === "## Section One");
    assert.equal(lines[headingIdx + 1], "Inserted line");
  });

  it("inserts before heading with position=before_heading", async () => {
    const handler = handlers.get("vault_append");
    await handler({
      path: appendFile,
      heading: "## Section Two",
      position: "before_heading",
      content: "Before section two",
    });

    const content = await fs.readFile(path.join(tmpDir, appendFile), "utf-8");
    const idx = content.indexOf("Before section two");
    const headingIdx = content.indexOf("## Section Two");
    assert.ok(idx < headingIdx);
  });

  it("inserts at end of section with position=end_of_section", async () => {
    const handler = handlers.get("vault_append");
    await handler({
      path: appendFile,
      heading: "## Section One",
      position: "end_of_section",
      content: "End of section one",
    });

    const content = await fs.readFile(path.join(tmpDir, appendFile), "utf-8");
    const endIdx = content.indexOf("End of section one");
    const sec2Idx = content.indexOf("## Section Two");
    assert.ok(endIdx < sec2Idx, "Should be before Section Two heading");

    const oneIdx = content.indexOf("Some content here.");
    assert.ok(endIdx > oneIdx, "Should be after existing section content");
  });

  it("throws when position given without heading", async () => {
    const handler = handlers.get("vault_append");
    await assert.rejects(
      () => handler({ path: appendFile, position: "after_heading", content: "x" }),
      /heading.*required/i
    );
  });

  it("throws when heading not found", async () => {
    const handler = handlers.get("vault_append");
    await assert.rejects(
      () => handler({ path: appendFile, heading: "## Nonexistent", position: "after_heading", content: "x" }),
      /Heading not found/
    );
  });

  it("throws on non-existent file", async () => {
    const handler = handlers.get("vault_append");
    await assert.rejects(
      () => handler({ path: "notes/no-such-file.md", content: "x" }),
      /File not found/
    );
  });

  it("throws on unknown position value instead of writing undefined", async () => {
    const handler = handlers.get("vault_append");
    await assert.rejects(
      () => handler({ path: appendFile, heading: "## Section One", position: "invalid_position", content: "x" }),
      /Unknown position: invalid_position/
    );

    // Verify the file was NOT corrupted
    const content = await fs.readFile(path.join(tmpDir, appendFile), "utf-8");
    assert.ok(!content.includes("undefined"), "File should not contain 'undefined'");
    assert.ok(content.includes("## Section One"), "File content should be intact");
  });
});

// ─── vault_edit ────────────────────────────────────────────────────────

describe("handleEdit", () => {
  let editFile;

  beforeEach(async () => {
    editFile = `notes/edit-${Date.now()}-${Math.random().toString(36).slice(2)}.md`;
    await fs.writeFile(path.join(tmpDir, editFile), "line one\nline two\nline three\n");
  });

  it("replaces a unique string", async () => {
    const handler = handlers.get("vault_edit");
    const result = await handler({ path: editFile, old_string: "line two", new_string: "line TWO" });

    assert.ok(result.content[0].text.includes("Successfully edited"));
    const content = await fs.readFile(path.join(tmpDir, editFile), "utf-8");
    assert.ok(content.includes("line TWO"));
    assert.ok(!content.includes("line two"));
  });

  it("returns error when no match found", async () => {
    const handler = handlers.get("vault_edit");
    const result = await handler({ path: editFile, old_string: "nonexistent", new_string: "x" });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("No match"));
  });

  it("returns error when multiple matches found", async () => {
    await fs.writeFile(path.join(tmpDir, editFile), "word word word\n");
    const handler = handlers.get("vault_edit");
    const result = await handler({ path: editFile, old_string: "word", new_string: "x" });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("3 matches"));
  });
});

// ─── vault_search ──────────────────────────────────────────────────────

describe("handleSearch", () => {
  it("finds notes matching a query", async () => {
    const handler = handlers.get("vault_search");
    const result = await handler({ query: "architecture" });
    const text = result.content[0].text;
    assert.ok(text.includes("beta.md"));
  });

  it("search is case-insensitive", async () => {
    const handler = handlers.get("vault_search");
    const result = await handler({ query: "ALPHA NOTE" });
    assert.ok(result.content[0].text.includes("alpha.md"));
  });

  it("returns no matches message", async () => {
    const handler = handlers.get("vault_search");
    const result = await handler({ query: "zzzznotfound12345" });
    assert.ok(result.content[0].text.includes("No matches"));
  });

  it("respects folder filter", async () => {
    const handler = handlers.get("vault_search");
    // Search in 05-Templates, which shouldn't have "architecture"
    const result = await handler({ query: "architecture", folder: "05-Templates" });
    assert.ok(!result.content[0].text.includes("beta.md"));
  });

  it("respects limit", async () => {
    const handler = handlers.get("vault_search");
    const result = await handler({ query: "Note", limit: 1 });
    // Should only return 1 result even though multiple notes match
    const matches = result.content[0].text.split("**").filter(s => s.endsWith(".md"));
    assert.equal(matches.length, 1);
  });
});

// ─── vault_list ────────────────────────────────────────────────────────

describe("handleList", () => {
  it("lists the vault root", async () => {
    const handler = handlers.get("vault_list");
    const result = await handler({});
    const text = result.content[0].text;
    assert.ok(text.includes("notes/"));
    assert.ok(text.includes("05-Templates/"));
  });

  it("lists a subdirectory", async () => {
    const handler = handlers.get("vault_list");
    const result = await handler({ path: "notes" });
    const text = result.content[0].text;
    assert.ok(text.includes("alpha.md"));
    assert.ok(text.includes("beta.md"));
    assert.ok(text.includes("gamma.md"));
  });

  it("skips dotfiles", async () => {
    await fs.writeFile(path.join(tmpDir, ".hidden"), "secret");
    const handler = handlers.get("vault_list");
    const result = await handler({});
    assert.ok(!result.content[0].text.includes(".hidden"));
  });

  it("supports glob pattern filtering", async () => {
    const handler = handlers.get("vault_list");
    const result = await handler({ path: "notes", pattern: "alpha*" });
    const text = result.content[0].text;
    assert.ok(text.includes("alpha.md"));
    assert.ok(!text.includes("beta.md"));
  });
});

// ─── vault_recent ──────────────────────────────────────────────────────

describe("handleRecent", () => {
  it("returns recently modified files", async () => {
    const handler = handlers.get("vault_recent");
    const result = await handler({});
    const text = result.content[0].text;
    // All md files in vault should appear
    assert.ok(text.includes(".md"));
  });

  it("respects limit", async () => {
    const handler = handlers.get("vault_recent");
    const result = await handler({ limit: 1 });
    const lines = result.content[0].text.trim().split("\n");
    assert.equal(lines.length, 1);
  });

  it("respects folder filter", async () => {
    const handler = handlers.get("vault_recent");
    const result = await handler({ folder: "notes" });
    const text = result.content[0].text;
    // handleRecent returns paths relative to the folder, so just "alpha.md" not "notes/alpha.md"
    assert.ok(text.includes(".md"), "Should contain markdown files");
    // Should not include template files since we're scoped to notes/
    assert.ok(!text.includes("05-Templates"));
  });

  it("sorts by modification time descending", async () => {
    // Touch alpha to make it most recent
    const alphaPath = path.join(tmpDir, "notes/alpha.md");
    const content = await fs.readFile(alphaPath, "utf-8");
    await new Promise(resolve => setTimeout(resolve, 50));
    await fs.writeFile(alphaPath, content);

    const handler = handlers.get("vault_recent");
    const result = await handler({ folder: "notes", limit: 1 });
    assert.ok(result.content[0].text.includes("alpha.md"));
  });
});

// ─── vault_links ───────────────────────────────────────────────────────

describe("handleLinks", () => {
  it("finds outgoing wikilinks", async () => {
    const handler = handlers.get("vault_links");
    const result = await handler({ path: "notes/alpha.md", direction: "outgoing" });
    const text = result.content[0].text;
    assert.ok(text.includes("[[beta]]"));
    assert.ok(text.includes("[[gamma]]"));
  });

  it("finds incoming wikilinks", async () => {
    const handler = handlers.get("vault_links");
    const result = await handler({ path: "notes/alpha.md", direction: "incoming" });
    const text = result.content[0].text;
    assert.ok(text.includes("beta.md"), "beta links to alpha");
  });

  it("finds both directions by default", async () => {
    const handler = handlers.get("vault_links");
    const result = await handler({ path: "notes/alpha.md", direction: "both" });
    const text = result.content[0].text;
    assert.ok(text.includes("Outgoing"));
    assert.ok(text.includes("Incoming"));
  });

  it("returns no links for isolated note", async () => {
    const handler = handlers.get("vault_links");
    const result = await handler({ path: "notes/gamma.md", direction: "outgoing" });
    assert.ok(result.content[0].text.includes("No links"));
  });

  it("detects incoming links via folder-prefixed wikilinks", async () => {
    // Create notes where one links to another using [[folder/name]] syntax
    const linkDir = path.join(tmpDir, "link-test");
    await fs.mkdir(linkDir, { recursive: true });
    await fs.writeFile(path.join(linkDir, "link-target.md"), `---
type: fleeting
created: 2026-01-01
tags:
  - test
---
# Link Target
`);
    await fs.writeFile(path.join(linkDir, "link-source.md"), `---
type: fleeting
created: 2026-01-01
tags:
  - test
---
# Link Source

References [[link-test/link-target]] using a folder-prefixed wikilink.
`);

    // Rebuild handlers to pick up the new files
    const templateRegistry = await buildTemplateRegistry(tmpDir);
    const freshHandlers = await createHandlers({
      vaultPath: tmpDir,
      templateRegistry,
      semanticIndex: null,
      activityLog: null,
      sessionId: "test-session-links-folder",
    });

    const handler = freshHandlers.get("vault_links");
    const result = await handler({ path: "link-test/link-target.md", direction: "incoming" });
    const text = result.content[0].text;
    assert.ok(text.includes("link-test/link-source.md"), `Should detect folder-prefixed incoming link but got: ${text}`);
  });
});

// ─── vault_query ───────────────────────────────────────────────────────

describe("handleQuery", () => {
  it("queries by type", async () => {
    const handler = handlers.get("vault_query");
    const result = await handler({ type: "research" });
    const text = result.content[0].text;
    assert.ok(text.includes("alpha.md"));
    assert.ok(!text.includes("beta.md")); // beta is type: adr
  });

  it("queries by status", async () => {
    const handler = handlers.get("vault_query");
    const result = await handler({ status: "accepted" });
    const text = result.content[0].text;
    assert.ok(text.includes("beta.md"));
    assert.ok(!text.includes("alpha.md")); // alpha is status: active
  });

  it("queries by tags (all required)", async () => {
    const handler = handlers.get("vault_query");
    const result = await handler({ tags: ["decision", "architecture"] });
    const text = result.content[0].text;
    assert.ok(text.includes("beta.md"));
  });

  it("queries by tags_any", async () => {
    const handler = handlers.get("vault_query");
    const result = await handler({ tags_any: ["mcp", "knowledge"] });
    const text = result.content[0].text;
    assert.ok(text.includes("alpha.md"));
    assert.ok(text.includes("gamma.md"));
    assert.ok(!text.includes("beta.md"));
  });

  it("queries by date range", async () => {
    const handler = handlers.get("vault_query");
    const result = await handler({ created_after: "2026-01-01", created_before: "2026-01-31" });
    const text = result.content[0].text;
    assert.ok(text.includes("alpha.md")); // created 2026-01-15
    assert.ok(!text.includes("beta.md")); // created 2026-02-01
    assert.ok(!text.includes("gamma.md")); // created 2025-12-01
  });

  it("returns empty message when no matches", async () => {
    const handler = handlers.get("vault_query");
    const result = await handler({ type: "nonexistent-type" });
    assert.ok(result.content[0].text.includes("No notes found"));
  });

  it("respects folder filter", async () => {
    const handler = handlers.get("vault_query");
    const result = await handler({ folder: "05-Templates", type: "research" });
    const text = result.content[0].text;
    // Templates have type: research but are in 05-Templates, not notes
    assert.ok(!text.includes("alpha.md"));
  });

  it("respects limit", async () => {
    const handler = handlers.get("vault_query");
    const result = await handler({ status: "active", limit: 1 });
    const text = result.content[0].text;
    assert.ok(text.includes("1 note"));
  });

  it("filters by custom_fields", async () => {
    const result = await handlers.get("vault_query")({
      type: "task",
      custom_fields: { priority: "high" },
      folder: "tasks"
    });
    assert.ok(result.content[0].text.includes("task-a.md"));
    assert.ok(!result.content[0].text.includes("task-b.md"));
    assert.ok(!result.content[0].text.includes("task-c.md"));
  });

  it("sorts by priority descending (urgent first)", async () => {
    const result = await handlers.get("vault_query")({
      type: "task",
      folder: "tasks",
      sort_by: "priority",
      sort_order: "desc"
    });
    const text = result.content[0].text;
    const posUrgent = text.indexOf("task-c");
    const posHigh = text.indexOf("task-a");
    const posLow = text.indexOf("task-b");
    assert.ok(posUrgent < posHigh, "urgent should come before high");
    assert.ok(posHigh < posLow, "high should come before low");
  });

  it("sorts by due date ascending (nulls last)", async () => {
    const result = await handlers.get("vault_query")({
      type: "task",
      folder: "tasks",
      sort_by: "due",
      sort_order: "asc"
    });
    const text = result.content[0].text;
    const posB = text.indexOf("task-b");
    const posA = text.indexOf("task-a");
    const posC = text.indexOf("task-c");
    assert.ok(posB < posA, "earlier due date first");
    assert.ok(posA < posC, "null due date last");
  });

  it("sort_by defaults to ascending", async () => {
    const result = await handlers.get("vault_query")({
      type: "task",
      folder: "tasks",
      sort_by: "created"
    });
    const text = result.content[0].text;
    const posA = text.indexOf("task-a");
    const posB = text.indexOf("task-b");
    const posC = text.indexOf("task-c");
    assert.ok(posA < posB, "earliest created first");
    assert.ok(posB < posC, "latest created last");
  });

  it("applies limit after sorting (not before)", async () => {
    const result = await handlers.get("vault_query")({
      type: "task",
      folder: "tasks",
      sort_by: "priority",
      sort_order: "desc",
      limit: 2
    });
    const text = result.content[0].text;
    // Key invariant: limit is applied AFTER sorting, so the highest-priority
    // task (urgent) must appear, and the lowest-priority (low) must not.
    assert.ok(text.includes("task-c"), "urgent task must be in top 2");
    assert.ok(!text.includes("task-b"), "low task must be excluded by limit");
    assert.ok(text.includes("2 note"), "should report exactly 2 results");
  });
});

// ─── vault_tags ────────────────────────────────────────────────────────

describe("handleTags", () => {
  it("discovers all tags in vault", async () => {
    const handler = handlers.get("vault_tags");
    const result = await handler({});
    const text = result.content[0].text;
    assert.ok(text.includes("dev"));
    assert.ok(text.includes("mcp"));
    assert.ok(text.includes("decision"));
    assert.ok(text.includes("knowledge"));
  });

  it("reports tag counts", async () => {
    const handler = handlers.get("vault_tags");
    const result = await handler({});
    const text = result.content[0].text;
    // "research" appears in alpha.md frontmatter and in the template
    assert.ok(text.match(/research \(\d+\)/));
  });

  it("filters by folder", async () => {
    const handler = handlers.get("vault_tags");
    const result = await handler({ folder: "notes" });
    const text = result.content[0].text;
    assert.ok(text.includes("dev"));
    assert.ok(text.includes("knowledge"));
  });

  it("supports pattern filtering", async () => {
    const handler = handlers.get("vault_tags");
    const result = await handler({ pattern: "dec*" });
    const text = result.content[0].text;
    assert.ok(text.includes("decision"));
    assert.ok(!text.includes("knowledge"));
  });

  it("includes inline tags when requested", async () => {
    // Add a file with inline tags
    const inlineFile = path.join(tmpDir, "notes/inline-tags.md");
    await fs.writeFile(inlineFile, `---
type: fleeting
created: 2026-01-01
tags:
  - test
---
# Inline Tags Test

This has #inline-tag and #another-tag in the body.
`);

    const handler = handlers.get("vault_tags");
    const result = await handler({ include_inline: true });
    const text = result.content[0].text;
    assert.ok(text.includes("inline-tag"));
    assert.ok(text.includes("another-tag"));

    await fs.unlink(inlineFile);
  });
});

// ─── vault_activity ────────────────────────────────────────────────────

describe("handleActivity", () => {
  it("returns empty message when no activity log", async () => {
    const handler = handlers.get("vault_activity");
    // activityLog is null in our test context
    const result = await handler({});
    assert.ok(result.content[0].text.includes("No activity"));
  });

  it("includes session ID in output", async () => {
    const handler = handlers.get("vault_activity");
    const result = await handler({});
    assert.ok(result.content[0].text.includes("test-ses"));
  });

  it("clears with zero count when no log", async () => {
    const handler = handlers.get("vault_activity");
    const result = await handler({ action: "clear" });
    assert.ok(result.content[0].text.includes("Cleared 0"));
  });

  it("throws on unknown action", async () => {
    const handler = handlers.get("vault_activity");
    await assert.rejects(() => handler({ action: "invalid" }), /Unknown action/);
  });
});

// ─── vault_semantic_search ─────────────────────────────────────────────

describe("handleSemanticSearch", () => {
  it("throws when semantic index not available", async () => {
    const handler = handlers.get("vault_semantic_search");
    await assert.rejects(() => handler({ query: "test" }), /not available/);
  });

  it("returns search results from semantic index (happy path)", async () => {
    const mockIndex = {
      isAvailable: true,
      async search() {
        return `Found 2 semantically related notes:\n\n**notes/alpha.md** (score: 0.85)\nAlpha content\n\n**notes/beta.md** (score: 0.72)\nBeta content`;
      },
    };
    const mockHandlers = await createHandlers({
      vaultPath: tmpDir,
      templateRegistry: new Map(),
      semanticIndex: mockIndex,
      activityLog: null,
      sessionId: "test-semantic-happy",
    });
    const handler = mockHandlers.get("vault_semantic_search");
    const result = await handler({ query: "machine learning", limit: 5 });
    assert.equal(result.content[0].type, "text");
    assert.ok(result.content[0].text.includes("alpha.md"));
    assert.ok(result.content[0].text.includes("beta.md"));
    assert.ok(result.content[0].text.includes("score: 0.85"));
  });

  it("passes all args through to semantic index", async () => {
    let capturedArgs;
    const mockIndex = {
      isAvailable: true,
      async search(args) {
        capturedArgs = args;
        return "No semantically related notes found.";
      },
    };
    const mockHandlers = await createHandlers({
      vaultPath: tmpDir,
      templateRegistry: new Map(),
      semanticIndex: mockIndex,
      activityLog: null,
      sessionId: "test-semantic-args",
    });
    const handler = mockHandlers.get("vault_semantic_search");
    await handler({ query: "test query", limit: 3, folder: "notes", threshold: 0.5 });
    assert.equal(capturedArgs.query, "test query");
    assert.equal(capturedArgs.limit, 3);
    assert.equal(capturedArgs.folder, "notes");
    assert.equal(capturedArgs.threshold, 0.5);
  });
});

// ─── vault_suggest_links ───────────────────────────────────────────────

describe("handleSuggestLinks", () => {
  it("throws when semantic index not available", async () => {
    const handler = handlers.get("vault_suggest_links");
    await assert.rejects(() => handler({ content: "test content" }), /not available/);
  });

  it("throws when neither content nor path provided", async () => {
    // Create handlers with a mock semantic index that has isAvailable=true
    const mockHandlers = await createHandlers({
      vaultPath: tmpDir,
      templateRegistry: new Map(),
      semanticIndex: { isAvailable: true },
      activityLog: null,
      sessionId: "test",
    });
    const handler = mockHandlers.get("vault_suggest_links");
    await assert.rejects(() => handler({}), /Either.*content.*path/);
  });

  it("returns link suggestions from content arg (happy path)", async () => {
    const mockIndex = {
      isAvailable: true,
      async searchRaw() {
        return [
          { path: "notes/gamma.md", score: 0.88, preview: "Gamma note about knowledge" },
          { path: "notes/beta.md", score: 0.72, preview: "Beta note about architecture" },
        ];
      },
    };
    const templateRegistry = await buildTemplateRegistry(tmpDir);
    const mockHandlers = await createHandlers({
      vaultPath: tmpDir,
      templateRegistry,
      semanticIndex: mockIndex,
      activityLog: null,
      sessionId: "test-suggest-content",
    });

    const handler = mockHandlers.get("vault_suggest_links");
    const result = await handler({
      content: "Some text about project management and decisions.",
    });
    const text = result.content[0].text;
    assert.ok(text.includes("link suggestion"), `Expected suggestions header but got: ${text}`);
    assert.ok(text.includes("gamma.md"));
    assert.ok(text.includes("beta.md"));
    assert.ok(text.includes("score: 0.88"));
  });

  it("filters out already-linked notes from suggestions", async () => {
    const mockIndex = {
      isAvailable: true,
      async searchRaw() {
        return [
          { path: "notes/gamma.md", score: 0.88, preview: "Gamma note" },
          { path: "notes/beta.md", score: 0.72, preview: "Beta note" },
        ];
      },
    };
    const templateRegistry = await buildTemplateRegistry(tmpDir);
    const mockHandlers = await createHandlers({
      vaultPath: tmpDir,
      templateRegistry,
      semanticIndex: mockIndex,
      activityLog: null,
      sessionId: "test-suggest-filter",
    });

    const handler = mockHandlers.get("vault_suggest_links");
    // Content already links to [[beta]]
    const result = await handler({
      content: "Some text that links to [[beta]] already.",
    });
    const text = result.content[0].text;
    // beta should be filtered out because it's already linked
    assert.ok(text.includes("gamma.md"), "gamma should appear");
    assert.ok(!text.includes("beta.md"), "beta should be filtered (already linked)");
  });

  it("reads file when path arg is provided instead of content", async () => {
    const mockIndex = {
      isAvailable: true,
      async searchRaw() {
        return [
          { path: "notes/beta.md", score: 0.80, preview: "Beta note about architecture" },
        ];
      },
    };
    const templateRegistry = await buildTemplateRegistry(tmpDir);
    const mockHandlers = await createHandlers({
      vaultPath: tmpDir,
      templateRegistry,
      semanticIndex: mockIndex,
      activityLog: null,
      sessionId: "test-suggest-path",
    });

    const handler = mockHandlers.get("vault_suggest_links");
    // Use path arg - handler should read the file at notes/gamma.md
    const result = await handler({ path: "notes/gamma.md" });
    const text = result.content[0].text;
    assert.ok(text.includes("link suggestion"), `Expected suggestions but got: ${text}`);
    assert.ok(text.includes("beta.md"));
  });

  it("returns 'no suggestions' when searchRaw returns empty", async () => {
    const mockIndex = {
      isAvailable: true,
      async searchRaw() {
        return [];
      },
    };
    const templateRegistry = await buildTemplateRegistry(tmpDir);
    const mockHandlers = await createHandlers({
      vaultPath: tmpDir,
      templateRegistry,
      semanticIndex: mockIndex,
      activityLog: null,
      sessionId: "test-suggest-empty",
    });

    const handler = mockHandlers.get("vault_suggest_links");
    const result = await handler({ content: "Some text." });
    assert.ok(result.content[0].text.includes("No link suggestions found"));
  });
});

// ─── vault_list glob matching (H1 ReDoS fix) ─────────────────────────

describe("handleList glob pattern matching", () => {
  it("filters with *.md pattern", async () => {
    const handler = handlers.get("vault_list");
    const result = await handler({ path: "notes", pattern: "*.md" });
    const text = result.content[0].text;
    assert.ok(text.includes("alpha.md"));
    assert.ok(text.includes("beta.md"));
  });

  it("filters with prefix-* pattern", async () => {
    const handler = handlers.get("vault_list");
    const result = await handler({ path: "notes", pattern: "alpha*" });
    const text = result.content[0].text;
    assert.ok(text.includes("alpha.md"));
    assert.ok(!text.includes("beta.md"));
  });

  it("filters with *substring* pattern", async () => {
    const handler = handlers.get("vault_list");
    const result = await handler({ path: "notes", pattern: "*lph*" });
    const text = result.content[0].text;
    assert.ok(text.includes("alpha.md"));
    assert.ok(!text.includes("beta.md"));
  });

  it("does not hang on crafted input (ReDoS safe)", async () => {
    // If the glob used greedy .*, this crafted pattern could cause backtracking
    const handler = handlers.get("vault_list");
    const result = await handler({ path: "notes", pattern: "*a*a*a*a*a*a*b" });
    // Should complete quickly and just return no matches or correct matches
    assert.ok(result.content[0].text);
  });
});

// ─── vault_edit with $ sequences (M3 fix) ────────────────────────────

describe("handleEdit dollar sign replacement sequences", () => {
  it("treats $& literally in new_string", async () => {
    const editFile = `notes/dollar-test-${Date.now()}.md`;
    await fs.writeFile(path.join(tmpDir, editFile), "replace this text\n");

    const handler = handlers.get("vault_edit");
    const result = await handler({
      path: editFile,
      old_string: "replace this text",
      new_string: "cost is $& and $1 dollars",
    });

    assert.ok(result.content[0].text.includes("Successfully edited"));
    const content = await fs.readFile(path.join(tmpDir, editFile), "utf-8");
    assert.ok(content.includes("cost is $& and $1 dollars"), `Expected literal $& but got: ${content}`);

    await fs.unlink(path.join(tmpDir, editFile));
  });
});

// ─── vault_neighborhood depth cap (M7 fix) ───────────────────────────

describe("handleNeighborhood depth cap", () => {
  it("caps depth at 5 when a larger value is requested", async () => {
    const handler = handlers.get("vault_neighborhood");
    // Request depth 100; should be capped to 5 without error
    const result = await handler({ path: "notes/alpha.md", depth: 100 });
    const text = result.content[0].text;
    // The result should mention the capped depth or just succeed within bounds
    assert.ok(text, "Should return valid text");
  });

  it("uses default depth 2 when not specified", async () => {
    const handler = handlers.get("vault_neighborhood");
    const result = await handler({ path: "notes/alpha.md" });
    assert.ok(result.content[0].text);
  });

  it("respects depth when within limits", async () => {
    const handler = handlers.get("vault_neighborhood");
    const result = await handler({ path: "notes/alpha.md", depth: 1 });
    assert.ok(result.content[0].text);
  });
});

// ─── vault_peek ──────────────────────────────────────────────────────

describe("handlePeek", () => {
  it("returns peek data for a normal file", async () => {
    const handler = handlers.get("vault_peek");
    const result = await handler({ path: "notes/devlog.md" });
    const text = result.content[0].text;
    assert.ok(text.includes("devlog.md"));
    assert.ok(text.includes("## 2026-01-01"));
    assert.ok(text.includes("## 2026-02-01"));
  });

  it("includes frontmatter info", async () => {
    const handler = handlers.get("vault_peek");
    const result = await handler({ path: "notes/devlog.md" });
    const text = result.content[0].text;
    assert.ok(text.includes("devlog"));
  });

  it("includes heading outline with line numbers", async () => {
    const handler = handlers.get("vault_peek");
    const result = await handler({ path: "notes/devlog.md" });
    const text = result.content[0].text;
    assert.match(text, /L\d+/);
  });

  it("supports fuzzy path resolution", async () => {
    const handler = handlers.get("vault_peek");
    const result = await handler({ path: "devlog" });
    const text = result.content[0].text;
    assert.ok(text.includes("devlog.md"));
  });

  it("throws on non-existent file", async () => {
    const handler = handlers.get("vault_peek");
    await assert.rejects(
      () => handler({ path: "nonexistent.md" }),
      /not found|No matching file/i
    );
  });

  it("includes size information", async () => {
    const handler = handlers.get("vault_peek");
    const result = await handler({ path: "notes/alpha.md" });
    const text = result.content[0].text;
    assert.ok(text.includes("chars"));
    assert.ok(text.includes("lines"));
  });
});

// ─── createHandlers ────────────────────────────────────────────────────

describe("createHandlers", () => {
  it("returns a Map with all expected tool names", () => {
    const expectedTools = [
      "vault_read", "vault_write", "vault_append", "vault_edit",
      "vault_search", "vault_list", "vault_recent", "vault_links",
      "vault_neighborhood", "vault_query", "vault_tags",
      "vault_activity", "vault_semantic_search", "vault_suggest_links",
      "vault_peek", "vault_trash", "vault_move",
      "vault_update_frontmatter",
    ];
    for (const tool of expectedTools) {
      assert.ok(handlers.has(tool), `Missing handler: ${tool}`);
      assert.equal(typeof handlers.get(tool), "function");
    }
  });

  it("returns exactly 18 handlers", () => {
    assert.equal(handlers.size, 18);
  });
});

// ─── vault_trash ──────────────────────────────────────────────────────

describe("handleTrash", () => {
  it("moves a file to .trash/ preserving folder structure", async () => {
    // Create a fresh file to trash
    const filePath = path.join(tmpDir, "moveable", "to-trash.md");
    await fs.writeFile(filePath, "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# To Trash\n");

    // Rebuild handlers to pick up the new file
    const templateRegistry = await buildTemplateRegistry(tmpDir);
    const freshHandlers = await createHandlers({
      vaultPath: tmpDir,
      templateRegistry,
      semanticIndex: null,
      activityLog: null,
      sessionId: "test-session-trash",
    });

    const handler = freshHandlers.get("vault_trash");
    const result = await handler({ path: "moveable/to-trash.md" });

    // File should be in .trash/
    const trashed = path.join(tmpDir, ".trash", "moveable", "to-trash.md");
    const exists = await fs.access(trashed).then(() => true, () => false);
    assert.ok(exists, "File should exist in .trash/");

    // Original should be gone
    const originalExists = await fs.access(filePath).then(() => true, () => false);
    assert.ok(!originalExists, "Original file should be removed");

    // Output should confirm
    assert.ok(result.content[0].text.includes("moveable/to-trash.md"));
    assert.ok(result.content[0].text.includes(".trash/"));
  });

  it("warns about incoming links when trashing", async () => {
    // Create linked notes
    const trashDir2 = path.join(tmpDir, "trash-test");
    await fs.mkdir(trashDir2, { recursive: true });
    await fs.writeFile(path.join(trashDir2, "will-die.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# Will Die\n");
    await fs.writeFile(path.join(trashDir2, "refers.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# Refers\nSee [[will-die]].\n");

    const templateRegistry = await buildTemplateRegistry(tmpDir);
    const freshHandlers = await createHandlers({
      vaultPath: tmpDir,
      templateRegistry,
      semanticIndex: null,
      activityLog: null,
      sessionId: "test-session-trash-links",
    });

    const handler = freshHandlers.get("vault_trash");
    const result = await handler({ path: "trash-test/will-die.md" });
    const text = result.content[0].text;

    assert.ok(text.includes("trash-test/refers.md"), "Should warn about file with incoming link");
  });

  it("appends timestamp suffix on .trash/ collision", async () => {
    // Create a new file to trash
    const filePath = path.join(tmpDir, "moveable", "orphan-dup.md");
    await fs.writeFile(filePath, "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# Orphan Dup\n");

    // Also ensure .trash/moveable/orphan-dup.md exists for collision
    await fs.mkdir(path.join(tmpDir, ".trash", "moveable"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".trash", "moveable", "orphan-dup.md"), "already in trash");

    const templateRegistry = await buildTemplateRegistry(tmpDir);
    const freshHandlers = await createHandlers({
      vaultPath: tmpDir,
      templateRegistry,
      semanticIndex: null,
      activityLog: null,
      sessionId: "test-session-trash-collision",
    });

    const handler = freshHandlers.get("vault_trash");
    const result = await handler({ path: "moveable/orphan-dup.md" });
    const text = result.content[0].text;

    // Should succeed with .trash/ in output
    assert.ok(text.includes(".trash/"), "Should mention .trash/");
    // Original should be gone
    const originalExists = await fs.access(filePath).then(() => true, () => false);
    assert.ok(!originalExists, "Original should be removed");
    // Previous trash file should still exist (not overwritten)
    const prevTrash = await fs.readFile(path.join(tmpDir, ".trash", "moveable", "orphan-dup.md"), "utf-8");
    assert.equal(prevTrash, "already in trash", "Previous trash entry should not be overwritten");
  });

  it("requires exact path (rejects fuzzy names)", async () => {
    const handler = handlers.get("vault_trash");
    await assert.rejects(
      () => handler({ path: "target" }),
      /ENOENT|no such file/i
    );
  });

  it("throws on non-existent file", async () => {
    const handler = handlers.get("vault_trash");
    await assert.rejects(
      () => handler({ path: "nonexistent-file-xyz.md" }),
      /ENOENT|not found|No matching file/i
    );
  });
});

// ─── vault_move ───────────────────────────────────────────────────────

describe("handleMove", () => {
  // Helper to create fresh handlers with new temp files
  async function freshHandlersFor(tmpDir) {
    const templateRegistry = await buildTemplateRegistry(tmpDir);
    return createHandlers({
      vaultPath: tmpDir,
      templateRegistry,
      semanticIndex: null,
      activityLog: null,
      sessionId: "test-move-" + Math.random().toString(36).slice(2, 8),
    });
  }

  it("moves a file and preserves content", async () => {
    const srcDir = path.join(tmpDir, "move-basic");
    const destDir = path.join(tmpDir, "archive");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "doc.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# Doc\nContent.\n");

    const h = await freshHandlersFor(tmpDir);
    const result = await h.get("vault_move")({ old_path: "move-basic/doc.md", new_path: "archive/doc.md" });

    const newContent = await fs.readFile(path.join(destDir, "doc.md"), "utf-8");
    assert.ok(newContent.includes("# Doc"));
    const oldExists = await fs.access(path.join(srcDir, "doc.md")).then(() => true, () => false);
    assert.ok(!oldExists);
    assert.ok(result.content[0].text.includes("archive/doc.md"));
  });

  it("updates wikilinks in other files", async () => {
    const srcDir = path.join(tmpDir, "move-links");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "moving.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# Moving\n");
    await fs.writeFile(path.join(srcDir, "stays.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# Stays\nLinks to [[moving]] here.\n");

    const h = await freshHandlersFor(tmpDir);
    await h.get("vault_move")({ old_path: "move-links/moving.md", new_path: "move-links/moved.md" });

    const staysContent = await fs.readFile(path.join(srcDir, "stays.md"), "utf-8");
    assert.ok(staysContent.includes("[[moved]]"), `Expected [[moved]] but got: ${staysContent}`);
    assert.ok(!staysContent.includes("[[moving]]"));
  });

  it("preserves aliases when updating links", async () => {
    const srcDir = path.join(tmpDir, "move-alias");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "src.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# Src\n");
    await fs.writeFile(path.join(srcDir, "ref.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# Ref\nSee [[src|Source File]].\n");

    const h = await freshHandlersFor(tmpDir);
    await h.get("vault_move")({ old_path: "move-alias/src.md", new_path: "move-alias/dest.md" });

    const refContent = await fs.readFile(path.join(srcDir, "ref.md"), "utf-8");
    assert.ok(refContent.includes("[[dest|Source File]]"), `Expected [[dest|Source File]] but got: ${refContent}`);
  });

  it("skips link updating when update_links is false", async () => {
    const srcDir = path.join(tmpDir, "move-nolinks");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "moving2.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# Moving2\n");
    await fs.writeFile(path.join(srcDir, "ref2.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# Ref2\nLinks to [[moving2]].\n");

    const h = await freshHandlersFor(tmpDir);
    await h.get("vault_move")({ old_path: "move-nolinks/moving2.md", new_path: "move-nolinks/moved2.md", update_links: false });

    const refContent = await fs.readFile(path.join(srcDir, "ref2.md"), "utf-8");
    assert.ok(refContent.includes("[[moving2]]"), "Links should NOT be updated");
  });

  it("errors when destination already exists", async () => {
    const srcDir = path.join(tmpDir, "move-exists");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "a.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# A\n");
    await fs.writeFile(path.join(srcDir, "b.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# B\n");

    const h = await freshHandlersFor(tmpDir);
    await assert.rejects(
      () => h.get("vault_move")({ old_path: "move-exists/a.md", new_path: "move-exists/b.md" }),
      /already exists/i
    );
  });

  it("creates destination directories if needed", async () => {
    const srcDir = path.join(tmpDir, "move-mkdir");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "doc.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# Doc\n");

    const h = await freshHandlersFor(tmpDir);
    await h.get("vault_move")({ old_path: "move-mkdir/doc.md", new_path: "deep/nested/dir/doc.md" });

    const newContent = await fs.readFile(path.join(tmpDir, "deep", "nested", "dir", "doc.md"), "utf-8");
    assert.ok(newContent.includes("# Doc"));
  });

  it("requires exact source path (rejects fuzzy names)", async () => {
    const h = await freshHandlersFor(tmpDir);
    await assert.rejects(
      () => h.get("vault_move")({ old_path: "target", new_path: "moveable/renamed.md" }),
      /ENOENT|no such file/i
    );
  });

  it("detects post-move basename ambiguity and rewrites to full paths", async () => {
    const dir1 = path.join(tmpDir, "move-ambig", "folder-a");
    const dir2 = path.join(tmpDir, "move-ambig", "folder-b");
    await fs.mkdir(dir1, { recursive: true });
    await fs.mkdir(dir2, { recursive: true });

    await fs.writeFile(path.join(dir1, "unique-src.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# Unique Src\n");
    await fs.writeFile(path.join(dir2, "same-name.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# Same Name B\n");
    await fs.writeFile(path.join(dir1, "ref.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# Ref\nSee [[unique-src]].\n");

    const h = await freshHandlersFor(tmpDir);
    const result = await h.get("vault_move")({ old_path: "move-ambig/folder-a/unique-src.md", new_path: "move-ambig/folder-a/same-name.md" });

    // Link should use full path to avoid ambiguity
    const refContent = await fs.readFile(path.join(dir1, "ref.md"), "utf-8");
    assert.ok(
      refContent.includes("[[move-ambig/folder-a/same-name]]"),
      `Expected full path link but got: ${refContent}`
    );

    // Output should mention ambiguity
    const text = result.content[0].text;
    assert.ok(text.toLowerCase().includes("ambig"), `Expected ambiguity warning but got: ${text}`);
  });

  it("rewrites full-path wikilinks [[folder/name]]", async () => {
    const srcDir = path.join(tmpDir, "move-fullpath");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "fp-source.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# FP Source\n");
    await fs.writeFile(path.join(srcDir, "fp-ref.md"), "---\ntype: fleeting\ncreated: 2026-01-01\ntags: [test]\n---\n# FP Ref\nSee [[move-fullpath/fp-source]] for details.\n");

    const h = await freshHandlersFor(tmpDir);
    await h.get("vault_move")({ old_path: "move-fullpath/fp-source.md", new_path: "move-fullpath/fp-dest.md" });

    const refContent = await fs.readFile(path.join(srcDir, "fp-ref.md"), "utf-8");
    assert.ok(refContent.includes("[[fp-dest]]"), `Expected [[fp-dest]] but got: ${refContent}`);
    assert.ok(!refContent.includes("[[move-fullpath/fp-source]]"));
  });
});

// ─── vault_update_frontmatter ─────────────────────────────────────────

describe("handleUpdateFrontmatter", () => {
  it("updates frontmatter fields in an existing note", async () => {
    await handlers.get("vault_write")({
      template: "task",
      path: "tasks/fm-update-test.md",
      frontmatter: { tags: ["task"] }
    });
    const result = await handlers.get("vault_update_frontmatter")({
      path: "tasks/fm-update-test.md",
      fields: { status: "done", completed: "2026-02-10" }
    });
    assert.ok(result.content[0].text.includes("status: done"));
    assert.ok(result.content[0].text.includes("completed: 2026-02-10"));

    const content = await fs.readFile(path.join(tmpDir, "tasks/fm-update-test.md"), "utf-8");
    assert.ok(content.includes("status: done"));
    assert.ok(content.includes("completed:") && content.includes("2026-02-10"), "completed field present");
    assert.ok(content.includes("## Description"), "body preserved");
  });

  it("removes a field when set to null", async () => {
    await handlers.get("vault_write")({
      template: "task",
      path: "tasks/fm-remove-test.md",
      frontmatter: { tags: ["task"], priority: "high" }
    });
    await handlers.get("vault_update_frontmatter")({
      path: "tasks/fm-remove-test.md",
      fields: { priority: null }
    });
    const content = await fs.readFile(path.join(tmpDir, "tasks/fm-remove-test.md"), "utf-8");
    assert.ok(!content.includes("priority:"), "priority field removed");
  });

  it("rejects deletion of protected fields", async () => {
    await handlers.get("vault_write")({
      template: "task",
      path: "tasks/fm-protect-test.md",
      frontmatter: { tags: ["task"] }
    });
    await assert.rejects(
      () => handlers.get("vault_update_frontmatter")({
        path: "tasks/fm-protect-test.md",
        fields: { type: null }
      }),
      /cannot remove/i
    );
  });

  it("errors on non-existent file without leaking absolute path", async () => {
    try {
      await handlers.get("vault_update_frontmatter")({
        path: "tasks/no-such-file.md",
        fields: { status: "done" }
      });
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e.message.includes("File not found"), "should have clear error message");
      assert.ok(e.message.includes("tasks/no-such-file.md"), "should include relative path");
      assert.ok(!e.message.includes(tmpDir), "should not leak absolute vault path");
    }
  });

  it("errors on file without frontmatter", async () => {
    await fs.writeFile(path.join(tmpDir, "no-fm.md"), "# No Frontmatter\n\nJust body.\n");
    await assert.rejects(
      () => handlers.get("vault_update_frontmatter")({
        path: "no-fm.md",
        fields: { status: "done" }
      }),
      /no frontmatter/i
    );
  });
});

describe("handleRead force param with FORCE_HARD_CAP", () => {
  it("returns peek data with hard cap message for files exceeding 400k chars", async () => {
    const hugeContent = "---\ntype: test\ncreated: 2026-01-01\ntags:\n  - test\n---\n" + "x".repeat(410_000);
    await fs.writeFile(path.join(tmpDir, "huge-force-cap.md"), hugeContent);

    // Rebuild handlers to pick up new file
    const freshHandlers = await createHandlers({
      vaultPath: tmpDir,
      templateRegistry: new Map(),
      semanticIndex: null,
      activityLog: null,
      sessionId: "test",
    });

    const result = await freshHandlers.get("vault_read")({ path: "huge-force-cap.md", force: true });
    const text = result.content[0].text;
    assert.ok(text.includes("Hard cap reached"), "should include hard cap message");
    assert.ok(text.includes("huge-force-cap.md"), "should include filename");
    assert.ok(!text.includes("x".repeat(1000)), "should NOT include raw content");
  });
});

describe("handleList ReDoS protection", () => {
  it("completes quickly even with many wildcards (linear-time glob)", async () => {
    // This pattern with regex .*? would cause catastrophic backtracking
    const evilPattern = "*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*b";
    const start = Date.now();
    const result = await handlers.get("vault_list")({ path: "", pattern: evilPattern });
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `should complete in <1s, took ${elapsed}ms`);
    assert.ok(result.content[0].text);
  });
});

describe("handleWrite atomic creation (wx flag)", () => {
  it("rejects creation of existing file with clear error", async () => {
    // Write an existing file
    await fs.writeFile(path.join(tmpDir, "existing-wx.md"), "---\ntype: test\ncreated: 2026-01-01\ntags:\n  - test\n---\ncontent");

    const reg = await buildTemplateRegistry(tmpDir);
    const freshHandlers = await createHandlers({
      vaultPath: tmpDir,
      templateRegistry: reg,
      semanticIndex: null,
      activityLog: null,
      sessionId: "test",
    });

    await assert.rejects(
      () => freshHandlers.get("vault_write")({
        template: "research-note",
        path: "existing-wx.md",
        frontmatter: { tags: ["test"] }
      }),
      /already exists/i
    );
  });
});
