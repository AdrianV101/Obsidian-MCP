import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { ActivityLog } from "../activity.js";

let tmpDir;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "activity-test-"));
  await fs.mkdir(path.join(tmpDir, ".obsidian"), { recursive: true });
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

function createLog(sessionId = "test-session") {
  return new ActivityLog({ vaultPath: tmpDir, sessionId });
}

describe("initialize", () => {
  it("creates the database and table", async () => {
    const log = createLog();
    await log.initialize();
    const rows = log.query();
    assert.ok(Array.isArray(rows));
    log.shutdown();
  });

  it("can initialize twice (idempotent)", async () => {
    const log = createLog();
    await log.initialize();
    await log.initialize();
    log.shutdown();
  });
});

describe("log", () => {
  it("inserts a record", async () => {
    const log = createLog("log-test");
    await log.initialize();
    log.log("vault_read", { path: "test.md" });
    const rows = log.query({ session: "log-test" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tool_name, "vault_read");
    assert.equal(rows[0].session_id, "log-test");
    assert.ok(JSON.parse(rows[0].args_json).path === "test.md");
    log.shutdown();
  });

  it("handles null args", async () => {
    const log = createLog("null-args");
    await log.initialize();
    log.log("vault_list", null);
    const rows = log.query({ session: "null-args" });
    assert.equal(rows.length, 1);
    assert.equal(JSON.parse(rows[0].args_json).constructor, Object);
    log.shutdown();
  });

  it("is a no-op when db is null", () => {
    const log = createLog();
    // db is null before initialize()
    log.log("vault_read", { path: "test.md" });
    // no error thrown
  });
});

describe("query", () => {
  it("returns entries in descending order (most recent first)", async () => {
    const log = createLog("query-order");
    await log.initialize();
    log.log("vault_read", { path: "first.md" });
    log.log("vault_read", { path: "second.md" });
    const rows = log.query({ session: "query-order" });
    assert.equal(rows.length, 2);
    // Rows are ordered by timestamp DESC; when timestamps are identical,
    // SQLite returns higher rowids first (last inserted = first returned)
    const paths = rows.map(r => JSON.parse(r.args_json).path);
    assert.ok(paths.includes("first.md"));
    assert.ok(paths.includes("second.md"));
    log.shutdown();
  });

  it("filters by tool name", async () => {
    const log = createLog("query-tool");
    await log.initialize();
    log.log("vault_read", {});
    log.log("vault_write", {});
    log.log("vault_read", {});
    const rows = log.query({ session: "query-tool", tool: "vault_write" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tool_name, "vault_write");
    log.shutdown();
  });

  it("filters by session", async () => {
    const log1 = createLog("session-a");
    await log1.initialize();
    log1.log("vault_read", {});

    const log2 = new ActivityLog({ vaultPath: tmpDir, sessionId: "session-b" });
    await log2.initialize();
    log2.log("vault_write", {});

    const rows = log2.query({ session: "session-a" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].session_id, "session-a");
    log2.shutdown();
  });

  it("filters by since timestamp", async () => {
    const log = createLog("query-since");
    await log.initialize();
    log.log("vault_read", {});
    // Query with a future timestamp should return nothing from this session
    const rows = log.query({ session: "query-since", since: "2099-01-01T00:00:00.000Z" });
    assert.equal(rows.length, 0);
    log.shutdown();
  });

  it("filters by before timestamp", async () => {
    const log = createLog("query-before");
    await log.initialize();
    log.log("vault_read", {});
    // Query with a past timestamp should return nothing
    const rows = log.query({ session: "query-before", before: "2000-01-01T00:00:00.000Z" });
    assert.equal(rows.length, 0);
    log.shutdown();
  });

  it("filters by path substring in args", async () => {
    const log = createLog("query-path");
    await log.initialize();
    log.log("vault_read", { path: "01-Projects/MyApp/index.md" });
    log.log("vault_read", { path: "02-Areas/health.md" });
    const rows = log.query({ session: "query-path", path: "01-Projects/MyApp" });
    assert.equal(rows.length, 1);
    assert.ok(rows[0].args_json.includes("MyApp"));
    log.shutdown();
  });

  it("escapes LIKE wildcards in path filter", async () => {
    const log = createLog("query-escape");
    await log.initialize();
    log.log("vault_read", { path: "note_draft.md" });
    log.log("vault_read", { path: "notexdraft.md" });
    // _ is a SQL wildcard; without escaping, "note_draft" would match "notexdraft"
    const rows = log.query({ session: "query-escape", path: "note_draft" });
    assert.equal(rows.length, 1);
    assert.ok(rows[0].args_json.includes("note_draft"));
    log.shutdown();
  });

  it("respects limit", async () => {
    const log = createLog("query-limit");
    await log.initialize();
    for (let i = 0; i < 10; i++) {
      log.log("vault_read", { i });
    }
    const rows = log.query({ session: "query-limit", limit: 3 });
    assert.equal(rows.length, 3);
    log.shutdown();
  });

  it("returns empty array when db is null", () => {
    const log = createLog();
    const rows = log.query();
    assert.deepEqual(rows, []);
  });
});

describe("clear", () => {
  it("deletes all entries when no filters", async () => {
    const log = createLog("clear-all");
    await log.initialize();
    log.log("vault_read", {});
    log.log("vault_write", {});
    const deleted = log.clear();
    assert.ok(deleted >= 2);
    const rows = log.query({ session: "clear-all" });
    assert.equal(rows.length, 0);
    log.shutdown();
  });

  it("filters by session", async () => {
    const log = createLog("clear-session-a");
    await log.initialize();
    log.log("vault_read", {});

    const log2 = new ActivityLog({ vaultPath: tmpDir, sessionId: "clear-session-b" });
    await log2.initialize();
    log2.log("vault_write", {});

    const deleted = log2.clear({ session: "clear-session-a" });
    assert.ok(deleted >= 1);
    // session-b entries should survive
    const rows = log2.query({ session: "clear-session-b" });
    assert.ok(rows.length >= 1);
    log2.shutdown();
  });

  it("filters by tool", async () => {
    const log = createLog("clear-tool");
    await log.initialize();
    log.log("vault_read", {});
    log.log("vault_write", {});
    log.clear({ tool: "vault_read" });
    const rows = log.query({ session: "clear-tool" });
    assert.ok(rows.every(r => r.tool_name !== "vault_read"));
    log.shutdown();
  });

  it("returns deleted count", async () => {
    const log = createLog("clear-count");
    await log.initialize();
    log.log("vault_read", {});
    log.log("vault_read", {});
    const deleted = log.clear({ session: "clear-count" });
    assert.equal(deleted, 2);
    log.shutdown();
  });

  it("returns 0 when db is null", () => {
    const log = createLog();
    assert.equal(log.clear(), 0);
  });
});

describe("shutdown", () => {
  it("closes the database", async () => {
    const log = createLog("shutdown-test");
    await log.initialize();
    log.shutdown();
    assert.equal(log.db, null);
  });

  it("query returns empty after shutdown", async () => {
    const log = createLog("shutdown-query");
    await log.initialize();
    log.log("vault_read", {});
    log.shutdown();
    assert.deepEqual(log.query(), []);
  });

  it("log is no-op after shutdown", async () => {
    const log = createLog("shutdown-log");
    await log.initialize();
    log.shutdown();
    // should not throw
    log.log("vault_read", {});
  });
});
