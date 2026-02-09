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

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "handlers-test-"));

  // Set up template directory
  const templateDir = path.join(tmpDir, "05-Templates");
  await fs.mkdir(templateDir, { recursive: true });
  await fs.writeFile(path.join(templateDir, "research-note.md"), TEMPLATE_CONTENT);
  await fs.writeFile(path.join(templateDir, "adr.md"), ADR_TEMPLATE);

  // Create some test notes
  const notesDir = path.join(tmpDir, "notes");
  await fs.mkdir(notesDir, { recursive: true });

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

  // Build template registry (mimicking what index.js does)
  const templateRegistry = new Map();
  const templateFiles = await fs.readdir(templateDir);
  for (const file of templateFiles) {
    const name = path.basename(file, ".md");
    const content = await fs.readFile(path.join(templateDir, file), "utf-8");
    templateRegistry.set(name, { content, description: name });
  }

  handlers = createHandlers({
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
    await assert.rejects(() => handler({ path: "notes/nonexistent.md" }), { code: "ENOENT" });
  });

  it("throws on directory traversal", async () => {
    const handler = handlers.get("vault_read");
    await assert.rejects(() => handler({ path: "../etc/passwd" }), /escapes vault/);
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
});

// ─── vault_suggest_links ───────────────────────────────────────────────

describe("handleSuggestLinks", () => {
  it("throws when semantic index not available", async () => {
    const handler = handlers.get("vault_suggest_links");
    await assert.rejects(() => handler({ content: "test content" }), /not available/);
  });

  it("throws when neither content nor path provided", async () => {
    // Create handlers with a mock semantic index that has isAvailable=true
    const mockHandlers = createHandlers({
      vaultPath: tmpDir,
      templateRegistry: new Map(),
      semanticIndex: { isAvailable: true },
      activityLog: null,
      sessionId: "test",
    });
    const handler = mockHandlers.get("vault_suggest_links");
    await assert.rejects(() => handler({}), /Either.*content.*path/);
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
    ];
    for (const tool of expectedTools) {
      assert.ok(handlers.has(tool), `Missing handler: ${tool}`);
      assert.equal(typeof handlers.get(tool), "function");
    }
  });

  it("returns exactly 14 handlers", () => {
    assert.equal(handlers.size, 14);
  });
});
