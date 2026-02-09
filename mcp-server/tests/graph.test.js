import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractWikilinks,
  buildLinkResolutionMap,
  resolveLink,
  formatNeighborhood,
} from "../graph.js";

describe("extractWikilinks", () => {
  it("extracts simple wikilinks", () => {
    const content = "See [[note-a]] and [[note-b]] for details.";
    const links = extractWikilinks(content);
    assert.deepEqual(links, ["note-a", "note-b"]);
  });

  it("extracts aliased wikilinks (keeps target, not alias)", () => {
    const content = "See [[real-note|display text]] here.";
    const links = extractWikilinks(content);
    assert.deepEqual(links, ["real-note"]);
  });

  it("extracts links with headings", () => {
    const content = "See [[note#section]] here.";
    const links = extractWikilinks(content);
    assert.deepEqual(links, ["note#section"]);
  });

  it("extracts links with paths", () => {
    const content = "See [[folder/subfolder/note]] here.";
    const links = extractWikilinks(content);
    assert.deepEqual(links, ["folder/subfolder/note"]);
  });

  it("returns empty array for no links", () => {
    assert.deepEqual(extractWikilinks("No links here"), []);
  });

  it("handles multiple links on one line", () => {
    const content = "[[a]] [[b]] [[c]]";
    assert.deepEqual(extractWikilinks(content), ["a", "b", "c"]);
  });

  it("handles link with alias and heading", () => {
    const content = "[[note#heading|display]]";
    const links = extractWikilinks(content);
    assert.deepEqual(links, ["note#heading"]);
  });
});

describe("buildLinkResolutionMap", () => {
  it("maps basenames to file paths", () => {
    const files = ["01-Projects/note.md", "02-Areas/note.md", "03-Resources/other.md"];
    const map = buildLinkResolutionMap(files);

    assert.deepEqual(map.get("note"), ["01-Projects/note.md", "02-Areas/note.md"]);
    assert.deepEqual(map.get("other"), ["03-Resources/other.md"]);
  });

  it("uses lowercase basenames", () => {
    const files = ["MyNote.md"];
    const map = buildLinkResolutionMap(files);
    assert.ok(map.has("mynote"));
    assert.ok(!map.has("MyNote"));
  });

  it("handles empty file list", () => {
    const map = buildLinkResolutionMap([]);
    assert.equal(map.size, 0);
  });
});

describe("resolveLink", () => {
  const files = [
    "01-Projects/note-a.md",
    "02-Areas/note-a.md",
    "03-Resources/unique.md",
    "folder/subfolder/deep.md",
  ];
  const resolutionMap = buildLinkResolutionMap(files);
  const allFilesSet = new Set(files);

  it("resolves exact path match", () => {
    const result = resolveLink("01-Projects/note-a", resolutionMap, allFilesSet);
    assert.deepEqual(result.paths, ["01-Projects/note-a.md"]);
    assert.equal(result.ambiguous, false);
  });

  it("resolves unique basename", () => {
    const result = resolveLink("unique", resolutionMap, allFilesSet);
    assert.deepEqual(result.paths, ["03-Resources/unique.md"]);
    assert.equal(result.ambiguous, false);
  });

  it("flags ambiguous basename", () => {
    const result = resolveLink("note-a", resolutionMap, allFilesSet);
    assert.equal(result.paths.length, 2);
    assert.equal(result.ambiguous, true);
  });

  it("strips heading references", () => {
    const result = resolveLink("unique#section", resolutionMap, allFilesSet);
    assert.deepEqual(result.paths, ["03-Resources/unique.md"]);
  });

  it("strips block references", () => {
    const result = resolveLink("unique^block-id", resolutionMap, allFilesSet);
    assert.deepEqual(result.paths, ["03-Resources/unique.md"]);
  });

  it("returns empty for nonexistent link", () => {
    const result = resolveLink("nonexistent", resolutionMap, allFilesSet);
    assert.deepEqual(result.paths, []);
    assert.equal(result.ambiguous, false);
  });

  it("returns empty for empty link target", () => {
    const result = resolveLink("#just-heading", resolutionMap, allFilesSet);
    assert.deepEqual(result.paths, []);
  });

  it("handles .md extension in link", () => {
    const result = resolveLink("01-Projects/note-a.md", resolutionMap, allFilesSet);
    assert.deepEqual(result.paths, ["01-Projects/note-a.md"]);
  });
});

describe("formatNeighborhood", () => {
  it("formats a simple neighborhood", () => {
    const depthGroups = new Map();
    depthGroups.set(0, [
      { path: "center.md", depth: 0, ambiguous: false, metadata: { type: "note", status: null, tags: [] } },
    ]);
    depthGroups.set(1, [
      { path: "neighbor.md", depth: 1, ambiguous: false, metadata: { type: "research", status: "active", tags: ["dev"] } },
    ]);

    const result = formatNeighborhood(
      { depthGroups, totalNodes: 2 },
      { startPath: "center.md", depth: 1, direction: "both" }
    );

    assert.ok(result.includes("center.md"));
    assert.ok(result.includes("neighbor.md"));
    assert.ok(result.includes("2 nodes"));
    assert.ok(result.includes("type: research"));
    assert.ok(result.includes("tags: dev"));
  });

  it("marks ambiguous nodes", () => {
    const depthGroups = new Map();
    depthGroups.set(0, [
      { path: "start.md", depth: 0, ambiguous: false, metadata: { type: null, status: null, tags: [] } },
    ]);
    depthGroups.set(1, [
      { path: "ambig.md", depth: 1, ambiguous: true, metadata: { type: null, status: null, tags: [] } },
    ]);

    const result = formatNeighborhood(
      { depthGroups, totalNodes: 2 },
      { startPath: "start.md", depth: 1, direction: "outgoing" }
    );

    assert.ok(result.includes("[ambiguous]"));
  });

  it("labels depth 0 as Center", () => {
    const depthGroups = new Map();
    depthGroups.set(0, [
      { path: "start.md", depth: 0, ambiguous: false, metadata: { type: null, status: null, tags: [] } },
    ]);

    const result = formatNeighborhood(
      { depthGroups, totalNodes: 1 },
      { startPath: "start.md", depth: 1, direction: "both" }
    );

    assert.ok(result.includes("Center"));
  });
});
