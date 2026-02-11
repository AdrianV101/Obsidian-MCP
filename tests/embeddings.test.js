import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  SemanticIndex,
  chunkNote,
  splitByHeadings,
  splitByParagraphs,
  getPreview,
  contentHash,
} from "../embeddings.js";

// ---------------------------------------------------------------------------
// chunkNote(content, filePath)
// ---------------------------------------------------------------------------
describe("chunkNote", () => {
  it("short note (under chunk limit) returns single chunk with title prefix", () => {
    const content = "---\ntype: note\ncreated: 2026-01-01\ntags:\n  - test\n---\n\nHello world.";
    const chunks = chunkNote(content, "notes/greeting.md");
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].text.startsWith("# greeting\n\n"));
    assert.ok(chunks[0].text.includes("Hello world."));
    assert.equal(chunks[0].heading, null);
    assert.ok(chunks[0].preview.length > 0);
  });

  it("note with multiple ## headings splits by heading", () => {
    // Build a body with headings that exceeds the chunk size limit.
    const longBody = "## Intro\n\n" + "A ".repeat(3000) + "\n\n## Details\n\n" + "B ".repeat(3000);
    const content = "---\ntype: note\n---\n\n" + longBody;
    const chunks = chunkNote(content, "project/analysis.md");
    assert.ok(chunks.length >= 2, `expected >=2 chunks, got ${chunks.length}`);
    // Each chunk should be prefixed with the title
    for (const chunk of chunks) {
      assert.ok(chunk.text.startsWith("# analysis\n\n"));
    }
    // First chunk heading should be null (content before first ##) or "Intro"
    const headings = chunks.map(c => c.heading);
    assert.ok(headings.includes("Intro"));
    assert.ok(headings.includes("Details"));
  });

  it("very long section falls back to paragraph splitting", () => {
    // Create a single ## section that exceeds MAX_CHARS_PER_CHUNK
    const longParagraph1 = "Word ".repeat(1000);
    const longParagraph2 = "Text ".repeat(1000);
    const longBody = "## Big Section\n\n" + longParagraph1 + "\n\n" + longParagraph2;
    const content = "---\ntype: note\n---\n\n" + longBody;
    const chunks = chunkNote(content, "notes/big.md");
    assert.ok(chunks.length >= 2, `expected >=2 chunks, got ${chunks.length}`);
    // Paragraph-split chunks get numbered headings like "Big Section (1)"
    const numbered = chunks.filter(c => c.heading && /\(\d+\)/.test(c.heading));
    assert.ok(numbered.length >= 2, "expected numbered heading chunks from paragraph splitting");
  });

  it("empty body returns empty array", () => {
    const content = "---\ntype: note\n---\n\n";
    const chunks = chunkNote(content, "notes/empty.md");
    assert.equal(chunks.length, 0);
  });

  it("body with only whitespace returns empty array", () => {
    const content = "---\ntype: note\n---\n\n   \n  \n   ";
    const chunks = chunkNote(content, "notes/whitespace.md");
    assert.equal(chunks.length, 0);
  });

  it("content without frontmatter uses full content as body", () => {
    const content = "Just some plain text.";
    const chunks = chunkNote(content, "notes/plain.md");
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].text.includes("Just some plain text."));
  });

  it("ignores --- mid-line in frontmatter value (does not include frontmatter in chunks)", () => {
    // Frontmatter with --- mid-line should be properly stripped from chunk body
    const content = "---\ntype: note\ncreated: 2026-01-01\ntags:\n  - test\ndescription: This --- is mid-line\n---\n\nBody content here.";
    const chunks = chunkNote(content, "notes/test.md");
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].text.includes("Body content here."));
    assert.ok(!chunks[0].text.includes("description:"), "frontmatter should be stripped");
    assert.ok(!chunks[0].text.includes("This --- is mid-line"), "frontmatter value with --- should be stripped");
  });
});

