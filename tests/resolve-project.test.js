import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { resolveProject } from "../hooks/resolve-project.js";

describe("resolveProject", () => {
  let tmpDir;
  let vaultPath;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pkm-test-"));
    vaultPath = path.join(tmpDir, "vault");
    await fs.mkdir(path.join(vaultPath, "01-Projects", "MyApp"), { recursive: true });
    await fs.mkdir(path.join(vaultPath, "01-Projects", "Obsidian-MCP"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("resolves by basename match (case-insensitive)", async () => {
    const result = await resolveProject("/home/user/Projects/myapp", vaultPath);
    assert.equal(result.projectPath, "01-Projects/MyApp");
    assert.equal(result.error, undefined);
  });

  it("resolves by CLAUDE.md annotation when basename fails", async () => {
    const cwdPath = path.join(tmpDir, "different-name");
    await fs.mkdir(cwdPath, { recursive: true });
    await fs.writeFile(
      path.join(cwdPath, "CLAUDE.md"),
      "# Project\n\n# PKM: 01-Projects/MyApp\n\nSome instructions."
    );
    const result = await resolveProject(cwdPath, vaultPath);
    assert.equal(result.projectPath, "01-Projects/MyApp");
  });

  it("returns error when no match found", async () => {
    const result = await resolveProject("/home/user/Projects/unknown-repo", vaultPath);
    assert.equal(result.projectPath, undefined);
    assert.ok(result.error.includes("No vault project found"));
  });

  it("returns error when VAULT_PATH does not exist", async () => {
    const result = await resolveProject("/some/dir", "/nonexistent/vault");
    assert.equal(result.projectPath, undefined);
    assert.ok(result.error);
  });

  it("handles CLAUDE.md annotation with .claude/ subdirectory", async () => {
    const cwdPath = path.join(tmpDir, "other-repo");
    await fs.mkdir(path.join(cwdPath, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(cwdPath, "CLAUDE.md"),
      "# PKM: 01-Projects/Obsidian-MCP\n"
    );
    const result = await resolveProject(cwdPath, vaultPath);
    assert.equal(result.projectPath, "01-Projects/Obsidian-MCP");
  });

  it("rejects CLAUDE.md annotation that escapes vault", async () => {
    const cwdPath = path.join(tmpDir, "evil-repo");
    await fs.mkdir(cwdPath, { recursive: true });
    await fs.writeFile(path.join(cwdPath, "CLAUDE.md"), "# PKM: ../../etc/passwd\n");
    const result = await resolveProject(cwdPath, vaultPath);
    assert.equal(result.projectPath, undefined);
    assert.ok(result.error.includes("escapes vault"));
  });

  it("returns error when CLAUDE.md annotation points to non-existent path", async () => {
    const cwdPath = path.join(tmpDir, "missing-path-repo");
    await fs.mkdir(cwdPath, { recursive: true });
    await fs.writeFile(path.join(cwdPath, "CLAUDE.md"), "# PKM: 01-Projects/DoesNotExist\n");
    const result = await resolveProject(cwdPath, vaultPath);
    assert.equal(result.projectPath, undefined);
    assert.ok(result.error.includes("non-existent"));
  });
});
