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

// Template registry (populated at startup)
let templateRegistry = new Map();
let templateDescriptions = "";

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

// Helper: count non-overlapping occurrences of a substring
function countOccurrences(content, searchString) {
  if (searchString.length === 0) return 0;
  let count = 0;
  let position = 0;
  while ((position = content.indexOf(searchString, position)) !== -1) {
    count++;
    position += searchString.length;
  }
  return count;
}

// Helper: extract template variables from content
function extractTemplateVariables(content) {
  const variables = new Set();
  const regex = /<%\s*tp\.([a-zA-Z_.()"\-]+)\s*%>/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    variables.add(match[1]);
  }
  return Array.from(variables);
}

// Helper: extract description from template
function extractTemplateDescription(content, frontmatter) {
  if (frontmatter?.description) return frontmatter.description;

  const lines = content.split("\n");
  let inFrontmatter = false;
  for (const line of lines) {
    if (line.trim() === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;

    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      return trimmed.replace(/^#+\s*/, "").replace(/<%[^%]+%>/g, "{title}").slice(0, 80);
    }
    if (trimmed && !trimmed.startsWith("<!--")) {
      return trimmed.slice(0, 80);
    }
  }
  return `Template for ${frontmatter?.type || "notes"}`;
}

// Helper: load templates from 05-Templates/
async function loadTemplates() {
  const templatesDir = resolvePath("05-Templates");
  const templateMap = new Map();

  try {
    const files = await fs.readdir(templatesDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;

      const shortName = path.basename(file, ".md");
      const content = await fs.readFile(path.join(templatesDir, file), "utf-8");
      const frontmatter = extractFrontmatter(content);
      const variables = extractTemplateVariables(content);

      templateMap.set(shortName, {
        shortName,
        path: `05-Templates/${file}`,
        description: extractTemplateDescription(content, frontmatter),
        variables,
        frontmatter,
        content
      });
    }
  } catch (e) {
    console.error("Warning: 05-Templates/ not found in vault");
  }

  return templateMap;
}

// Helper: substitute template variables
function substituteTemplateVariables(content, vars) {
  const now = new Date();
  const dateFormats = {
    "YYYY-MM-DD": now.toISOString().split("T")[0],
    "YYYY-MM-DD HH:mm": now.toISOString().replace("T", " ").slice(0, 16),
    "YYYY": now.getFullYear().toString(),
    "MM": String(now.getMonth() + 1).padStart(2, "0"),
    "DD": String(now.getDate()).padStart(2, "0")
  };

  let result = content;

  // Replace tp.date.now("FORMAT") patterns
  result = result.replace(/<%\s*tp\.date\.now\("([^"]+)"\)\s*%>/g, (match, format) => {
    return dateFormats[format] || now.toISOString().split("T")[0];
  });

  // Replace tp.file.title
  result = result.replace(/<%\s*tp\.file\.title\s*%>/g, vars.title || "Untitled");

  // Replace custom variables
  if (vars.custom) {
    for (const [key, value] of Object.entries(vars.custom)) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`<%\\s*${escaped}\\s*%>`, "g");
      result = result.replace(regex, value);
    }
  }

  return result;
}

// Helper: validate frontmatter after substitution
function validateFrontmatterStrict(content) {
  const frontmatter = extractFrontmatter(content);
  const errors = [];

  if (!frontmatter) {
    return { valid: false, errors: ["No frontmatter found in template output"], frontmatter: null };
  }

  if (!frontmatter.type) {
    errors.push("Missing required field: type");
  }
  if (!frontmatter.created) {
    errors.push("Missing required field: created");
  }
  if (!frontmatter.tags || !Array.isArray(frontmatter.tags) || frontmatter.tags.filter(Boolean).length === 0) {
    errors.push("Missing required field: tags (must be non-empty array)");
  }

  // Check for unsubstituted template variables
  const unsubstituted = content.match(/<%[^%]+%>/g);
  if (unsubstituted) {
    errors.push(`Unsubstituted template variables: ${unsubstituted.join(", ")}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    frontmatter
  };
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
      description: `Create a new note from a template. Notes must be created from templates to ensure proper frontmatter.

Available templates:
${templateDescriptions || "(Loading...)"}

Built-in variables (auto-substituted):
- <% tp.date.now("YYYY-MM-DD") %> - Current date
- <% tp.file.title %> - Derived from output path filename

Pass custom variables via the 'variables' parameter.`,
      inputSchema: {
        type: "object",
        properties: {
          template: {
            type: "string",
            description: "Template name (filename without .md from 05-Templates/)",
            enum: Array.from(templateRegistry.keys())
          },
          path: { type: "string", description: "Output path relative to vault root" },
          variables: {
            type: "object",
            description: "Custom variables to substitute (key-value pairs)",
            additionalProperties: { type: "string" }
          },
          createDirs: { type: "boolean", description: "Create parent directories if they don't exist", default: true }
        },
        required: ["template", "path"]
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
      name: "vault_edit",
      description: "Edit a file by replacing an exact string match. The old_string must appear exactly once in the file for safety.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to vault root" },
          old_string: { type: "string", description: "Exact string to find (must match exactly once)" },
          new_string: { type: "string", description: "Replacement string" }
        },
        required: ["path", "old_string", "new_string"]
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

      case "vault_edit": {
        const filePath = resolvePath(args.path);

        // Read existing file (will throw if doesn't exist)
        const content = await fs.readFile(filePath, "utf-8");

        // Count occurrences
        const count = countOccurrences(content, args.old_string);

        if (count === 0) {
          return {
            content: [{ type: "text", text: `No match found for the specified old_string in ${args.path}` }],
            isError: true
          };
        }

        if (count > 1) {
          return {
            content: [{ type: "text", text: `Found ${count} matches for old_string in ${args.path}. Please provide a more specific string that matches exactly once.` }],
            isError: true
          };
        }

        // Exactly one match - safe to replace
        const newContent = content.replace(args.old_string, args.new_string);
        await fs.writeFile(filePath, newContent, "utf-8");

        return { content: [{ type: "text", text: `Successfully edited ${args.path}` }] };
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
