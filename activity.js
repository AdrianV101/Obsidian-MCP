import Database from "better-sqlite3";
import fs from "fs/promises";
import path from "path";

/**
 * Persistent activity log backed by SQLite.
 * Records every MCP tool call with timestamps and session IDs,
 * enabling cross-session memory for Claude conversations.
 */
export class ActivityLog {
  /**
   * @param {Object} opts
   * @param {string} opts.vaultPath - absolute path to vault root
   * @param {string} opts.sessionId - UUID for the current session
   */
  constructor({ vaultPath, sessionId }) {
    this.vaultPath = vaultPath;
    this.sessionId = sessionId;
    this.dbPath = path.join(vaultPath, ".obsidian", "activity-log.db");
    this.db = null;
  }

  /** Create the SQLite database and activity table if they don't exist. */
  async initialize() {
    const dbDir = path.dirname(this.dbPath);
    await fs.mkdir(dbDir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("journal_size_limit = 32000000");

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

  /**
   * Record a tool invocation.
   * @param {string} toolName - MCP tool name
   * @param {Object} [args] - tool arguments
   */
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

  /**
   * Query activity entries with optional filters.
   * @param {Object} [opts]
   * @param {number} [opts.limit=50]
   * @param {string} [opts.tool] - filter by tool name
   * @param {string} [opts.session] - filter by session ID
   * @param {string} [opts.since] - ISO timestamp lower bound
   * @param {string} [opts.before] - ISO timestamp upper bound
   * @param {string} [opts.path] - substring match on args JSON
   * @returns {Object[]} matching activity rows
   */
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

  /**
   * Delete activity entries, optionally filtered.
   * @param {Object} [opts]
   * @param {string} [opts.session] - delete only this session
   * @param {string} [opts.tool] - delete only this tool
   * @param {string} [opts.before] - delete entries before this timestamp
   * @returns {number} number of deleted rows
   */
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

  /** Close the database connection. */
  shutdown() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
