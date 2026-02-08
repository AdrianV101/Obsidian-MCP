import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import crypto from "crypto";
import { getAllMarkdownFiles } from "./utils.js";

const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_DIMENSIONS = 3072;
const MAX_CHARS_PER_CHUNK = 8000; // ~2000 tokens
const BATCH_SIZE = 100; // max texts per OpenAI API call
const REINDEX_BATCH_SIZE = 10; // files per batch during startup sync
const DEBOUNCE_MS = 2000;

export class SemanticIndex {
  constructor({ vaultPath, openaiApiKey, dbPath }) {
    this.vaultPath = vaultPath;
    this.openaiApiKey = openaiApiKey;
    this.dbPath = dbPath || path.join(vaultPath, ".obsidian", "semantic-index.db");
    this.db = null;
    this.watcher = null;
    this._debounceTimers = new Map();
    this._syncState = { syncing: false, total: 0, done: 0 };
  }

  get isAvailable() {
    return this.db !== null && !!this.openaiApiKey;
  }

  async initialize() {
    // Ensure .obsidian dir exists
    const dbDir = path.dirname(this.dbPath);
    await fs.mkdir(dbDir, { recursive: true });

    // Open DB and load sqlite-vec
    this.db = new Database(this.dbPath);
    sqliteVec.load(this.db);
    this.db.pragma("journal_mode = WAL");

    // Create schema
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
        embedding float[${EMBEDDING_DIMENSIONS}]
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY,
        file_path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        heading TEXT,
        content_preview TEXT NOT NULL,
        UNIQUE(file_path, chunk_index)
      );

      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        mtime_ms INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        chunk_count INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
    `);

    // Start background sync (non-blocking)
    this._startupSync().catch(err => {
      console.error(`Semantic index startup sync error: ${err.message}`);
    });

    // Start file watcher
    this._startWatcher();
  }

  async shutdown() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this._debounceTimers.values()) {
      clearTimeout(timer);
    }
    this._debounceTimers.clear();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async search({ query, limit = 5, folder, threshold }) {
    if (!this.isAvailable) {
      throw new Error("Semantic index not available");
    }

    // Embed the query
    const [queryEmbedding] = await getEmbeddings([query], this.openaiApiKey);

    // KNN search via sqlite-vec
    const vecResults = this.db.prepare(`
      SELECT rowid, distance
      FROM vec_chunks
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `).all(
      new Float32Array(queryEmbedding),
      Math.min(limit * 3, 50) // overfetch for folder filtering
    );

    // Join with chunk metadata
    const results = [];
    const getChunk = this.db.prepare(`
      SELECT file_path, chunk_index, heading, content_preview
      FROM chunks WHERE id = ?
    `);

    const seenFiles = new Set();
    for (const { rowid, distance } of vecResults) {
      if (results.length >= limit) break;

      const chunk = getChunk.get(rowid);
      if (!chunk) continue;

      // Folder filter (ensure prefix matches at directory boundary)
      if (folder) {
        const prefix = folder.endsWith("/") ? folder : folder + "/";
        if (!chunk.file_path.startsWith(prefix)) continue;
      }

      // Threshold filter (convert L2 to similarity: 1 - distance/2)
      const score = Math.max(0, Math.min(1, 1 - distance / 2));
      if (threshold && score < threshold) continue;

      // Deduplicate by file (show best chunk per file)
      if (seenFiles.has(chunk.file_path)) continue;
      seenFiles.add(chunk.file_path);

      results.push({
        path: chunk.file_path,
        heading: chunk.heading,
        score: Math.round(score * 1000) / 1000,
        preview: chunk.content_preview
      });
    }

    // Format output
    let syncNote = "";
    if (this._syncState.syncing) {
      syncNote = `\n\n*Index syncing (${this._syncState.done}/${this._syncState.total} files)...*`;
    }

    if (results.length === 0) {
      return `No semantically related notes found.${syncNote}`;
    }

    const formatted = results.map(r => {
      const heading = r.heading ? ` > ${r.heading}` : "";
      return `**${r.path}**${heading} (score: ${r.score})\n${r.preview}`;
    }).join("\n\n");

    return `Found ${results.length} semantically related note${results.length === 1 ? "" : "s"}:\n\n${formatted}${syncNote}`;
  }

  async searchRaw({ query, limit = 5, folder, threshold, excludeFiles }) {
    if (!this.isAvailable) {
      throw new Error("Semantic index not available");
    }

    const [queryEmbedding] = await getEmbeddings([query], this.openaiApiKey);

    const vecResults = this.db.prepare(`
      SELECT rowid, distance
      FROM vec_chunks
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `).all(
      new Float32Array(queryEmbedding),
      Math.min(limit * 3, 50)
    );

    const results = [];
    const getChunk = this.db.prepare(`
      SELECT file_path, chunk_index, heading, content_preview
      FROM chunks WHERE id = ?
    `);

    const seenFiles = new Set();
    for (const { rowid, distance } of vecResults) {
      if (results.length >= limit) break;

      const chunk = getChunk.get(rowid);
      if (!chunk) continue;

      if (folder) {
        const prefix = folder.endsWith("/") ? folder : folder + "/";
        if (!chunk.file_path.startsWith(prefix)) continue;
      }

      const score = Math.max(0, Math.min(1, 1 - distance / 2));
      if (threshold && score < threshold) continue;

      if (excludeFiles?.has(chunk.file_path)) continue;

      if (seenFiles.has(chunk.file_path)) continue;
      seenFiles.add(chunk.file_path);

      results.push({
        path: chunk.file_path,
        score: Math.round(score * 1000) / 1000,
        preview: chunk.content_preview
      });
    }

    return results;
  }

  async reindexFile(relativePath) {
    if (!this.db) return;

    const absPath = path.resolve(this.vaultPath, relativePath);
    let content;
    try {
      content = await fs.readFile(absPath, "utf-8");
    } catch (e) {
      if (e.code === "ENOENT") {
        this.removeFile(relativePath);
        return;
      }
      throw e;
    }

    const hash = contentHash(content);
    const stat = await fs.stat(absPath);

    // Check if unchanged
    const existing = this.db.prepare("SELECT content_hash FROM files WHERE path = ?").get(relativePath);
    if (existing && existing.content_hash === hash) return;

    // Chunk the note
    const chunks = chunkNote(content, relativePath);
    if (chunks.length === 0) {
      // Note has no indexable content — clean up any old chunks
      this.removeFile(relativePath);
      return;
    }

    // Get embeddings
    const texts = chunks.map(c => c.text);
    let embeddings;
    try {
      embeddings = await getEmbeddings(texts, this.openaiApiKey);
    } catch (e) {
      console.error(`Embedding error for ${relativePath}: ${e.message}`);
      return;
    }

    // Store in transaction
    const txn = this.db.transaction(() => {
      // Remove old chunks
      const oldChunks = this.db.prepare(
        "SELECT id FROM chunks WHERE file_path = ?"
      ).all(relativePath);

      if (oldChunks.length > 0) {
        const deleteVec = this.db.prepare("DELETE FROM vec_chunks WHERE rowid = ?");
        const deleteChunk = this.db.prepare("DELETE FROM chunks WHERE id = ?");
        for (const { id } of oldChunks) {
          deleteVec.run(BigInt(id));
          deleteChunk.run(id);
        }
      }

      // Insert new chunks
      const insertChunk = this.db.prepare(`
        INSERT INTO chunks (file_path, chunk_index, heading, content_preview)
        VALUES (?, ?, ?, ?)
      `);
      const insertVec = this.db.prepare(`
        INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)
      `);

      for (let i = 0; i < chunks.length; i++) {
        const result = insertChunk.run(
          relativePath,
          i,
          chunks[i].heading || null,
          chunks[i].preview
        );
        insertVec.run(BigInt(result.lastInsertRowid), new Float32Array(embeddings[i]));
      }

      // Update file record
      this.db.prepare(`
        INSERT OR REPLACE INTO files (path, mtime_ms, content_hash, chunk_count, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        relativePath,
        Math.floor(stat.mtimeMs),
        hash,
        chunks.length,
        new Date().toISOString()
      );
    });

    txn();
  }

  removeFile(relativePath) {
    if (!this.db) return;

    const txn = this.db.transaction(() => {
      const oldChunks = this.db.prepare(
        "SELECT id FROM chunks WHERE file_path = ?"
      ).all(relativePath);

      if (oldChunks.length > 0) {
        const deleteVec = this.db.prepare("DELETE FROM vec_chunks WHERE rowid = ?");
        const deleteChunk = this.db.prepare("DELETE FROM chunks WHERE id = ?");
        for (const { id } of oldChunks) {
          deleteVec.run(BigInt(id));
          deleteChunk.run(id);
        }
      }

      this.db.prepare("DELETE FROM files WHERE path = ?").run(relativePath);
    });

    txn();
  }

  // --- Private methods ---

  async _startupSync() {
    this._syncState.syncing = true;

    try {
      // Get all vault .md files
      const vaultFiles = await getAllMarkdownFiles(this.vaultPath);

      // Get all indexed files
      const indexedFiles = new Map();
      for (const row of this.db.prepare("SELECT path, mtime_ms, content_hash FROM files").all()) {
        indexedFiles.set(row.path, row);
      }

      // Find files needing reindex
      const toReindex = [];
      const vaultFileSet = new Set(vaultFiles);

      for (const relPath of vaultFiles) {
        const absPath = path.resolve(this.vaultPath, relPath);
        try {
          const stat = await fs.stat(absPath);
          const indexed = indexedFiles.get(relPath);
          if (!indexed || Math.floor(stat.mtimeMs) !== indexed.mtime_ms) {
            toReindex.push(relPath);
          }
        } catch {
          // File disappeared between listing and stat
        }
      }

      // Find deleted files
      for (const indexedPath of indexedFiles.keys()) {
        if (!vaultFileSet.has(indexedPath)) {
          this.removeFile(indexedPath);
        }
      }

      if (toReindex.length === 0) {
        console.error("Semantic index: up to date");
        return;
      }

      this._syncState.total = toReindex.length;
      this._syncState.done = 0;
      console.error(`Semantic index: syncing ${toReindex.length} files...`);

      // Process in batches
      for (let i = 0; i < toReindex.length; i += REINDEX_BATCH_SIZE) {
        const batch = toReindex.slice(i, i + REINDEX_BATCH_SIZE);
        const results = await Promise.allSettled(batch.map(f => this.reindexFile(f)));
        const failures = results.filter(r => r.status === "rejected");
        if (failures.length > 0) {
          console.error(`Semantic index: ${failures.length} files failed in batch`);
        }
        this._syncState.done += batch.length;
        console.error(`Semantic index: syncing ${this._syncState.done}/${this._syncState.total} files...`);
      }

      console.error(`Semantic index: sync complete (${toReindex.length} files updated)`);
    } finally {
      this._syncState.syncing = false;
    }
  }

  _startWatcher() {
    try {
      this.watcher = fsSync.watch(this.vaultPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (!filename.endsWith(".md")) return;
        if (this._syncState.syncing) return;

        // Ignore dotfiles/dot directories
        const parts = filename.split(path.sep);
        if (parts.some(p => p.startsWith("."))) return;

        // Normalize to forward slashes (consistent with vault paths)
        const relativePath = filename.split(path.sep).join("/");

        // Debounce per file
        if (this._debounceTimers.has(relativePath)) {
          clearTimeout(this._debounceTimers.get(relativePath));
        }

        this._debounceTimers.set(relativePath, setTimeout(async () => {
          this._debounceTimers.delete(relativePath);
          try {
            // Check if file still exists
            await fs.access(path.resolve(this.vaultPath, relativePath));
            await this.reindexFile(relativePath);
          } catch (e) {
            if (e.code === "ENOENT") {
              this.removeFile(relativePath);
            } else {
              console.error(`Watcher reindex error for ${relativePath}: ${e.message}`);
            }
          }
        }, DEBOUNCE_MS));
      });

      this.watcher.on("error", (err) => {
        console.error(`File watcher error: ${err.message}`);
      });
    } catch (err) {
      console.error(`Could not start file watcher: ${err.message}`);
    }
  }
}

