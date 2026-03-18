import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { resolveInputPath, copyTemplates, scaffoldFolders, backupVault, dirSize } from "../init.js";

describe("resolveInputPath", () => {
  it("expands ~ to home directory", () => {
    assert.equal(resolveInputPath("~/Documents/PKM"), path.join(os.homedir(), "Documents/PKM"));
  });

  it("expands lone ~", () => {
    assert.equal(resolveInputPath("~"), os.homedir());
  });

  it("expands $HOME", () => {
    assert.equal(resolveInputPath("$HOME/vault"), path.join(os.homedir(), "vault"));
  });

  it("expands ${HOME}", () => {
    assert.equal(resolveInputPath("${HOME}/vault"), path.join(os.homedir(), "vault"));
  });

  it("resolves relative paths to absolute", () => {
    const result = resolveInputPath("my/vault");
    assert.ok(path.isAbsolute(result));
    assert.ok(result.endsWith("my/vault"));
  });

  it("strips trailing slashes", () => {
    const result = resolveInputPath("/tmp/vault/");
    assert.equal(result, "/tmp/vault");
  });

  it("normalises double slashes", () => {
    const result = resolveInputPath("/tmp//vault///notes");
    assert.equal(result, "/tmp/vault/notes");
  });

  it("handles absolute paths unchanged (except normalisation)", () => {
    assert.equal(resolveInputPath("/tmp/vault"), "/tmp/vault");
  });
});

describe("copyTemplates", () => {
  let tmpDir, srcDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-test-"));
    srcDir = path.join(tmpDir, "src-templates");
    await fs.mkdir(srcDir);
    await fs.writeFile(path.join(srcDir, "adr.md"), "# ADR");
    await fs.writeFile(path.join(srcDir, "task.md"), "# Task");
    await fs.writeFile(path.join(srcDir, "note.md"), "# Note");
  });

  it("copies all templates in full mode", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    const result = await copyTemplates(srcDir, dest, "full");
    assert.equal(result.created, 3);
    assert.equal(result.skipped, 0);
    const files = await fs.readdir(dest);
    assert.equal(files.length, 3);
  });

  it("copies only note.md in minimal mode", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    const result = await copyTemplates(srcDir, dest, "minimal");
    assert.equal(result.created, 1);
    assert.equal(result.skipped, 0);
    const files = await fs.readdir(dest);
    assert.deepEqual(files, ["note.md"]);
  });

  it("returns zeros in skip mode", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    const result = await copyTemplates(srcDir, dest, "skip");
    assert.equal(result.created, 0);
    assert.equal(result.skipped, 0);
    await assert.rejects(fs.access(dest), { code: "ENOENT" });
  });

  it("skips files that already exist without overwriting", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, "adr.md"), "# Existing ADR");
    const result = await copyTemplates(srcDir, dest, "full");
    assert.equal(result.created, 2);
    assert.equal(result.skipped, 1);
    const content = await fs.readFile(path.join(dest, "adr.md"), "utf8");
    assert.equal(content, "# Existing ADR");
  });

  it("creates destination directory if it doesn't exist", async () => {
    const dest = path.join(tmpDir, "deep", "nested", "05-Templates");
    const result = await copyTemplates(srcDir, dest, "full");
    assert.equal(result.created, 3);
  });

  it("throws if source directory does not exist", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    await assert.rejects(
      copyTemplates("/nonexistent/templates", dest, "full"),
      (err) => err.code === "ENOENT"
    );
  });
});

describe("scaffoldFolders", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-scaffold-"));
  });

  it("creates all 7 PARA folders with _index.md stubs", async () => {
    const result = await scaffoldFolders(tmpDir);
    assert.equal(result.created, 7);
    assert.equal(result.skipped, 0);
    const dirs = await fs.readdir(tmpDir);
    assert.ok(dirs.includes("00-Inbox"));
    assert.ok(dirs.includes("06-System"));
    // Check _index.md has frontmatter
    const content = await fs.readFile(path.join(tmpDir, "00-Inbox", "_index.md"), "utf8");
    assert.ok(content.includes("type: moc"));
    assert.ok(content.includes("tags:"));
    assert.ok(content.includes("# Inbox"));
  });

  it("creates _index.md in existing folders that lack one", async () => {
    await fs.mkdir(path.join(tmpDir, "00-Inbox"), { recursive: true });
    const result = await scaffoldFolders(tmpDir);
    // created/skipped counts _index.md files only (folders are created idempotently via mkdir recursive)
    assert.equal(result.created, 7);
    assert.equal(result.skipped, 0);
    const indexContent = await fs.readFile(path.join(tmpDir, "00-Inbox", "_index.md"), "utf8");
    assert.ok(indexContent.includes("type: moc"));
  });

  it("skips existing _index.md files without overwriting", async () => {
    await fs.mkdir(path.join(tmpDir, "00-Inbox"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "00-Inbox", "_index.md"), "# My custom index");
    const result = await scaffoldFolders(tmpDir);
    assert.ok(result.skipped >= 1);
    const content = await fs.readFile(path.join(tmpDir, "00-Inbox", "_index.md"), "utf8");
    assert.equal(content, "# My custom index");
  });
});

describe("backupVault", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-backup-"));
    await fs.writeFile(path.join(tmpDir, "note.md"), "# Hello");
    await fs.mkdir(path.join(tmpDir, "subdir"));
    await fs.writeFile(path.join(tmpDir, "subdir", "deep.md"), "# Deep");
  });

  it("copies vault to timestamped backup directory", async () => {
    const backupPath = await backupVault(tmpDir);
    assert.ok(backupPath.includes("-backup-"));
    const content = await fs.readFile(path.join(backupPath, "note.md"), "utf8");
    assert.equal(content, "# Hello");
    const deepContent = await fs.readFile(path.join(backupPath, "subdir", "deep.md"), "utf8");
    assert.equal(deepContent, "# Deep");
  });

  it("does not modify the original vault", async () => {
    await backupVault(tmpDir);
    const content = await fs.readFile(path.join(tmpDir, "note.md"), "utf8");
    assert.equal(content, "# Hello");
  });

  it("throws if source does not exist", async () => {
    await assert.rejects(
      backupVault("/nonexistent/path/vault"),
      (err) => err.code === "ENOENT" || err.message.includes("ENOENT")
    );
  });
});

describe("dirSize", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-dirsize-"));
  });

  it("sums file sizes in a directory", async () => {
    await fs.writeFile(path.join(tmpDir, "a.txt"), "hello"); // 5 bytes
    await fs.writeFile(path.join(tmpDir, "b.txt"), "world!"); // 6 bytes
    const size = await dirSize(tmpDir);
    assert.equal(size, 11);
  });

  it("recurses into subdirectories", async () => {
    await fs.mkdir(path.join(tmpDir, "sub"));
    await fs.writeFile(path.join(tmpDir, "a.txt"), "hi"); // 2 bytes
    await fs.writeFile(path.join(tmpDir, "sub", "b.txt"), "hey"); // 3 bytes
    const size = await dirSize(tmpDir);
    assert.equal(size, 5);
  });

  it("returns 0 for empty directory", async () => {
    const size = await dirSize(tmpDir);
    assert.equal(size, 0);
  });
});
