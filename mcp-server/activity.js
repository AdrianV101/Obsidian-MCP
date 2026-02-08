import Database from "better-sqlite3";
import fs from "fs/promises";
import path from "path";

export class ActivityLog {
  constructor({ vaultPath, sessionId }) {
    this.vaultPath = vaultPath;
    this.sessionId = sessionId;
    this.dbPath = path.join(vaultPath, ".obsidian", "activity-log.db");
    this.db = null;
  }

  async initialize() {
    const dbDir = path.dirname(this.dbPath);
    await fs.mkdir(dbDir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        args_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activity_session ON activity(session_id);
      CREATE INDEX IF NOT EXISTS idx_activity_tool ON activity(tool_name);
      CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity(timestamp);
    `);
  }

  log(toolName, args) {
    if (!this.db) return;

    this.db.prepare(
      "INSERT INTO activity (timestamp, session_id, tool_name, args_json) VALUES (?, ?, ?, ?)"
    ).run(
      new Date().toISOString(),
      this.sessionId,
      toolName,
      JSON.stringify(args || {})
    );
  }

  query({ limit = 50, tool, session, since, before, path: pathFilter } = {}) {
    if (!this.db) return [];

    let sql = "SELECT * FROM activity WHERE 1=1";
    const params = [];

    if (tool) {
      sql += " AND tool_name = ?";
      params.push(tool);
    }
    if (session) {
      sql += " AND session_id = ?";
      params.push(session);
    }
    if (since) {
      sql += " AND timestamp >= ?";
      params.push(since);
    }
    if (before) {
      sql += " AND timestamp <= ?";
      params.push(before);
    }
    if (pathFilter) {
      sql += " AND args_json LIKE ? ESCAPE '\\'";
      const escaped = pathFilter.replace(/[%_\\]/g, "\\$&");
      params.push(`%${escaped}%`);
    }

    sql += " ORDER BY timestamp DESC LIMIT ?";
    params.push(limit);

    return this.db.prepare(sql).all(...params);
  }

  clear({ session, tool, before } = {}) {
    if (!this.db) return 0;

    let sql = "DELETE FROM activity WHERE 1=1";
    const params = [];

    if (session) {
      sql += " AND session_id = ?";
      params.push(session);
    }
    if (tool) {
      sql += " AND tool_name = ?";
      params.push(tool);
    }
    if (before) {
      sql += " AND timestamp < ?";
      params.push(before);
    }

    const result = this.db.prepare(sql).run(...params);
    return result.changes;
  }

  shutdown() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
