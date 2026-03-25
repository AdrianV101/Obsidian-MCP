import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { loadProjectContext } from "../hooks/load-context.js";

describe("loadProjectContext", () => {
  let tmpDir;
  let vaultPath;
  const projectPath = "01-Projects/MyApp";

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pkm-ctx-"));
    vaultPath = path.join(tmpDir, "vault");
    const projectDir = path.join(vaultPath, projectPath);
    await fs.mkdir(path.join(projectDir, "development"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "tasks"), { recursive: true });

    await fs.writeFile(
      path.join(projectDir, "_index.md"),
      "---\ntype: project\nstatus: active\ncreated: 2026-01-01\ntags: [project]\n---\n\n# MyApp\n\nA test project."
    );

    await fs.writeFile(
      path.join(projectDir, "development", "devlog.md"),
      "---\ntype: devlog\ncreated: 2026-01-01\ntags: [devlog]\n---\n\n# Development Log\n\n## Sessions\n\n### 2026-01-01 09:00\nOld entry.\n\n### 2026-02-01 10:00\nMiddle entry.\n\n### 2026-03-01 14:00\nRecent entry.\n\n### 2026-03-15 11:00\nLatest entry.\n"
    );

    await fs.writeFile(
      path.join(projectDir, "tasks", "add-auth.md"),
      "---\ntype: task\nstatus: active\npriority: high\ncreated: 2026-03-10\ntags: [task]\n---\n\n# Add Authentication\n\nImplement OAuth2 flow.\nSecond line of description."
    );

    await fs.writeFile(
      path.join(projectDir, "tasks", "setup-ci.md"),
      "---\ntype: task\nstatus: done\npriority: normal\ncreated: 2026-02-01\ntags: [task]\n---\n\n# Setup CI\n\nDone."
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads full project context", async () => {
    const ctx = await loadProjectContext(vaultPath, projectPath);
    assert.ok(ctx.includes("## PKM Project Context: MyApp"));
    assert.ok(ctx.includes("A test project."));
    assert.ok(ctx.includes("Latest entry."));
    assert.ok(ctx.includes("Add Authentication"));
    assert.ok(ctx.includes("high"));
    assert.ok(!ctx.includes("Setup CI"));
  });

  it("returns last 3 devlog sections", async () => {
    const ctx = await loadProjectContext(vaultPath, projectPath);
    assert.ok(!ctx.includes("Old entry."));
    assert.ok(ctx.includes("Middle entry."));
    assert.ok(ctx.includes("Recent entry."));
    assert.ok(ctx.includes("Latest entry."));
  });

  it("handles missing _index.md gracefully", async () => {
    await fs.rm(path.join(vaultPath, projectPath, "_index.md"));
    const ctx = await loadProjectContext(vaultPath, projectPath);
    assert.ok(ctx.includes("## PKM Project Context: MyApp"));
    assert.ok(ctx.includes("Latest entry."));
  });

  it("handles missing devlog gracefully", async () => {
    await fs.rm(path.join(vaultPath, projectPath, "development", "devlog.md"));
    const ctx = await loadProjectContext(vaultPath, projectPath);
    assert.ok(ctx.includes("A test project."));
  });

  it("shows 'No active tasks' when none exist", async () => {
    await fs.rm(path.join(vaultPath, projectPath, "tasks"), { recursive: true });
    const ctx = await loadProjectContext(vaultPath, projectPath);
    assert.ok(ctx.includes("No active tasks"));
  });

  it("returns last 3 devlog sections for old h2-date format", async () => {
    const projectDir = path.join(vaultPath, projectPath);
    await fs.writeFile(
      path.join(projectDir, "development", "devlog.md"),
      "---\ntype: devlog\ncreated: 2026-01-01\ntags: [devlog]\n---\n\n# Devlog\n\n## 2026-01-01\nOld entry.\n\n## 2026-02-01\nMiddle entry.\n\n## 2026-03-01\nRecent entry.\n\n## 2026-03-15\nLatest entry.\n"
    );
    const ctx = await loadProjectContext(vaultPath, projectPath);
    assert.ok(!ctx.includes("Old entry."));
    assert.ok(ctx.includes("Middle entry."));
    assert.ok(ctx.includes("Recent entry."));
    assert.ok(ctx.includes("Latest entry."));
  });

  it("handles devlog with ## Sessions but no entries", async () => {
    const projectDir = path.join(vaultPath, projectPath);
    await fs.writeFile(
      path.join(projectDir, "development", "devlog.md"),
      "---\ntype: devlog\ncreated: 2026-01-01\ntags: [devlog]\n---\n\n# Development Log\n\n## Sessions\n"
    );
    const ctx = await loadProjectContext(vaultPath, projectPath);
    assert.ok(ctx.includes("Sessions"));
  });

  it("extracts only h3 entries from hybrid devlog with ## Sessions", async () => {
    const projectDir = path.join(vaultPath, projectPath);
    await fs.writeFile(
      path.join(projectDir, "development", "devlog.md"),
      "---\ntype: devlog\ncreated: 2026-01-01\ntags: [devlog]\n---\n\n# Development Log\n\n## 2026-01-01\nLegacy entry.\n\n## Sessions\n\n### 2026-03-01 14:00\nNew entry one.\n\n### 2026-03-15 11:00\nNew entry two.\n"
    );
    const ctx = await loadProjectContext(vaultPath, projectPath);
    assert.ok(!ctx.includes("Legacy entry."));
    assert.ok(ctx.includes("New entry one."));
    assert.ok(ctx.includes("New entry two."));
  });

  it("handles task file without frontmatter gracefully", async () => {
    const projectDir = path.join(vaultPath, projectPath);
    await fs.writeFile(
      path.join(projectDir, "tasks", "no-frontmatter.md"),
      "# Some Task\n\nNo frontmatter here."
    );
    const ctx = await loadProjectContext(vaultPath, projectPath);
    // Should not crash, and should still include the auth task
    assert.ok(ctx.includes("Add Authentication"));
    // The no-frontmatter task should be skipped (extractFrontmatter returns null, so fm.status check fails)
    assert.ok(!ctx.includes("Some Task"));
  });
});
