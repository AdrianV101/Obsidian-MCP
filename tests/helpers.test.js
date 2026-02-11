import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import {
  resolvePath,
  matchesFilters,
  formatMetadata,
  countOccurrences,
  extractTemplateDescription,
  substituteTemplateVariables,
  validateFrontmatterStrict,
  extractInlineTags,
  matchesTagPattern,
  parseHeadingLevel,
  findSectionRange,
  listHeadings,
  extractTailSections,
  buildBasenameMap,
  resolveFuzzyPath,
  resolveFuzzyFolder,
  computePeek,
  formatPeek,
  updateFrontmatter,
  compareFrontmatterValues,
  AUTO_REDIRECT_THRESHOLD,
  FORCE_HARD_CAP,
  CHUNK_SIZE,
} from "../helpers.js";

describe("resolvePath", () => {
  const vault = "/home/user/vault";

  it("resolves a simple relative path", () => {
    assert.equal(resolvePath("notes/hello.md", vault), path.join(vault, "notes/hello.md"));
  });

  it("resolves empty string to vault root", () => {
    assert.equal(resolvePath("", vault), vault);
  });

  it("throws on directory traversal with ../", () => {
    assert.throws(() => resolvePath("../etc/passwd", vault), /escapes vault/);
  });

  it("throws on absolute path outside vault", () => {
    assert.throws(() => resolvePath("/etc/passwd", vault), /escapes vault/);
  });

  it("blocks prefix-based bypass (vault-evil)", () => {
    // /home/user/vault-evil starts with /home/user/vault but is outside
    assert.throws(() => resolvePath("../vault-evil/file.md", "/home/user/vault"), /escapes vault/);
  });

  it("allows nested path within vault", () => {
    const result = resolvePath("a/b/c/d.md", vault);
    assert.equal(result, path.join(vault, "a/b/c/d.md"));
  });

  it("normalizes redundant separators", () => {
    const result = resolvePath("notes//hello.md", vault);
    assert.ok(result.startsWith(vault));
  });
});

describe("matchesFilters", () => {
  const meta = {
    type: "research",
    status: "active",
    tags: ["dev", "MCP", "tools"],
    created: "2025-06-15",
  };

  it("returns false for null metadata", () => {
    assert.equal(matchesFilters(null, { type: "research" }), false);
  });

  it("matches type filter", () => {
    assert.equal(matchesFilters(meta, { type: "research" }), true);
    assert.equal(matchesFilters(meta, { type: "adr" }), false);
  });

  it("matches status filter", () => {
    assert.equal(matchesFilters(meta, { status: "active" }), true);
    assert.equal(matchesFilters(meta, { status: "archived" }), false);
  });

  it("matches tags (all required)", () => {
    assert.equal(matchesFilters(meta, { tags: ["dev", "mcp"] }), true);
    assert.equal(matchesFilters(meta, { tags: ["dev", "nonexistent"] }), false);
  });

  it("tags matching is case-insensitive", () => {
    assert.equal(matchesFilters(meta, { tags: ["DEV", "MCP"] }), true);
  });

  it("matches tags_any (any one required)", () => {
    assert.equal(matchesFilters(meta, { tags_any: ["nonexistent", "dev"] }), true);
    assert.equal(matchesFilters(meta, { tags_any: ["nonexistent", "other"] }), false);
  });

  it("matches created_after", () => {
    assert.equal(matchesFilters(meta, { created_after: "2025-06-01" }), true);
    assert.equal(matchesFilters(meta, { created_after: "2025-07-01" }), false);
  });

  it("matches created_before", () => {
    assert.equal(matchesFilters(meta, { created_before: "2025-12-31" }), true);
    assert.equal(matchesFilters(meta, { created_before: "2025-01-01" }), false);
  });

  it("handles Date objects in created field", () => {
    const metaWithDate = { ...meta, created: new Date("2025-06-15") };
    assert.equal(matchesFilters(metaWithDate, { created_after: "2025-06-01" }), true);
  });

  it("matches with empty filter object", () => {
    assert.equal(matchesFilters(meta, {}), true);
  });

  it("handles null tags in metadata gracefully", () => {
    const noTags = { type: "research" };
    assert.equal(matchesFilters(noTags, { tags: ["dev"] }), false);
  });

  it("matches custom_fields with exact string value", () => {
    const meta = { type: "task", status: "pending", priority: "high", tags: ["task"] };
    assert.ok(matchesFilters(meta, { custom_fields: { priority: "high" } }));
    assert.ok(!matchesFilters(meta, { custom_fields: { priority: "low" } }));
  });

  it("matches custom_fields with null (field missing or null)", () => {
    const meta = { type: "task", status: "pending", tags: ["task"] };
    assert.ok(matchesFilters(meta, { custom_fields: { due: null } }));
    assert.ok(!matchesFilters(meta, { custom_fields: { status: null } }));
  });

  it("matches custom_fields with Date values in metadata", () => {
    const meta = { type: "task", created: new Date("2026-02-10"), tags: ["task"] };
    assert.ok(matchesFilters(meta, { custom_fields: { created: "2026-02-10" } }));
  });

  it("custom_fields composes with other filters", () => {
    const meta = { type: "task", status: "pending", priority: "high", tags: ["task", "home"] };
    assert.ok(matchesFilters(meta, { type: "task", custom_fields: { priority: "high" } }));
    assert.ok(!matchesFilters(meta, { type: "task", custom_fields: { priority: "low" } }));
  });

  it("matches multiple custom_fields (all must match)", () => {
    const meta = { type: "task", priority: "high", project: "Home", tags: ["task"] };
    assert.ok(matchesFilters(meta, { custom_fields: { priority: "high", project: "Home" } }));
    assert.ok(!matchesFilters(meta, { custom_fields: { priority: "high", project: "Work" } }));
  });
});