// ---------------------------------------------------------------------------
// splitByHeadings(body)
// ---------------------------------------------------------------------------
describe("splitByHeadings", () => {
  it("text with no ## headings returns array with single element", () => {
    const sections = splitByHeadings("Just plain text\nwith multiple lines.");
    assert.equal(sections.length, 1);
    assert.equal(sections[0].heading, null);
    assert.ok(sections[0].text.includes("Just plain text"));
  });

  it("multiple ## headings split correctly", () => {
    const body = "## First\n\nContent one.\n\n## Second\n\nContent two.";
    const sections = splitByHeadings(body);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].heading, "First");
    assert.ok(sections[0].text.includes("Content one."));
    assert.equal(sections[1].heading, "Second");
    assert.ok(sections[1].text.includes("Content two."));
  });

  it("content before first heading is preserved as first element", () => {
    const body = "Preamble text.\n\n## First Heading\n\nHeading content.";
    const sections = splitByHeadings(body);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].heading, null);
    assert.ok(sections[0].text.includes("Preamble text."));
    assert.equal(sections[1].heading, "First Heading");
  });

  it("### headings are NOT split points (only ## level)", () => {
    const body = "## Main\n\nSome text.\n\n### Sub\n\nSub text.";
    const sections = splitByHeadings(body);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].heading, "Main");
    assert.ok(sections[0].text.includes("### Sub"));
    assert.ok(sections[0].text.includes("Sub text."));
  });

  it("empty string returns single empty-text section", () => {
    const sections = splitByHeadings("");
    assert.equal(sections.length, 1);
    assert.equal(sections[0].heading, null);
    assert.equal(sections[0].text, "");
  });
});

// ---------------------------------------------------------------------------
// splitByParagraphs(text, maxChars)
// ---------------------------------------------------------------------------
describe("splitByParagraphs", () => {
  it("text under maxChars returns single chunk", () => {
    const text = "Short paragraph.";
    const chunks = splitByParagraphs(text, 1000);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], "Short paragraph.");
  });

  it("text over maxChars splits at double-newline paragraph boundaries", () => {
    const para1 = "A".repeat(500);
    const para2 = "B".repeat(500);
    const text = para1 + "\n\n" + para2;
    const chunks = splitByParagraphs(text, 600);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0], para1);
    assert.equal(chunks[1], para2);
  });

  it("single long paragraph with no breaks still returns (does not infinite loop)", () => {
    const text = "X".repeat(2000);
    const chunks = splitByParagraphs(text, 500);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], text);
  });

  it("multiple paragraphs are combined up to maxChars", () => {
    const text = "A".repeat(100) + "\n\n" + "B".repeat(100) + "\n\n" + "C".repeat(100);
    const chunks = splitByParagraphs(text, 250);
    // First chunk: A + B = 200 + 2 (separator) = 202, fits under 250
    // Adding C would be 202 + 100 + 2 = 304 > 250, so C becomes second chunk
    assert.equal(chunks.length, 2);
    assert.ok(chunks[0].includes("A"));
    assert.ok(chunks[0].includes("B"));
    assert.equal(chunks[1], "C".repeat(100));
  });
});

// ---------------------------------------------------------------------------
// getPreview(text)
// ---------------------------------------------------------------------------
describe("getPreview", () => {
  it("short text (under 100 words) returned unchanged (after stripping heading markers)", () => {
    const text = "This is a short preview.";
    const preview = getPreview(text);
    assert.equal(preview, "This is a short preview.");
  });

  it("long text truncated with '...' appended", () => {
    const words = [];
    for (let i = 0; i < 200; i++) words.push(`word${i}`);
    const text = words.join(" ");
    const preview = getPreview(text);
    assert.ok(preview.endsWith("..."));
    // Should contain first 100 words
    assert.ok(preview.includes("word0"));
    assert.ok(preview.includes("word99"));
    assert.ok(!preview.includes("word100 "));
  });

  it("empty string returns empty string", () => {
    const preview = getPreview("");
    assert.equal(preview, "");
  });

  it("strips markdown heading markers from preview", () => {
    const text = "## Section Title\n\nSome content here.";
    const preview = getPreview(text);
    assert.ok(!preview.startsWith("##"));
    assert.ok(preview.includes("Section Title"));
    assert.ok(preview.includes("Some content here."));
  });
});

