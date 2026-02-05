#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";

// Get vault path from environment
const VAULT_PATH = process.env.VAULT_PATH || process.env.HOME + "/Documents/PKM";

// Helper: resolve path relative to vault
function resolvePath(relativePath) {
  const resolved = path.resolve(VAULT_PATH, relativePath);
  // Security: ensure path is within vault
  if (!resolved.startsWith(VAULT_PATH)) {
    throw new Error("Path escapes vault directory");
  }
  return resolved;
}

// Helper: get all markdown files recursively
async function getAllMarkdownFiles(dir, baseDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      files.push(...await getAllMarkdownFiles(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path.relative(baseDir, fullPath));
    }
  }
  return files;
}

// Helper: extract YAML frontmatter from markdown content
function extractFrontmatter(content) {
  if (!content.startsWith("---")) return null;
  const endIndex = content.indexOf("---", 3);
  if (endIndex === -1) return null;

  const yamlContent = content.slice(3, endIndex).trim();
  try {
    return yaml.load(yamlContent);
  } catch (e) {
    return null; // Invalid YAML
  }
}

// Helper: check if metadata matches query filters
function matchesFilters(metadata, filters) {
  if (!metadata) return false;

  // Type filter (exact match)
  if (filters.type && metadata.type !== filters.type) {
    return false;
  }

  // Status filter (exact match)
  if (filters.status && metadata.status !== filters.status) {
    return false;
  }

  // Tags filter (ALL must be present)
  if (filters.tags && filters.tags.length > 0) {
    const noteTags = (metadata.tags || []).filter(Boolean).map(t => String(t).toLowerCase());
    const allPresent = filters.tags.every(tag =>
      noteTags.includes(tag.toLowerCase())
    );
    if (!allPresent) return false;
  }

  // Tags_any filter (ANY must be present)
  if (filters.tags_any && filters.tags_any.length > 0) {
    const noteTags = (metadata.tags || []).filter(Boolean).map(t => String(t).toLowerCase());
    const anyPresent = filters.tags_any.some(tag =>
      noteTags.includes(tag.toLowerCase())
    );
    if (!anyPresent) return false;
  }

  // Date filters (string comparison works for YYYY-MM-DD)
  const createdStr = metadata.created instanceof Date
    ? metadata.created.toISOString().split("T")[0]
    : String(metadata.created || "");

  if (filters.created_after && createdStr < filters.created_after) {
    return false;
  }
  if (filters.created_before && createdStr > filters.created_before) {
    return false;
  }

  return true;
}

// Helper: format metadata for display
function formatMetadata(metadata) {
  const parts = [];
  if (metadata.type) parts.push(`type: ${metadata.type}`);
  if (metadata.status) parts.push(`status: ${metadata.status}`);
  if (metadata.created) {
    const dateStr = metadata.created instanceof Date
      ? metadata.created.toISOString().split("T")[0]
      : metadata.created;
    parts.push(`created: ${dateStr}`);
  }
  const tagLine = metadata.tags?.length > 0
    ? `tags: ${metadata.tags.join(", ")}`
    : "";
  return { summary: parts.join(" | "), tagLine };
}