describe("formatMetadata", () => {
  it("formats type, status, and created", () => {
    const { summary } = formatMetadata({ type: "adr", status: "accepted", created: "2025-01-01" });
    assert.ok(summary.includes("type: adr"));
    assert.ok(summary.includes("status: accepted"));
    assert.ok(summary.includes("created: 2025-01-01"));
  });

  it("formats tags", () => {
    const { tagLine } = formatMetadata({ tags: ["dev", "mcp"] });
    assert.equal(tagLine, "tags: dev, mcp");
  });

  it("returns empty tagLine when no tags", () => {
    const { tagLine } = formatMetadata({ type: "note" });
    assert.equal(tagLine, "");
  });

  it("handles Date objects in created field", () => {
    const { summary } = formatMetadata({ created: new Date("2025-06-15T00:00:00Z") });
    assert.ok(summary.includes("2025-06-15"));
  });
});

describe("countOccurrences", () => {
  it("counts non-overlapping occurrences", () => {
    assert.equal(countOccurrences("abcabc", "abc"), 2);
  });

  it("returns 0 for empty search string", () => {
    assert.equal(countOccurrences("abc", ""), 0);
  });

  it("returns 0 when not found", () => {
    assert.equal(countOccurrences("hello world", "xyz"), 0);
  });

  it("handles single character", () => {
    assert.equal(countOccurrences("aaa", "a"), 3);
  });

  it("non-overlapping: 'aaa' contains 'aa' once (non-overlapping)", () => {
    assert.equal(countOccurrences("aaa", "aa"), 1);
  });
});

describe("extractTemplateDescription", () => {
  it("extracts from first heading", () => {
    const content = "---\ntype: adr\n---\n\n# ADR-001: Use SQLite\n\nSome content";
    const desc = extractTemplateDescription(content, { type: "adr" });
    assert.ok(desc.includes("ADR-001"));
  });

  it("uses frontmatter description if present", () => {
    const content = "---\ndescription: My custom desc\n---\n\n# Title";
    const desc = extractTemplateDescription(content, { description: "My custom desc" });
    assert.equal(desc, "My custom desc");
  });

  it("replaces template variables with {title}", () => {
    const content = "---\ntype: note\n---\n\n# <% tp.file.title %>";
    const desc = extractTemplateDescription(content, { type: "note" });
    assert.ok(desc.includes("{title}"));
  });

  it("falls back to type-based description", () => {
    const content = "---\ntype: research\n---\n\n<!-- just a comment -->";
    const desc = extractTemplateDescription(content, { type: "research" });
    assert.equal(desc, "Template for research");
  });
});

describe("substituteTemplateVariables", () => {
  it("substitutes date variable", () => {
    const content = "---\ncreated: <% tp.date.now(\"YYYY-MM-DD\") %>\n---";
    const result = substituteTemplateVariables(content, {});
    assert.ok(!result.includes("tp.date.now"));
    assert.match(result, /\d{4}-\d{2}-\d{2}/);
  });

  it("substitutes file title", () => {
    const content = "# <% tp.file.title %>";
    const result = substituteTemplateVariables(content, { title: "My Note" });
    assert.equal(result, "# My Note");
  });

  it("defaults title to Untitled", () => {
    const content = "# <% tp.file.title %>";
    const result = substituteTemplateVariables(content, {});
    assert.equal(result, "# Untitled");
  });

  it("substitutes custom variables", () => {
    const content = "Hello <% name %>, welcome to <% place %>";
    const result = substituteTemplateVariables(content, {
      custom: { name: "Alice", place: "Wonderland" },
    });
    assert.equal(result, "Hello Alice, welcome to Wonderland");
  });

  it("substitutes frontmatter tags", () => {
    const content = "---\ntags:\n  - default\n---\n\n# Title";
    const result = substituteTemplateVariables(content, {
      frontmatter: { tags: ["custom", "tags"] },
    });
    assert.ok(result.includes("- custom"));
    assert.ok(result.includes("- tags"));
  });

  it("substitutes frontmatter scalar fields", () => {
    const content = "---\nstatus: draft\n---\n\n# Title";
    const result = substituteTemplateVariables(content, {
      frontmatter: { status: "active" },
    });
    assert.ok(result.includes("status: active"));
    assert.ok(!result.includes("status: draft"));
  });

  it("rejects frontmatter keys with regex-special characters (M4 injection)", () => {
    const content = "---\nstatus: draft\n---\n\n# Title";
    assert.throws(
      () => substituteTemplateVariables(content, {
        frontmatter: { "key.*": "injected" },
      }),
      /Invalid frontmatter key/
    );
  });

  it("rejects frontmatter keys starting with a digit", () => {
    const content = "---\nstatus: draft\n---\n\n# Title";
    assert.throws(
      () => substituteTemplateVariables(content, {
        frontmatter: { "1invalid": "value" },
      }),
      /Invalid frontmatter key/
    );
  });

  it("allows valid frontmatter keys with hyphens and underscores", () => {
    const content = "---\nmy-field_1: old\n---\n\n# Title";
    const result = substituteTemplateVariables(content, {
      frontmatter: { "my-field_1": "new" },
    });
    assert.ok(result.includes("my-field_1: new"));
  });

  it("skips null frontmatter values (leaves template default)", () => {
    const template = "---\ntype: task\nstatus: pending\npriority: normal\ndue: null\n---\n# Title\n";
    const result = substituteTemplateVariables(template, {
      title: "Test",
      frontmatter: { status: "done", due: null }
    });
    assert.ok(result.includes("status: done"), "should update status");
    assert.ok(result.includes("due: null"), "should leave due as template default");
  });

  it("skips undefined frontmatter values", () => {
    const template = "---\ntype: task\nstatus: pending\n---\n# Title\n";
    const result = substituteTemplateVariables(template, {
      title: "Test",
      frontmatter: { status: undefined }
    });
    assert.ok(result.includes("status: pending"), "should leave status as template default");
  });

  it("correctly splits frontmatter from body when --- appears mid-line in frontmatter value", () => {
    // Template with --- mid-line in frontmatter value should properly separate frontmatter from body
    const template = "---\ntype: task\nstatus: pending\ndescription: This --- is mid-line\n---\n# <% tp.file.title %>\n\nBody text.";
    const result = substituteTemplateVariables(template, {
      title: "Test Task",
      frontmatter: { status: "done" }
    });
    assert.ok(result.includes("# Test Task"), "title should be substituted");
    assert.ok(result.includes("status: done"), "frontmatter should be updated");
    assert.ok(result.includes("Body text."), "body should be preserved");
    assert.ok(!result.includes("<% tp.file.title %>"), "template variable should be replaced");
  });
});