// ---------------------------------------------------------------------------
// contentHash(content)
// ---------------------------------------------------------------------------
describe("contentHash", () => {
  it("same input produces same output", () => {
    const hash1 = contentHash("hello world");
    const hash2 = contentHash("hello world");
    assert.equal(hash1, hash2);
  });

  it("different inputs produce different outputs", () => {
    const hash1 = contentHash("hello");
    const hash2 = contentHash("world");
    assert.notEqual(hash1, hash2);
  });

  it("returns a hex string", () => {
    const hash = contentHash("test content");
    assert.match(hash, /^[a-f0-9]+$/);
  });

  it("returns a 64-character SHA-256 hex digest", () => {
    const hash = contentHash("anything");
    assert.equal(hash.length, 64);
  });
});

// ---------------------------------------------------------------------------
// SemanticIndex class (integration tests with real SQLite + mocked fetch)
// ---------------------------------------------------------------------------
describe("SemanticIndex class", () => {
  const DIMS = 3072;
  let tmpDir;
  let originalFetch;
  let fetchCallCount;

  /** Generate a deterministic fake embedding vector for a given seed string. */
  function fakeEmbedding(seed) {
    const vec = new Array(DIMS).fill(0);
    for (let i = 0; i < Math.min(seed.length, DIMS); i++) {
      vec[i] = (seed.charCodeAt(i % seed.length) % 100) / 100;
    }
    return vec;
  }

  /**
   * Mock fetch that returns fake OpenAI embedding responses.
   * Each input text gets a deterministic embedding based on the text content.
   */
  function mockFetch(url, opts) {
    fetchCallCount++;
    const body = JSON.parse(opts.body);
    const data = body.input.map((text, index) => ({
      index,
      embedding: fakeEmbedding(text),
    }));
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data }),
    });
  }

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "semantic-test-"));

    // Create vault structure with some markdown files
    const notesDir = path.join(tmpDir, "notes");
    await fs.mkdir(notesDir, { recursive: true });

    await fs.writeFile(path.join(notesDir, "note-a.md"), `---
type: research
created: 2026-01-01
tags:
  - test
---
# Note A

This note discusses machine learning and neural networks.
`);

    await fs.writeFile(path.join(notesDir, "note-b.md"), `---
type: research
created: 2026-01-01
tags:
  - test
---
# Note B

This note covers database optimization and SQL queries.
`);

    await fs.writeFile(path.join(notesDir, "note-c.md"), `---
type: research
created: 2026-01-01
tags:
  - test
---
# Note C

A note about project management and agile methodology.
`);

    // Save and replace global fetch
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    // Restore fetch after each test in case a test forgot
    globalThis.fetch = originalFetch;
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await fs.rm(tmpDir, { recursive: true });
  });

  it("initialize() creates DB with expected tables", async () => {
    globalThis.fetch = mockFetch;
    fetchCallCount = 0;

    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath: path.join(tmpDir, "test-init.db"),
    });
    await idx.initialize();

    assert.ok(idx.db, "DB should be open");
    assert.ok(idx.isAvailable, "isAvailable should be true");

    // Check that tables exist by querying them
    const chunks = idx.db.prepare("SELECT count(*) as n FROM chunks").get();
    assert.equal(typeof chunks.n, "number");

    const files = idx.db.prepare("SELECT count(*) as n FROM files").get();
    assert.equal(typeof files.n, "number");

    await idx.shutdown();
    assert.equal(idx.db, null, "DB should be null after shutdown");
  });

  it("isAvailable is false without API key", async () => {
    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "",
      dbPath: path.join(tmpDir, "test-nokey.db"),
    });
    await idx.initialize();
    assert.ok(!idx.isAvailable, "isAvailable should be false without API key");
    await idx.shutdown();
  });

  it("reindexFile() stores chunks and file metadata", async () => {
    globalThis.fetch = mockFetch;
    fetchCallCount = 0;

    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath: path.join(tmpDir, "test-reindex.db"),
    });
    await idx.initialize();
    // Wait briefly for startup sync to finish or abort it
    await idx.shutdown();

    // Re-open with a clean DB to isolate reindexFile behavior
    const idx2 = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath: path.join(tmpDir, "test-reindex2.db"),
    });
    await idx2.initialize();
    await idx2.shutdown();

    // Re-open without startup sync side effects
    const dbPath = path.join(tmpDir, "test-reindex-isolated.db");
    const idx3 = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath,
    });
    await idx3.initialize();

    // Give startup sync a moment then abort it
    idx3._abortController.abort();
    await new Promise(r => setTimeout(r, 100));

    fetchCallCount = 0;
    await idx3.reindexFile("notes/note-a.md");

    // Verify file record was created
    const fileRow = idx3.db.prepare("SELECT * FROM files WHERE path = ?").get("notes/note-a.md");
    assert.ok(fileRow, "File record should exist");
    assert.equal(fileRow.path, "notes/note-a.md");
    assert.ok(fileRow.content_hash.length === 64, "Should have SHA-256 hash");
    assert.ok(fileRow.chunk_count >= 1, "Should have at least 1 chunk");

    // Verify chunks were created
    const chunkRows = idx3.db.prepare("SELECT * FROM chunks WHERE file_path = ?").all("notes/note-a.md");
    assert.ok(chunkRows.length >= 1, "Should have chunks in DB");
    assert.equal(chunkRows[0].file_path, "notes/note-a.md");
    assert.ok(chunkRows[0].content_preview.length > 0);

    // Verify fetch was called (embedding API)
    assert.ok(fetchCallCount >= 1, "Should have called fetch for embeddings");

    await idx3.shutdown();
  });

  it("reindexFile() is idempotent (skips unchanged files)", async () => {
    globalThis.fetch = mockFetch;

    const dbPath = path.join(tmpDir, "test-idempotent.db");
    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath,
    });
    await idx.initialize();
    idx._abortController.abort();
    await new Promise(r => setTimeout(r, 100));

    fetchCallCount = 0;
    await idx.reindexFile("notes/note-b.md");
    const firstCallCount = fetchCallCount;
    assert.ok(firstCallCount >= 1, "First index should call fetch");

    // Re-index same file without changes
    fetchCallCount = 0;
    await idx.reindexFile("notes/note-b.md");
    assert.equal(fetchCallCount, 0, "Second index should skip (no changes)");

    await idx.shutdown();
  });

  it("removeFile() deletes chunks and file record", async () => {
    globalThis.fetch = mockFetch;

    const dbPath = path.join(tmpDir, "test-remove.db");
    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath,
    });
    await idx.initialize();
    idx._abortController.abort();
    await new Promise(r => setTimeout(r, 100));

    await idx.reindexFile("notes/note-a.md");

    // Verify it's indexed
    const before = idx.db.prepare("SELECT count(*) as n FROM chunks WHERE file_path = ?").get("notes/note-a.md");
    assert.ok(before.n >= 1);

    // Remove it
    idx.removeFile("notes/note-a.md");

    // Verify it's gone
    const afterChunks = idx.db.prepare("SELECT count(*) as n FROM chunks WHERE file_path = ?").get("notes/note-a.md");
    assert.equal(afterChunks.n, 0, "Chunks should be removed");

    const afterFiles = idx.db.prepare("SELECT count(*) as n FROM files WHERE path = ?").get("notes/note-a.md");
    assert.equal(afterFiles.n, 0, "File record should be removed");

    await idx.shutdown();
  });

  it("search() returns formatted results", async () => {
    globalThis.fetch = mockFetch;

    const dbPath = path.join(tmpDir, "test-search.db");
    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath,
    });
    await idx.initialize();
    idx._abortController.abort();
    await new Promise(r => setTimeout(r, 100));

    // Index all three notes
    await idx.reindexFile("notes/note-a.md");
    await idx.reindexFile("notes/note-b.md");
    await idx.reindexFile("notes/note-c.md");

    const result = await idx.search({ query: "machine learning" });
    assert.equal(typeof result, "string");
    assert.ok(result.includes("semantically related note"), `Expected formatted header but got: ${result}`);
    assert.ok(result.includes("score:"), "Should include score");

    await idx.shutdown();
  });

  it("search() respects limit param", async () => {
    globalThis.fetch = mockFetch;

    const dbPath = path.join(tmpDir, "test-search-limit.db");
    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath,
    });
    await idx.initialize();
    idx._abortController.abort();
    await new Promise(r => setTimeout(r, 100));

    await idx.reindexFile("notes/note-a.md");
    await idx.reindexFile("notes/note-b.md");
    await idx.reindexFile("notes/note-c.md");

    const result = await idx.search({ query: "test query", limit: 1 });
    assert.ok(result.includes("1 semantically related note"), `Expected 1 result but got: ${result}`);

    await idx.shutdown();
  });

  it("search() with folder filter restricts results", async () => {
    globalThis.fetch = mockFetch;

    const dbPath = path.join(tmpDir, "test-search-folder.db");
    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath,
    });
    await idx.initialize();
    idx._abortController.abort();
    await new Promise(r => setTimeout(r, 100));

    await idx.reindexFile("notes/note-a.md");

    // Search in a non-existent folder
    const result = await idx.search({ query: "test", folder: "other-folder" });
    assert.ok(result.includes("No semantically related notes found"), `Folder filter should exclude results but got: ${result}`);

    await idx.shutdown();
  });

  it("search() throws when not available", async () => {
    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "",
      dbPath: path.join(tmpDir, "test-unavail.db"),
    });
    await idx.initialize();
    await assert.rejects(() => idx.search({ query: "test" }), /not available/);
    await idx.shutdown();
  });

  it("searchRaw() returns array of result objects", async () => {
    globalThis.fetch = mockFetch;

    const dbPath = path.join(tmpDir, "test-searchraw.db");
    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath,
    });
    await idx.initialize();
    idx._abortController.abort();
    await new Promise(r => setTimeout(r, 100));

    await idx.reindexFile("notes/note-a.md");
    await idx.reindexFile("notes/note-b.md");

    const results = await idx.searchRaw({ query: "database queries" });
    assert.ok(Array.isArray(results), "Should return an array");
    assert.ok(results.length >= 1, "Should have results");
    assert.ok(results[0].path, "Each result should have path");
    assert.equal(typeof results[0].score, "number", "Each result should have numeric score");
    assert.ok(results[0].preview, "Each result should have preview");

    await idx.shutdown();
  });

  it("searchRaw() respects excludeFiles", async () => {
    globalThis.fetch = mockFetch;

    const dbPath = path.join(tmpDir, "test-searchraw-exclude.db");
    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath,
    });
    await idx.initialize();
    idx._abortController.abort();
    await new Promise(r => setTimeout(r, 100));

    await idx.reindexFile("notes/note-a.md");
    await idx.reindexFile("notes/note-b.md");

    const results = await idx.searchRaw({
      query: "test",
      excludeFiles: new Set(["notes/note-a.md"]),
    });
    const paths = results.map(r => r.path);
    assert.ok(!paths.includes("notes/note-a.md"), "Excluded file should not appear");

    await idx.shutdown();
  });

  it("shutdown() is safe to call multiple times", async () => {
    globalThis.fetch = mockFetch;

    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath: path.join(tmpDir, "test-shutdown.db"),
    });
    await idx.initialize();
    await idx.shutdown();
    // Second shutdown should not throw
    await idx.shutdown();
    assert.equal(idx.db, null);
  });

  it("reindexFile() is a no-op when db is null", async () => {
    globalThis.fetch = mockFetch;

    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath: path.join(tmpDir, "test-noop.db"),
    });
    // Don't initialize - db is null
    await idx.reindexFile("notes/note-a.md");
    // Should not throw
  });

  it("removeFile() is a no-op when db is null", () => {
    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath: path.join(tmpDir, "test-remove-noop.db"),
    });
    // Don't initialize - db is null
    idx.removeFile("notes/note-a.md");
    // Should not throw
  });

  it("reindexFile() calls removeFile for deleted files (ENOENT)", async () => {
    globalThis.fetch = mockFetch;

    const dbPath = path.join(tmpDir, "test-enoent.db");
    const idx = new SemanticIndex({
      vaultPath: tmpDir,
      openaiApiKey: "test-key",
      dbPath,
    });
    await idx.initialize();
    idx._abortController.abort();
    await new Promise(r => setTimeout(r, 100));

    // Index a file first
    await idx.reindexFile("notes/note-a.md");
    const beforeCount = idx.db.prepare("SELECT count(*) as n FROM chunks WHERE file_path = ?").get("notes/note-a.md").n;
    assert.ok(beforeCount >= 1);

    // Now "delete" it by reindexing a non-existent path
    await idx.reindexFile("notes/deleted-file.md");
    // Should not throw, and deleted-file should have no chunks
    const afterCount = idx.db.prepare("SELECT count(*) as n FROM chunks WHERE file_path = ?").get("notes/deleted-file.md").n;
    assert.equal(afterCount, 0);

    await idx.shutdown();
  });
});
