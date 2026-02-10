import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
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