describe("validateFrontmatterStrict", () => {
  it("valid frontmatter passes", () => {
    const content = "---\ntype: research\ncreated: 2025-01-01\ntags:\n  - dev\n---\n\n# Title";
    const { valid, errors } = validateFrontmatterStrict(content);
    assert.equal(valid, true);
    assert.equal(errors.length, 0);
  });

  it("missing type fails", () => {
    const content = "---\ncreated: 2025-01-01\ntags:\n  - dev\n---\n";
    const { valid, errors } = validateFrontmatterStrict(content);
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes("type")));
  });

  it("missing created fails", () => {
    const content = "---\ntype: research\ntags:\n  - dev\n---\n";
    const { valid, errors } = validateFrontmatterStrict(content);
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes("created")));
  });

  it("empty tags fails", () => {
    const content = "---\ntype: research\ncreated: 2025-01-01\ntags: []\n---\n";
    const { valid, errors } = validateFrontmatterStrict(content);
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes("tags")));
  });

  it("null tags in array fails", () => {
    const content = "---\ntype: research\ncreated: 2025-01-01\ntags:\n  -\n---\n";
    const { valid, errors } = validateFrontmatterStrict(content);
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes("tags")));
  });

  it("no frontmatter at all fails", () => {
    const { valid, errors } = validateFrontmatterStrict("# Just a heading");
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes("No frontmatter")));
  });

  it("detects unsubstituted template variables", () => {
    const content = "---\ntype: research\ncreated: 2025-01-01\ntags:\n  - dev\n---\n\n# <% tp.file.title %>";
    const { valid, errors } = validateFrontmatterStrict(content);
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes("Unsubstituted")));
  });
});

describe("extractInlineTags", () => {
  it("extracts simple inline tags", () => {
    const content = "---\ntype: note\n---\n\nSome text #dev and #mcp here";
    const tags = extractInlineTags(content);
    assert.deepEqual(tags.sort(), ["dev", "mcp"]);
  });

  it("ignores tags in frontmatter", () => {
    const content = "---\ntags:\n  - frontmatter-tag\n---\n\n#body-tag";
    const tags = extractInlineTags(content);
    assert.deepEqual(tags, ["body-tag"]);
  });

  it("ignores tags in code blocks", () => {
    const content = "---\ntype: note\n---\n\n```\n#not-a-tag\n```\n\n#real-tag";
    const tags = extractInlineTags(content);
    assert.deepEqual(tags, ["real-tag"]);
  });

  it("ignores tags in inline code", () => {
    const content = "---\ntype: note\n---\n\nUse `#not-a-tag` for something. #real-tag";
    const tags = extractInlineTags(content);
    assert.deepEqual(tags, ["real-tag"]);
  });

  it("handles hierarchical tags", () => {
    const content = "---\ntype: note\n---\n\n#dev/mcp #dev/tools";
    const tags = extractInlineTags(content);
    assert.ok(tags.includes("dev/mcp"));
    assert.ok(tags.includes("dev/tools"));
  });

  it("deduplicates tags", () => {
    const content = "---\ntype: note\n---\n\n#dev #dev #dev";
    const tags = extractInlineTags(content);
    assert.equal(tags.length, 1);
  });

  it("ignores heading markers", () => {
    const content = "---\ntype: note\n---\n\n## Heading\n\n#real-tag";
    const tags = extractInlineTags(content);
    assert.deepEqual(tags, ["real-tag"]);
  });

  it("does not match HTML color codes", () => {
    const content = "---\ntype: note\n---\n\nColor is &#123; and &amp;";
    const tags = extractInlineTags(content);
    assert.equal(tags.length, 0);
  });

  it("does not extract tags from frontmatter with --- mid-line in value", () => {
    // Frontmatter with --- mid-line should be properly excluded from inline tag extraction
    const content = "---\ntype: note\ntags:\n  - frontmatter-tag\ndescription: This --- has #fake-tag\n---\n\n#real-tag in body";
    const tags = extractInlineTags(content);
    assert.deepEqual(tags, ["real-tag"]);
    assert.ok(!tags.includes("fake-tag"), "tags inside frontmatter values should be ignored");
  });
});

