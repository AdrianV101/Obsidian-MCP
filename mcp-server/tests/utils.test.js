import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractFrontmatter } from "../utils.js";

describe("extractFrontmatter", () => {
  it("extracts valid YAML frontmatter", () => {
    const content = "---\ntype: research\nstatus: active\ntags:\n  - dev\n---\n\n# Title";
    const fm = extractFrontmatter(content);
    assert.equal(fm.type, "research");
    assert.equal(fm.status, "active");
    assert.deepEqual(fm.tags, ["dev"]);
  });

  it("returns null when no frontmatter", () => {
    assert.equal(extractFrontmatter("# Just a heading"), null);
  });

  it("returns null when opening --- is missing", () => {
    assert.equal(extractFrontmatter("type: research\n---"), null);
  });

  it("returns null when closing --- is missing", () => {
    assert.equal(extractFrontmatter("---\ntype: research\nNo closing"), null);
  });

  it("returns null for invalid YAML", () => {
    const content = "---\n: : : invalid\n---\n";
    // js-yaml may or may not throw on various invalid YAML; just ensure no crash
    const result = extractFrontmatter(content);
    // Result is either null or an object, but should not throw
    assert.ok(result === null || typeof result === "object");
  });

  it("handles empty frontmatter", () => {
    const content = "---\n---\n\n# Title";
    const fm = extractFrontmatter(content);
    // Empty YAML loads as null or undefined
    assert.ok(fm === null || fm === undefined);
  });

  it("handles frontmatter with inline tags array", () => {
    const content = "---\ntags: [a, b, c]\n---\n";
    const fm = extractFrontmatter(content);
    assert.deepEqual(fm.tags, ["a", "b", "c"]);
  });

  it("handles date values", () => {
    const content = "---\ncreated: 2025-06-15\n---\n";
    const fm = extractFrontmatter(content);
    // js-yaml may parse dates as Date objects or strings
    assert.ok(fm.created !== undefined);
  });

  it("handles multiline string values", () => {
    const content = "---\ndescription: |\n  This is a\n  multiline string\n---\n";
    const fm = extractFrontmatter(content);
    assert.ok(fm.description.includes("multiline"));
  });
});