// Create the server
const server = new Server(
  { name: "pkm-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "vault_read",
      description: "Read the contents of a markdown file from the vault",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to vault root (e.g., '01-Projects/MyApp/_index.md')" }
        },
        required: ["path"]
      }
    },
    {
      name: "vault_write",
      description: "Create or overwrite a markdown file in the vault",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to vault root" },
          content: { type: "string", description: "Markdown content to write" },
          createDirs: { type: "boolean", description: "Create parent directories if they don't exist", default: true }
        },
        required: ["path", "content"]
      }
    },
    {
      name: "vault_append",
      description: "Append content to an existing file, optionally under a specific heading",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to vault root" },
          content: { type: "string", description: "Content to append" },
          heading: { type: "string", description: "Optional: append under this heading (e.g., '## Recent Activity')" }
        },
        required: ["path", "content"]
      }
    },
    {
      name: "vault_search",
      description: "Search for text across all markdown files in the vault",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (case-insensitive)" },
          folder: { type: "string", description: "Optional: limit search to this folder" },
          limit: { type: "number", description: "Max results to return", default: 10 }
        },
        required: ["query"]
      }
    },
    {
      name: "vault_list",
      description: "List files and folders in the vault",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to vault root (default: root)", default: "" },
          recursive: { type: "boolean", description: "List recursively", default: false },
          pattern: { type: "string", description: "Glob pattern to filter (e.g., '*.md')" }
        }
      }
    },
    {
      name: "vault_recent",
      description: "Get recently modified files",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of files to return", default: 10 },
          folder: { type: "string", description: "Optional: limit to this folder" }
        }
      }
    },
    {
      name: "vault_links",
      description: "Get incoming and outgoing links for a note",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the note" },
          direction: { type: "string", enum: ["incoming", "outgoing", "both"], default: "both" }
        },
        required: ["path"]
      }
    },
    {
      name: "vault_query",
      description: "Query notes by YAML frontmatter metadata (type, status, tags, dates)",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", description: "Filter by note type (exact match)" },
          status: { type: "string", description: "Filter by status (exact match)" },
          tags: { type: "array", items: { type: "string" }, description: "ALL tags must be present (case-insensitive)" },
          tags_any: { type: "array", items: { type: "string" }, description: "ANY tag must be present (case-insensitive)" },
          created_after: { type: "string", description: "Notes created on or after this date (YYYY-MM-DD)" },
          created_before: { type: "string", description: "Notes created on or before this date (YYYY-MM-DD)" },
          folder: { type: "string", description: "Limit search to this folder" },
          limit: { type: "number", description: "Max results to return", default: 50 }
        }
      }
    }
  ]
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "vault_read": {
        const filePath = resolvePath(args.path);
        const content = await fs.readFile(filePath, "utf-8");
        return { content: [{ type: "text", text: content }] };
      }

      case "vault_write": {
        const filePath = resolvePath(args.path);
        if (args.createDirs !== false) {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
        }
        await fs.writeFile(filePath, args.content, "utf-8");
        return { content: [{ type: "text", text: `Written to ${args.path}` }] };
      }

      case "vault_append": {
        const filePath = resolvePath(args.path);
        let existing = "";
        try {
          existing = await fs.readFile(filePath, "utf-8");
        } catch (e) {
          // File doesn't exist, will create
        }

        let newContent;
        if (args.heading && existing.includes(args.heading)) {
          // Insert after the heading
          const headingIndex = existing.indexOf(args.heading);
          const afterHeading = existing.indexOf("\n", headingIndex) + 1;
          newContent = existing.slice(0, afterHeading) + args.content + "\n" + existing.slice(afterHeading);
        } else {
          // Append to end
          newContent = existing + "\n" + args.content;
        }

        await fs.writeFile(filePath, newContent, "utf-8");
        return { content: [{ type: "text", text: `Appended to ${args.path}` }] };
      }

      case "vault_search": {
        const searchDir = args.folder ? resolvePath(args.folder) : VAULT_PATH;
        const files = await getAllMarkdownFiles(searchDir);
        const results = [];
        const query = args.query.toLowerCase();
        const limit = args.limit || 10;

        for (const file of files) {
          if (results.length >= limit) break;
          const filePath = path.join(searchDir, file);
          const content = await fs.readFile(filePath, "utf-8");
          if (content.toLowerCase().includes(query)) {
            // Find matching lines
            const lines = content.split("\n");
            const matchingLines = lines
              .map((line, i) => ({ line, num: i + 1 }))
              .filter(({ line }) => line.toLowerCase().includes(query))
              .slice(0, 3);
            
            results.push({
              path: file,
              matches: matchingLines.map(m => `L${m.num}: ${m.line.trim().slice(0, 100)}`)
            });
          }
        }

        return { 
          content: [{ 
            type: "text", 
            text: results.length > 0 
              ? results.map(r => `**${r.path}**\n${r.matches.join("\n")}`).join("\n\n")
              : "No matches found"
          }] 
        };
      }

      case "vault_list": {
        const listPath = resolvePath(args.path || "");
        const entries = await fs.readdir(listPath, { withFileTypes: true });
        
        let items = [];
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          
          const itemPath = path.join(args.path || "", entry.name);
          if (entry.isDirectory()) {
            items.push(`📁 ${itemPath}/`);
            if (args.recursive) {
              const subItems = await getAllMarkdownFiles(path.join(listPath, entry.name));
              items.push(...subItems.map(f => `   📄 ${path.join(itemPath, f)}`));
            }
          } else if (!args.pattern || entry.name.match(new RegExp(args.pattern.replace("*", ".*")))) {
            items.push(`📄 ${itemPath}`);
          }
        }

        return { content: [{ type: "text", text: items.join("\n") || "Empty directory" }] };
      }

      case "vault_recent": {
        const searchDir = args.folder ? resolvePath(args.folder) : VAULT_PATH;
        const files = await getAllMarkdownFiles(searchDir);
        const limit = args.limit || 10;
        
        const withStats = await Promise.all(
          files.map(async (file) => {
            const stat = await fs.stat(path.join(searchDir, file));
            return { path: file, mtime: stat.mtime };
          })
        );
        
        const sorted = withStats
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, limit);

        return { 
          content: [{ 
            type: "text", 
            text: sorted.map(f => `${f.path} (${f.mtime.toISOString().split("T")[0]})`).join("\n")
          }] 
        };
      }

      case "vault_links": {
        const filePath = resolvePath(args.path);
        const content = await fs.readFile(filePath, "utf-8");
        const fileName = path.basename(args.path, ".md");
        
        const result = { outgoing: [], incoming: [] };
        
        // Find outgoing links [[...]]
        if (args.direction !== "incoming") {
          const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
          let match;
          while ((match = linkRegex.exec(content)) !== null) {
            result.outgoing.push(match[1]);
          }
        }
        
        // Find incoming links (search all files for links to this file)
        if (args.direction !== "outgoing") {
          const allFiles = await getAllMarkdownFiles(VAULT_PATH);
          for (const file of allFiles) {
            if (file === args.path) continue;
            const fileContent = await fs.readFile(path.join(VAULT_PATH, file), "utf-8");
            if (fileContent.includes(`[[${fileName}]]`) || fileContent.includes(`[[${fileName}|`)) {
              result.incoming.push(file);
            }
          }
        }

        let output = "";
        if (result.outgoing.length > 0) {
          output += `**Outgoing links:**\n${result.outgoing.map(l => `- [[${l}]]`).join("\n")}\n\n`;
        }
        if (result.incoming.length > 0) {
          output += `**Incoming links:**\n${result.incoming.map(l => `- ${l}`).join("\n")}`;
        }
        
        return { content: [{ type: "text", text: output || "No links found" }] };
      }

      case "vault_query": {
        const searchDir = args.folder ? resolvePath(args.folder) : VAULT_PATH;
        const files = await getAllMarkdownFiles(searchDir);
        const limit = args.limit || 50;
        const results = [];

        const filters = {
          type: args.type,
          status: args.status,
          tags: args.tags,
          tags_any: args.tags_any,
          created_after: args.created_after,
          created_before: args.created_before
        };

        for (const file of files) {
          if (results.length >= limit) break;

          const filePath = path.join(searchDir, file);
          const content = await fs.readFile(filePath, "utf-8");
          const metadata = extractFrontmatter(content);

          if (matchesFilters(metadata, filters)) {
            const { summary, tagLine } = formatMetadata(metadata);
            const relativePath = args.folder
              ? path.join(args.folder, file)
              : file;
            results.push({ path: relativePath, summary, tagLine });
          }
        }

        if (results.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No notes found matching the query."
            }]
          };
        }

        const output = `Found ${results.length} note${results.length === 1 ? "" : "s"} matching query:\n\n` +
          results.map(r => {
            let entry = `**${r.path}**\n${r.summary}`;
            if (r.tagLine) entry += `\n${r.tagLine}`;
            return entry;
          }).join("\n\n");

        return { content: [{ type: "text", text: output }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return { 
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true 
    };
  }
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("PKM MCP Server running...");