describe("matchesTagPattern", () => {
  it("returns true when no pattern", () => {
    assert.equal(matchesTagPattern("anything", undefined), true);
  });

  it("exact match", () => {
    assert.equal(matchesTagPattern("dev", "dev"), true);
    assert.equal(matchesTagPattern("dev", "mcp"), false);
  });

  it("case-insensitive", () => {
    assert.equal(matchesTagPattern("Dev", "dev"), true);
    assert.equal(matchesTagPattern("dev", "DEV"), true);
  });

  it("prefix pattern (dev*)", () => {
    assert.equal(matchesTagPattern("development", "dev*"), true);
    assert.equal(matchesTagPattern("dev", "dev*"), true);
    assert.equal(matchesTagPattern("other", "dev*"), false);
  });

  it("suffix pattern (*fix)", () => {
    assert.equal(matchesTagPattern("bugfix", "*fix"), true);
    assert.equal(matchesTagPattern("fix", "*fix"), true);
    assert.equal(matchesTagPattern("fixing", "*fix"), false);
  });

  it("substring pattern (*mcp*)", () => {
    assert.equal(matchesTagPattern("my-mcp-tool", "*mcp*"), true);
    assert.equal(matchesTagPattern("mcp", "*mcp*"), true);
    assert.equal(matchesTagPattern("other", "*mcp*"), false);
  });

  it("hierarchical pattern (pkm/*)", () => {
    assert.equal(matchesTagPattern("pkm/tools", "pkm/*"), true);
    assert.equal(matchesTagPattern("pkm/tools/mcp", "pkm/*"), true);
    assert.equal(matchesTagPattern("pkm", "pkm/*"), true);
    assert.equal(matchesTagPattern("pkm-other", "pkm/*"), false);
  });
});

describe("parseHeadingLevel", () => {
  it("parses h1 through h6", () => {
    assert.equal(parseHeadingLevel("# Title"), 1);
    assert.equal(parseHeadingLevel("## Section"), 2);
    assert.equal(parseHeadingLevel("### Sub"), 3);
    assert.equal(parseHeadingLevel("#### Deep"), 4);
    assert.equal(parseHeadingLevel("##### Deeper"), 5);
    assert.equal(parseHeadingLevel("###### Deepest"), 6);
  });

  it("returns 0 for non-headings", () => {
    assert.equal(parseHeadingLevel("not a heading"), 0);
    assert.equal(parseHeadingLevel(""), 0);
    assert.equal(parseHeadingLevel("#no-space"), 0);
    assert.equal(parseHeadingLevel("####### seven hashes"), 0);
  });
});

describe("findSectionRange", () => {
  const doc = `---
type: note
---
# Title

Intro text.

## Section One

Content one.

## Section Two

Content two.

### Nested

Nested content.
`;

  it("finds a section with correct boundaries", () => {
    const range = findSectionRange(doc, "## Section One");
    assert.ok(range);
    const section = doc.slice(range.afterHeading, range.sectionEnd);
    assert.ok(section.includes("Content one."));
    assert.ok(!section.includes("Content two."));
  });

  it("handles nested headings within a section", () => {
    const range = findSectionRange(doc, "## Section Two");
    assert.ok(range);
    const section = doc.slice(range.afterHeading, range.sectionEnd);
    assert.ok(section.includes("Content two."));
    assert.ok(section.includes("### Nested"));
    assert.ok(section.includes("Nested content."));
  });

  it("returns null for heading not found", () => {
    assert.equal(findSectionRange(doc, "## Nonexistent"), null);
  });

  it("section extends to EOF when it is the last section at its level", () => {
    const range = findSectionRange(doc, "## Section Two");
    assert.ok(range);
    assert.equal(range.sectionEnd, doc.length);
  });

  it("includes heading line in headingStart..afterHeading span", () => {
    const range = findSectionRange(doc, "## Section One");
    assert.ok(range);
    const headingLine = doc.slice(range.headingStart, range.afterHeading);
    assert.ok(headingLine.startsWith("## Section One"));
  });

  it("does NOT match heading text embedded in a paragraph", () => {
    const content = "# Title\n\nThis paragraph mentions ## Section One inline.\n\n## Section One\n\nReal content.\n";
    const range = findSectionRange(content, "## Section One");
    assert.ok(range, "Should find the real heading");
    // headingStart must be at the line-start occurrence, not the inline one
    const before = content.slice(0, range.headingStart);
    assert.ok(before.includes("inline"), "The inline mention should be before the matched heading");
    const section = content.slice(range.afterHeading, range.sectionEnd);
    assert.ok(section.includes("Real content."));
  });

  it("does NOT match heading text mid-line (e.g. in inline content)", () => {
    // The heading text appears mid-line, not at line start
    const content = "# Title\n\nSee also: ## Section One is referenced here.\n\n## Section One\n\nReal content.\n";
    const range = findSectionRange(content, "## Section One");
    assert.ok(range, "Should find the line-anchored heading");
    const section = content.slice(range.afterHeading, range.sectionEnd);
    assert.ok(section.includes("Real content."));
    // Ensure it did NOT match the mid-line occurrence
    assert.ok(range.headingStart > content.indexOf("See also:"), "Should skip the mid-line match");
  });

  it("matches heading at the very start of the string", () => {
    const content = "## Section One\n\nContent here.\n";
    const range = findSectionRange(content, "## Section One");
    assert.ok(range, "Should find heading at start of string");
    assert.equal(range.headingStart, 0);
  });
});

