import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { findFilesLinkingTo } from "../graph.js";
import { buildBasenameMap } from "../helpers.js";
import { getAllMarkdownFiles } from "../utils.js";

let tmpDir;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "graph-linking-test-"));

  const dir = path.join(tmpDir, "notes");
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(path.join(dir, "target.md"), "---\ntype: test\ncreated: 2026-01-01\ntags: [test]\n---\n# Target\n");
  await fs.writeFile(path.join(dir, "linker1.md"), "---\ntype: test\ncreated: 2026-01-01\ntags: [test]\n---\n# Linker1\nSee [[target]] for details.\n");
  await fs.writeFile(path.join(dir, "linker2.md"), "---\ntype: test\ncreated: 2026-01-01\ntags: [test]\n---\n# Linker2\nSee [[target|Display Text]] and [[other]].\n");
  await fs.writeFile(path.join(dir, "unrelated.md"), "---\ntype: test\ncreated: 2026-01-01\ntags: [test]\n---\n# Unrelated\nNo links here.\n");
  await fs.writeFile(path.join(dir, "other.md"), "---\ntype: test\ncreated: 2026-01-01\ntags: [test]\n---\n# Other\nLinks to [[linker1]].\n");
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

describe("findFilesLinkingTo", () => {
  it("finds files with [[basename]] links to target", async () => {
    const allFiles = await getAllMarkdownFiles(tmpDir);
    const { basenameMap, allFilesSet } = buildBasenameMap(allFiles);
    const result = await findFilesLinkingTo("notes/target.md", tmpDir, allFiles, basenameMap, allFilesSet);
    const paths = result.map(r => r.file).sort();
    assert.deepEqual(paths, ["notes/linker1.md", "notes/linker2.md"]);
  });

  it("returns file content along with path", async () => {
    const allFiles = await getAllMarkdownFiles(tmpDir);
    const { basenameMap, allFilesSet } = buildBasenameMap(allFiles);
    const result = await findFilesLinkingTo("notes/target.md", tmpDir, allFiles, basenameMap, allFilesSet);
    const linker1 = result.find(r => r.file === "notes/linker1.md");
    assert.ok(linker1);
    assert.ok(linker1.content.includes("[[target]]"));
  });

  it("returns empty array when no files link to target", async () => {
    const allFiles = await getAllMarkdownFiles(tmpDir);
    const { basenameMap, allFilesSet } = buildBasenameMap(allFiles);
    const result = await findFilesLinkingTo("notes/unrelated.md", tmpDir, allFiles, basenameMap, allFilesSet);
    assert.deepEqual(result, []);
  });

  it("does not include the target file itself", async () => {
    const allFiles = await getAllMarkdownFiles(tmpDir);
    const { basenameMap, allFilesSet } = buildBasenameMap(allFiles);
    const result = await findFilesLinkingTo("notes/target.md", tmpDir, allFiles, basenameMap, allFilesSet);
    const paths = result.map(r => r.file);
    assert.ok(!paths.includes("notes/target.md"));
  });

  it("gracefully skips deleted files (ENOENT) without crashing", async () => {
    const allFiles = await getAllMarkdownFiles(tmpDir);
    const { basenameMap, allFilesSet } = buildBasenameMap(allFiles);

    // Include a file path that doesn't exist on disk
    const filesWithGhost = [...allFiles, "notes/ghost-file.md"];

    // Should not throw — ghost file is silently skipped
    const result = await findFilesLinkingTo("notes/target.md", tmpDir, filesWithGhost, basenameMap, allFilesSet);
    const paths = result.map(r => r.file).sort();
    assert.deepEqual(paths, ["notes/linker1.md", "notes/linker2.md"]);
  });
});