// --- Module-level helpers ---

function chunkNote(content, filePath) {
  // Strip frontmatter
  let body = content;
  if (content.startsWith("---")) {
    const endIndex = content.indexOf("---", 3);
    if (endIndex !== -1) {
      body = content.slice(endIndex + 3).trim();
    }
  }

  if (!body) return [];

  // Derive title from file path
  const title = path.basename(filePath, ".md");

  // Short note: single chunk
  if (body.length <= MAX_CHARS_PER_CHUNK) {
    return [{
      text: `# ${title}\n\n${body}`,
      heading: null,
      preview: getPreview(body)
    }];
  }

  // Long note: split at ## headings
  const sections = splitByHeadings(body);
  const chunks = [];

  for (const section of sections) {
    const sectionText = section.text.trim();
    if (!sectionText) continue;

    if (sectionText.length <= MAX_CHARS_PER_CHUNK) {
      chunks.push({
        text: `# ${title}\n\n${sectionText}`,
        heading: section.heading,
        preview: getPreview(sectionText)
      });
    } else {
      // Further split at paragraph breaks
      const paragraphChunks = splitByParagraphs(sectionText, MAX_CHARS_PER_CHUNK);
      for (let i = 0; i < paragraphChunks.length; i++) {
        chunks.push({
          text: `# ${title}\n\n${paragraphChunks[i]}`,
          heading: section.heading ? `${section.heading} (${i + 1})` : null,
          preview: getPreview(paragraphChunks[i])
        });
      }
    }
  }

  return chunks;
}