describe("listHeadings", () => {
  it("lists all headings excluding frontmatter", () => {
    const content = `---
type: note
---
# Title

## Section One

### Sub

## Section Two
`;
    const headings = listHeadings(content);
    assert.deepEqual(headings, ["# Title", "## Section One", "### Sub", "## Section Two"]);
  });

  it("returns empty array for no headings", () => {
    const content = "Just plain text\nwith no headings.\n";
    assert.deepEqual(listHeadings(content), []);
  });

  it("excludes headings inside frontmatter", () => {
    const content = `---
# Not a heading
type: note
---
## Real Heading
`;
    const headings = listHeadings(content);
    assert.deepEqual(headings, ["## Real Heading"]);
  });
});

describe("extractTailSections", () => {
  const doc = `---
type: devlog
created: 2026-01-01
tags:
  - dev
---
# Devlog

## 2026-01-01

Entry one.

## 2026-01-15

Entry two.

## 2026-02-01

Entry three.
`;

  it("extracts last N sections at given level", () => {
    const result = extractTailSections(doc, 2, 2);
    assert.ok(result.includes("## 2026-01-15"));
    assert.ok(result.includes("## 2026-02-01"));
    assert.ok(!result.includes("## 2026-01-01"));
  });

  it("preserves frontmatter", () => {
    const result = extractTailSections(doc, 1, 2);
    assert.ok(result.startsWith("---"));
    assert.ok(result.includes("type: devlog"));
    assert.ok(result.includes("## 2026-02-01"));
  });

  it("returns full content when N exceeds available sections", () => {
    const result = extractTailSections(doc, 100, 2);
    assert.ok(result.includes("## 2026-01-01"));
    assert.ok(result.includes("## 2026-01-15"));
    assert.ok(result.includes("## 2026-02-01"));
  });

  it("uses custom heading level", () => {
    const result = extractTailSections(doc, 1, 1);
    // Only one # heading, so it should include everything under it
    assert.ok(result.includes("# Devlog"));
  });

  it("returns full content when no headings match level", () => {
    const result = extractTailSections(doc, 2, 4);
    assert.ok(result.includes("## 2026-01-01"));
    assert.ok(result.includes("## 2026-02-01"));
  });

  it("handles content without frontmatter", () => {
    const noFm = "## A\n\nContent A.\n\n## B\n\nContent B.\n";
    const result = extractTailSections(noFm, 1, 2);
    assert.ok(result.includes("## B"));
    assert.ok(!result.includes("## A"));
  });
});

describe("buildBasenameMap", () => {
  it("maps lowercase basenames to full paths", () => {
    const files = [
      "01-Projects/MyApp/devlog.md",
      "01-Projects/Other/devlog.md",
      "notes/unique-note.md",
    ];
    const { basenameMap, allFilesSet } = buildBasenameMap(files);

    assert.deepStrictEqual(basenameMap.get("devlog"), [
      "01-Projects/MyApp/devlog.md",
      "01-Projects/Other/devlog.md",
    ]);
    assert.deepStrictEqual(basenameMap.get("unique-note"), ["notes/unique-note.md"]);
    assert.equal(allFilesSet.has("notes/unique-note.md"), true);
  });

  it("handles empty file list", () => {
    const { basenameMap, allFilesSet } = buildBasenameMap([]);
    assert.equal(basenameMap.size, 0);
    assert.equal(allFilesSet.size, 0);
  });

  it("is case-insensitive for basenames", () => {
    const { basenameMap } = buildBasenameMap(["notes/MyNote.md"]);
    assert.deepStrictEqual(basenameMap.get("mynote"), ["notes/MyNote.md"]);
  });
});

describe("resolveFuzzyPath", () => {
  const files = [
    "01-Projects/MyApp/devlog.md",
    "01-Projects/Other/devlog.md",
    "notes/unique-note.md",
    "research/deep-dive.md",
  ];
  let basenameMap, allFilesSet;

  before(() => {
    ({ basenameMap, allFilesSet } = buildBasenameMap(files));
  });

  it("returns exact path unchanged when it exists in file set", () => {
    const result = resolveFuzzyPath("notes/unique-note.md", basenameMap, allFilesSet);
    assert.equal(result, "notes/unique-note.md");
  });

  it("resolves basename without extension", () => {
    const result = resolveFuzzyPath("unique-note", basenameMap, allFilesSet);
    assert.equal(result, "notes/unique-note.md");
  });

  it("resolves basename with .md extension", () => {
    const result = resolveFuzzyPath("unique-note.md", basenameMap, allFilesSet);
    assert.equal(result, "notes/unique-note.md");
  });

  it("throws on ambiguous basename", () => {
    assert.throws(
      () => resolveFuzzyPath("devlog", basenameMap, allFilesSet),
      (err) => {
        assert.match(err.message, /matches 2 files/);
        assert.match(err.message, /01-Projects\/MyApp\/devlog\.md/);
        assert.match(err.message, /01-Projects\/Other\/devlog\.md/);
        return true;
      }
    );
  });

  it("throws on no match", () => {
    assert.throws(
      () => resolveFuzzyPath("nonexistent", basenameMap, allFilesSet),
      (err) => {
        assert.match(err.message, /not found/i);
        return true;
      }
    );
  });

  it("resolves ambiguous basename when scoped to a folder", () => {
    const result = resolveFuzzyPath("devlog", basenameMap, allFilesSet, "01-Projects/MyApp");
    assert.equal(result, "01-Projects/MyApp/devlog.md");
  });

  it("resolves exact path with .md added", () => {
    const result = resolveFuzzyPath("notes/unique-note", basenameMap, allFilesSet);
    assert.equal(result, "notes/unique-note.md");
  });
});

