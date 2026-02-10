import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rewriteWikilinks } from "../graph.js";

describe("rewriteWikilinks", () => {
  it("rewrites [[old]] to [[new]]", () => {
    const content = "See [[target]] for details.";
    const result = rewriteWikilinks(content, "target", "renamed");
    assert.equal(result, "See [[renamed]] for details.");
  });

  it("preserves alias: [[old|display]] to [[new|display]]", () => {
    const content = "See [[target|Target Display]] for details.";
    const result = rewriteWikilinks(content, "target", "renamed");
    assert.equal(result, "See [[renamed|Target Display]] for details.");
  });

  it("preserves heading ref: [[old#heading]] to [[new#heading]]", () => {
    const content = "See [[target#section-a]] for details.";
    const result = rewriteWikilinks(content, "target", "renamed");
    assert.equal(result, "See [[renamed#section-a]] for details.");
  });

  it("preserves heading ref + alias: [[old#heading|display]] to [[new#heading|display]]", () => {
    const content = "See [[target#section-a|Section A]] for details.";
    const result = rewriteWikilinks(content, "target", "renamed");
    assert.equal(result, "See [[renamed#section-a|Section A]] for details.");
  });

  it("rewrites multiple occurrences in one file", () => {
    const content = "First [[target]], then [[target|alias]], and [[target#h]].";
    const result = rewriteWikilinks(content, "target", "renamed");
    assert.equal(result, "First [[renamed]], then [[renamed|alias]], and [[renamed#h]].");
  });

  it("does not rewrite links to other targets", () => {
    const content = "See [[target]] and [[other]].";
    const result = rewriteWikilinks(content, "target", "renamed");
    assert.equal(result, "See [[renamed]] and [[other]].");
  });

  it("handles full path old target: [[folder/target]] to [[new]]", () => {
    const content = "See [[moveable/target]] for details.";
    const result = rewriteWikilinks(content, "moveable/target", "archive/target");
    assert.equal(result, "See [[archive/target]] for details.");
  });

  it("returns content unchanged when no matching links", () => {
    const content = "No links to [[something-else]].";
    const result = rewriteWikilinks(content, "target", "renamed");
    assert.equal(result, content);
  });
});