function splitByHeadings(body) {
  const lines = body.split("\n");
  const sections = [];
  let currentHeading = null;
  let currentLines = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentLines.length > 0) {
        sections.push({ heading: currentHeading, text: currentLines.join("\n") });
      }
      currentHeading = line.replace(/^##\s+/, "");
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({ heading: currentHeading, text: currentLines.join("\n") });
  }

  return sections;
}

function splitByParagraphs(text, maxChars) {
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let current = "";

  for (const para of paragraphs) {
    if (current && (current.length + para.length + 2) > maxChars) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function getPreview(text) {
  // Strip markdown heading markers for preview
  const cleaned = text.replace(/^#+\s+/gm, "").trim();
  const words = cleaned.split(/\s+/);
  const preview = words.slice(0, 100).join(" ");
  return preview.length < cleaned.length ? preview + "..." : preview;
}

async function getEmbeddings(texts, apiKey) {
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const embeddings = await callEmbeddingAPI(batch, apiKey);
    allEmbeddings.push(...embeddings);
  }

  return allEmbeddings;
}

async function callEmbeddingAPI(texts, apiKey, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts
      })
    });

    if (response.ok) {
      const data = await response.json();
      // Sort by index to maintain order
      return data.data
        .sort((a, b) => a.index - b.index)
        .map(d => d.embedding);
    }

    if (response.status === 429 && attempt < retries - 1) {
      // Rate limited — exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      console.error(`Rate limited, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }

    const errBody = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errBody}`);
  }
}

function contentHash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