describe("resolveFuzzyFolder", () => {
  const allFiles = [
    "01-Projects/Obsidian-MCP/development/devlog.md",
    "01-Projects/Obsidian-MCP/research/note.md",
    "01-Projects/MyApp/development/devlog.md",
    "02-Areas/health/log.md",
  ];

  it("returns exact folder when it matches a known directory", () => {
    const result = resolveFuzzyFolder("01-Projects/Obsidian-MCP", allFiles);
    assert.equal(result, "01-Projects/Obsidian-MCP");
  });

  it("resolves partial folder by substring match", () => {
    const result = resolveFuzzyFolder("Obsidian-MCP", allFiles);
    assert.equal(result, "01-Projects/Obsidian-MCP");
  });

  it("throws on ambiguous folder", () => {
    assert.throws(
      () => resolveFuzzyFolder("development", allFiles),
      (err) => {
        assert.match(err.message, /matches \d+ folders/);
        return true;
      }
    );
  });

  it("throws on no match", () => {
    assert.throws(
      () => resolveFuzzyFolder("nonexistent", allFiles),
      (err) => {
        assert.match(err.message, /not found/i);
        return true;
      }
    );
  });

  it("is case-insensitive", () => {
    const result = resolveFuzzyFolder("obsidian-mcp", allFiles);
    assert.equal(result, "01-Projects/Obsidian-MCP");
  });
});

describe("constants", () => {
  it("exports AUTO_REDIRECT_THRESHOLD as 80000", () => {
    assert.equal(AUTO_REDIRECT_THRESHOLD, 80_000);
  });

  it("exports FORCE_HARD_CAP as 400000", () => {
    assert.equal(FORCE_HARD_CAP, 400_000);
  });

  it("exports CHUNK_SIZE as 80000", () => {
    assert.equal(CHUNK_SIZE, 80_000);
  });
});

describe("computePeek", () => {
  it("returns correct size metrics", () => {
    const content = "---\ntype: note\ncreated: 2026-01-01\ntags:\n  - test\n---\n# Title\n\nLine 1\nLine 2\n";
    const result = computePeek(content, "test/note.md");
    assert.equal(result.sizeChars, content.length);
    assert.equal(result.sizeLines, content.split("\n").length);
    assert.equal(result.path, "test/note.md");
  });

  it("extracts frontmatter", () => {
    const content = "---\ntype: research\ncreated: 2026-01-01\ntags:\n  - dev\n---\n# Title\n";
    const result = computePeek(content, "test.md");
    assert.equal(result.frontmatter.type, "research");
    assert.deepEqual(result.frontmatter.tags, ["dev"]);
  });

  it("returns null frontmatter for files without it", () => {
    const content = "# Just a heading\n\nSome content.\n";
    const result = computePeek(content, "test.md");
    assert.equal(result.frontmatter, null);
  });

  it("builds heading outline with line numbers and levels", () => {
    const content = "---\ntype: note\ncreated: 2026-01-01\ntags:\n  - t\n---\n# Title\n\n## Section One\n\nContent.\n\n## Section Two\n\nMore.\n";
    const result = computePeek(content, "test.md");
    assert.equal(result.headings.length, 3);
    assert.equal(result.headings[0].heading, "# Title");
    assert.equal(result.headings[0].level, 1);
    assert.equal(result.headings[1].heading, "## Section One");
    assert.equal(result.headings[1].level, 2);
    assert.equal(result.headings[2].heading, "## Section Two");
    assert.equal(result.headings[2].level, 2);
  });

  it("includes line numbers for headings", () => {
    const content = "# Title\n\n## Section\n\nText.\n";
    const result = computePeek(content, "test.md");
    assert.equal(result.headings[0].lineNumber, 1);
    assert.equal(result.headings[1].lineNumber, 3);
  });

  it("includes line numbers accounting for frontmatter", () => {
    const content = "---\ntype: note\ncreated: 2026-01-01\ntags:\n  - t\n---\n# Title\n";
    const result = computePeek(content, "test.md");
    assert.equal(result.headings[0].lineNumber, 7);
  });

  it("computes approximate char counts per section", () => {
    const content = "# Title\n\n## Short\n\nHi.\n\n## Long\n\n" + "x".repeat(500) + "\n";
    const result = computePeek(content, "test.md");
    const shortSection = result.headings.find(h => h.heading === "## Short");
    const longSection = result.headings.find(h => h.heading === "## Long");
    assert.ok(longSection.charCount > shortSection.charCount);
  });

  it("computes totalChunks", () => {
    const content = "x".repeat(200_000);
    const result = computePeek(content, "big.md");
    assert.equal(result.totalChunks, 3); // 200k / 80k = 2.5, ceil = 3
  });

  it("totalChunks is 1 for small files", () => {
    const content = "Small file.\n";
    const result = computePeek(content, "small.md");
    assert.equal(result.totalChunks, 1);
  });

  it("returns preview of first ~10 non-frontmatter lines", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
    const content = "---\ntype: note\ncreated: 2026-01-01\ntags:\n  - t\n---\n" + lines.join("\n") + "\n";
    const result = computePeek(content, "test.md");
    assert.ok(result.preview.includes("Line 1"));
    assert.ok(result.preview.includes("Line 10"));
    assert.ok(!result.preview.includes("Line 11"));
  });

  it("handles empty file", () => {
    const result = computePeek("", "empty.md");
    assert.equal(result.sizeChars, 0);
    assert.equal(result.sizeLines, 1); // "".split("\n") = [""]
    assert.equal(result.headings.length, 0);
    assert.equal(result.frontmatter, null);
    assert.equal(result.totalChunks, 0);
  });

  it("handles file with only frontmatter", () => {
    const content = "---\ntype: note\ncreated: 2026-01-01\ntags:\n  - t\n---\n";
    const result = computePeek(content, "test.md");
    assert.equal(result.headings.length, 0);
    assert.ok(result.frontmatter !== null);
    assert.equal(result.preview, "");
  });
});

describe("formatPeek", () => {
  const basePeekData = {
    path: "notes/big.md",
    sizeChars: 90000,
    sizeLines: 2000,
    frontmatter: { type: "devlog", created: "2026-01-01", tags: ["dev"] },
    headings: [
      { heading: "# Title", level: 1, lineNumber: 7, charCount: 100 },
      { heading: "## Section A", level: 2, lineNumber: 10, charCount: 45000 },
      { heading: "## Section B", level: 2, lineNumber: 500, charCount: 400 },
    ],
    preview: "Some preview text here.",
    totalChunks: 2,
  };

  it("includes file path and size info", () => {
    const text = formatPeek(basePeekData);
    assert.ok(text.includes("notes/big.md"));
    assert.ok(text.includes("90,000") || text.includes("90000"));
    assert.ok(text.includes("2,000") || text.includes("2000"));
  });

  it("includes heading outline with line numbers", () => {
    const text = formatPeek(basePeekData);
    assert.ok(text.includes("# Title"));
    assert.ok(text.includes("## Section A"));
    assert.ok(text.includes("## Section B"));
    assert.match(text, /L\d+/);
  });

  it("includes frontmatter fields", () => {
    const text = formatPeek(basePeekData);
    assert.ok(text.includes("devlog"));
  });

  it("includes preview", () => {
    const text = formatPeek(basePeekData);
    assert.ok(text.includes("Some preview text here."));
  });

  it("includes redirect guidance when redirected=true", () => {
    const text = formatPeek(basePeekData, { redirected: true });
    assert.ok(text.includes("heading"));
    assert.ok(text.includes("chunk"));
    assert.ok(text.includes("force"));
  });

  it("omits redirect guidance when not redirected", () => {
    const text = formatPeek(basePeekData);
    assert.ok(!text.includes("force"));
  });

  it("handles null frontmatter", () => {
    const data = { ...basePeekData, frontmatter: null };
    const text = formatPeek(data);
    assert.ok(text.includes("notes/big.md"));
  });

  it("handles empty headings", () => {
    const data = { ...basePeekData, headings: [] };
    const text = formatPeek(data);
    assert.ok(text.includes("notes/big.md"));
  });
});

describe("updateFrontmatter", () => {
  it("updates an existing field", () => {
    const content = "---\ntype: task\nstatus: pending\ncreated: 2026-02-10\ntags:\n  - task\n---\n# Title\n\nBody text.\n";
    const { content: result, frontmatter } = updateFrontmatter(content, { status: "done" });
    assert.equal(frontmatter.status, "done");
    assert.ok(result.includes("Body text."), "body preserved");
    assert.equal(frontmatter.type, "task", "other fields preserved");
  });

  it("creates a new field that does not exist", () => {
    const content = "---\ntype: task\nstatus: pending\ncreated: 2026-02-10\ntags:\n  - task\n---\n# Title\n";
    const { frontmatter } = updateFrontmatter(content, { completed: "2026-02-10" });
    assert.equal(frontmatter.completed, "2026-02-10");
    assert.equal(frontmatter.status, "pending", "existing fields preserved");
  });

  it("removes a field when value is null", () => {
    const content = "---\ntype: task\nstatus: pending\npriority: high\ncreated: 2026-02-10\ntags:\n  - task\n---\n# Title\n";
    const { content: result, frontmatter } = updateFrontmatter(content, { priority: null });
    assert.equal(frontmatter.priority, undefined);
    assert.ok(!result.includes("priority:"), "field removed from output");
  });

  it("protects required field: type cannot be set to null", () => {
    const content = "---\ntype: task\ncreated: 2026-02-10\ntags:\n  - task\n---\n# Title\n";
    assert.throws(() => updateFrontmatter(content, { type: null }), /cannot remove.*type/i);
  });

  it("protects required field: created cannot be set to null", () => {
    const content = "---\ntype: task\ncreated: 2026-02-10\ntags:\n  - task\n---\n# Title\n";
    assert.throws(() => updateFrontmatter(content, { created: null }), /cannot remove.*created/i);
  });

  it("protects required field: tags cannot be set to null", () => {
    const content = "---\ntype: task\ncreated: 2026-02-10\ntags:\n  - task\n---\n# Title\n";
    assert.throws(() => updateFrontmatter(content, { tags: null }), /cannot remove.*tags/i);
  });

  it("rejects empty tags array", () => {
    const content = "---\ntype: task\ncreated: 2026-02-10\ntags:\n  - task\n---\n# Title\n";
    assert.throws(() => updateFrontmatter(content, { tags: [] }), /tags.*non-empty/i);
  });

  it("replaces tags array wholesale", () => {
    const content = "---\ntype: task\ncreated: 2026-02-10\ntags:\n  - task\n---\n# Title\n";
    const { frontmatter } = updateFrontmatter(content, { tags: ["task", "grocery", "home"] });
    assert.deepEqual(frontmatter.tags, ["task", "grocery", "home"]);
  });

  it("allows updating type to a new string value", () => {
    const content = "---\ntype: task\ncreated: 2026-02-10\ntags:\n  - task\n---\n# Title\n";
    const { frontmatter } = updateFrontmatter(content, { type: "project" });
    assert.equal(frontmatter.type, "project");
  });

  it("throws on file with no frontmatter", () => {
    const content = "# Title\n\nNo frontmatter here.\n";
    assert.throws(() => updateFrontmatter(content, { status: "done" }), /no frontmatter/i);
  });

  it("throws on unclosed frontmatter", () => {
    const content = "---\ntype: task\nstatus: pending\n# Title\nBody text\n";
    assert.throws(() => updateFrontmatter(content, { status: "done" }), /unclosed/i);
  });

  it("throws descriptive error on malformed YAML", () => {
    const content = "---\n: invalid: yaml: [broken\n---\n# Title\n";
    assert.throws(() => updateFrontmatter(content, { status: "done" }), /failed to parse/i);
  });

  it("rejects invalid field keys", () => {
    const content = "---\ntype: task\ncreated: 2026-02-10\ntags:\n  - task\n---\n# Title\n";
    assert.throws(() => updateFrontmatter(content, { "bad key!": "value" }), /invalid.*key/i);
  });

  it("handles multiple updates in one call", () => {
    const content = "---\ntype: task\nstatus: pending\npriority: normal\ncreated: 2026-02-10\ntags:\n  - task\n---\n# Title\n";
    const { frontmatter } = updateFrontmatter(content, {
      status: "done",
      priority: null,
      completed: "2026-02-10"
    });
    assert.equal(frontmatter.status, "done");
    assert.equal(frontmatter.priority, undefined);
    assert.equal(frontmatter.completed, "2026-02-10");
  });

  it("preserves body content exactly", () => {
    const body = "\n# My Task\n\n## Description\n\nBuy groceries for dinner.\n\n## Context\n\nWe need food.\n";
    const content = "---\ntype: task\ncreated: 2026-02-10\ntags:\n  - task\n---" + body;
    const { content: result } = updateFrontmatter(content, { status: "done" });
    assert.ok(result.endsWith(body), "body should be preserved exactly");
  });
});

describe("compareFrontmatterValues", () => {
  it("sorts priority with custom ranking (asc: low first)", () => {
    assert.ok(compareFrontmatterValues("low", "high", "priority") < 0);
    assert.ok(compareFrontmatterValues("urgent", "low", "priority") > 0);
    assert.ok(compareFrontmatterValues("normal", "normal", "priority") === 0);
  });

  it("sorts priority desc (urgent first)", () => {
    assert.ok(compareFrontmatterValues("urgent", "high", "priority") > 0);
    assert.ok(compareFrontmatterValues("high", "normal", "priority") > 0);
    assert.ok(compareFrontmatterValues("normal", "low", "priority") > 0);
  });

  it("sorts date-like values chronologically", () => {
    assert.ok(compareFrontmatterValues("2026-01-01", "2026-02-01", "due") < 0);
    assert.ok(compareFrontmatterValues("2026-12-31", "2026-01-01", "created") > 0);
    assert.ok(compareFrontmatterValues("2026-05-15", "2026-05-15", "completed") === 0);
  });

  it("sorts string values with localeCompare", () => {
    assert.ok(compareFrontmatterValues("alpha", "beta", "project") < 0);
    assert.ok(compareFrontmatterValues("zebra", "alpha", "project") > 0);
    assert.ok(compareFrontmatterValues("same", "same", "project") === 0);
  });

  it("null sorts last (positive) regardless of field", () => {
    assert.ok(compareFrontmatterValues(null, "high", "priority") > 0);
    assert.ok(compareFrontmatterValues("high", null, "priority") < 0);
    assert.equal(compareFrontmatterValues(null, null, "priority"), 0);
  });

  it("undefined sorts last like null", () => {
    assert.ok(compareFrontmatterValues(undefined, "2026-01-01", "due") > 0);
    assert.ok(compareFrontmatterValues("2026-01-01", undefined, "due") < 0);
  });

  it("treats unknown priority values as strings", () => {
    assert.ok(compareFrontmatterValues("critical", "zebra", "priority") < 0);
  });

  it("detects date values by pattern regardless of field name", () => {
    assert.ok(compareFrontmatterValues("2026-01-01", "2026-02-01", "my_custom_date") < 0);
  });

  it("handles Date objects (converted to string)", () => {
    const d1 = new Date("2026-01-01");
    const d2 = new Date("2026-06-15");
    assert.ok(compareFrontmatterValues(d1, d2, "created") < 0);
  });
});
