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
import crypto from "crypto";
import { SemanticIndex } from "./embeddings.js";
import { exploreNeighborhood, formatNeighborhood } from "./graph.js";
import { ActivityLog } from "./activity.js";
import { getAllMarkdownFiles } from "./utils.js";

// Get vault path from environment
const VAULT_PATH = process.env.VAULT_PATH || process.env.HOME + "/Documents/PKM";

// Template registry (populated at startup)
let templateRegistry = new Map();
let templateDescriptions = "";

// Semantic index (populated at startup if OPENAI_API_KEY is set)
let semanticIndex = null;

// Activity log (populated at startup)
let activityLog = null;
const SESSION_ID = crypto.randomUUID();

// Helper: resolve path relative to vault
function resolvePath(relativePath) {
  const resolved = path.resolve(VAULT_PATH, relativePath);
  // Security: ensure path is within vault
  if (!resolved.startsWith(VAULT_PATH)) {
    throw new Error("Path escapes vault directory");
  }
  return resolved;
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
    if (e.code === "ENOENT") {
      console.error("Warning: 05-Templates/ not found in vault");
    } else {
      console.error(`Error loading templates: ${e.message}`);
    }
  }

  return templateMap;
}

// Helper: substitute template variables and frontmatter fields
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

  // Replace custom variables in body (<%...%> patterns)
  if (vars.custom) {
    for (const [key, value] of Object.entries(vars.custom)) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`<%\\s*${escaped}\\s*%>`, "g");
      result = result.replace(regex, value);
    }
  }

  // Handle frontmatter field substitutions
  if (vars.frontmatter && content.startsWith("---")) {
    const endIndex = result.indexOf("---", 3);
    if (endIndex !== -1) {
      const frontmatterSection = result.slice(0, endIndex + 3);
      const body = result.slice(endIndex + 3);

      let updatedFrontmatter = frontmatterSection;

      // Handle tags array
      if (vars.frontmatter.tags && Array.isArray(vars.frontmatter.tags)) {
        const tagsYaml = vars.frontmatter.tags.map(t => `  - ${t}`).join("\n");
        let tagsReplaced = false;

        // Try inline format first: tags: [tag1, tag2]
        if (updatedFrontmatter.match(/^tags:\s*\[.*\]/m)) {
          updatedFrontmatter = updatedFrontmatter.replace(
            /^tags:\s*\[.*\]/m,
            `tags:\n${tagsYaml}`
          );
          tagsReplaced = true;
        }

        // Try multi-line format: tags:\n  - tag1\n  - tag2
        if (!tagsReplaced && updatedFrontmatter.match(/tags:\s*\n(?:\s+-[^\n]*\n?)*/)) {
          updatedFrontmatter = updatedFrontmatter.replace(
            /tags:\s*\n(?:\s+-[^\n]*\n?)*/,
            `tags:\n${tagsYaml}\n`
          );
          tagsReplaced = true;
        }

        // If no tags section existed, add before closing ---
        if (!tagsReplaced) {
          updatedFrontmatter = updatedFrontmatter.replace(
            /\n---$/,
            `\ntags:\n${tagsYaml}\n---`
          );
        }
      }

      // Handle other simple frontmatter fields (string values)
      for (const [key, value] of Object.entries(vars.frontmatter)) {
        if (key === "tags") continue; // Already handled
        if (typeof value === "string") {
          const fieldRegex = new RegExp(`^${key}:.*$`, "m");
          if (updatedFrontmatter.match(fieldRegex)) {
            updatedFrontmatter = updatedFrontmatter.replace(fieldRegex, `${key}: ${value}`);
          } else {
            updatedFrontmatter = updatedFrontmatter.replace(
              /\n---$/,
              `\n${key}: ${value}\n---`
            );
          }
        }
      }

      result = updatedFrontmatter + body;
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

// Helper: extract inline #tags from markdown body
function extractInlineTags(content) {
  let body = content;

  // Strip frontmatter (parsed separately)
  if (content.startsWith("---")) {
    const endIndex = content.indexOf("---", 3);
    if (endIndex !== -1) {
      body = content.slice(endIndex + 3);
    }
  }

  // Remove fenced code blocks
  body = body.replace(/```[\s\S]*?```/g, "");

  // Remove inline code
  body = body.replace(/`[^`]+`/g, "");

  // Remove heading markers to avoid # in ## being matched
  body = body.replace(/^#+\s/gm, "");

  const tags = new Set();
  const tagRegex = /(?:^|[^a-zA-Z0-9&])#([a-zA-Z_][a-zA-Z0-9_/-]*)/g;
  let match;
  while ((match = tagRegex.exec(body)) !== null) {
    tags.add(match[1].toLowerCase());
  }

  return Array.from(tags);
}

// Helper: match tag against glob-like pattern
function matchesTagPattern(tag, pattern) {
  if (!pattern) return true;

  const t = tag.toLowerCase();
  const p = pattern.toLowerCase();

  // Hierarchical prefix: "pkm/*" matches "pkm" and "pkm/system"
  if (p.endsWith("/*")) {
    const prefix = p.slice(0, -2);
    return t === prefix || t.startsWith(prefix + "/");
  }

  // Substring: "*mcp*"
  if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
    return t.includes(p.slice(1, -1));
  }

  // Prefix: "dev*"
  if (p.endsWith("*")) {
    return t.startsWith(p.slice(0, -1));
  }

  // Suffix: "*fix"
  if (p.startsWith("*")) {
    return t.endsWith(p.slice(1));
  }

  // Exact match
  return t === p;
}

// Create the server
const server = new Server(
  { name: "pkm-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [
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

Required: frontmatter.tags - provide at least one tag for the note.
Optional: frontmatter.status, frontmatter.project, frontmatter.deciders (depending on template type).
Pass custom <%...%> variables via the 'variables' parameter.`,
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
            description: "Custom variables for <%...%> patterns in body (key-value string pairs)",
            additionalProperties: { type: "string" }
          },
          frontmatter: {
            type: "object",
            description: "Frontmatter fields to set (e.g., {tags: ['tag1', 'tag2'], status: 'active'})",
            properties: {
              tags: { type: "array", items: { type: "string" }, description: "Tags for the note (required)" },
              status: { type: "string", description: "Note status" },
              project: { type: "string", description: "Project name (for devlogs)" },
              deciders: { type: "string", description: "Decision makers (for ADRs)" }
            }
          },
          createDirs: { type: "boolean", description: "Create parent directories if they don't exist", default: true }
        },
        required: ["template", "path"]
      }
    },
    {
      name: "vault_append",
      description: "Append content to an existing file, optionally under a specific heading. When 'position' is specified, heading is required and must exist in the file.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to vault root" },
          content: { type: "string", description: "Content to append" },
          heading: { type: "string", description: "Optional: append under this heading (e.g., '## Recent Activity')" },
          position: { type: "string", enum: ["after_heading", "before_heading", "end_of_section"], description: "Where to insert relative to heading. after_heading: right after the heading line. before_heading: right before the heading line. end_of_section: at the end of the section (before the next same-or-higher-level heading, or EOF). Requires heading." }
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
      name: "vault_neighborhood",
      description: "Explore the graph neighborhood around a note by traversing wikilinks. Returns notes grouped by hop distance from the starting note, with frontmatter metadata for each node. Useful for understanding clusters, finding related context, and discovering connections.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the starting note (relative to vault root)" },
          depth: { type: "number", description: "Traversal depth — how many hops to follow (default: 2)", default: 2 },
          direction: {
            type: "string",
            enum: ["both", "outgoing", "incoming"],
            description: "Link direction to follow (default: both)",
            default: "both"
          }
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
    },
    {
      name: "vault_tags",
      description: "Discover all tags used across the vault with per-note occurrence counts. Useful for exploring tag conventions, finding hierarchical tag trees, and understanding vault organization.",
      inputSchema: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Optional: limit to this folder (e.g., '01-Projects')" },
          pattern: { type: "string", description: "Glob-like filter: 'pkm/*' (hierarchical), '*research*' (substring), 'dev*' (prefix)" },
          include_inline: { type: "boolean", description: "Also parse inline #tags from note bodies (default: false, frontmatter only)", default: false }
        }
      }
    },
    {
      name: "vault_activity",
      description: "Query or clear the activity log. Shows tool calls made across sessions with timestamps and arguments. Use action 'query' to retrieve entries, 'clear' to delete entries.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["query", "clear"],
            description: "Action to perform (default: query)",
            default: "query"
          },
          limit: {
            type: "number",
            description: "Max entries to return (query only, default: 50)",
            default: 50
          },
          tool: {
            type: "string",
            description: "Filter by tool name (e.g., 'vault_read', 'vault_write')"
          },
          session: {
            type: "string",
            description: "Filter by session ID"
          },
          since: {
            type: "string",
            description: "Filter entries on or after this ISO timestamp (e.g., '2026-02-08')"
          },
          before: {
            type: "string",
            description: "Filter entries before this ISO timestamp"
          },
          path: {
            type: "string",
            description: "Filter by file path substring in arguments"
          }
        }
      }
    }
  ];

  if (semanticIndex?.isAvailable) {
    tools.push({
      name: "vault_semantic_search",
      description: "Search the vault using semantic similarity. Finds conceptually related notes even when they use different words. Requires OPENAI_API_KEY.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query (e.g., 'managing information overload')" },
          limit: { type: "number", description: "Max results to return (default: 5)", default: 5 },
          folder: { type: "string", description: "Optional: limit search to this folder (e.g., '01-Projects')" },
          threshold: { type: "number", description: "Minimum similarity score 0-1 (default: no threshold)" }
        },
        required: ["query"]
      }
    });
    tools.push({
      name: "vault_suggest_links",
      description: "Suggest relevant notes to link to based on content similarity. Accepts text content or a file path, finds semantically related notes, and excludes notes already linked via [[wikilinks]].",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "Text content to find link suggestions for. Takes precedence over path." },
          path: { type: "string", description: "Path to an existing note to suggest links for. Used if content is not provided." },
          limit: { type: "number", description: "Max suggestions to return (default: 5)", default: 5 },
          folder: { type: "string", description: "Optional: limit suggestions to this folder (e.g., '01-Projects')" },
          threshold: { type: "number", description: "Minimum similarity score 0-1 (default: no threshold)" }
        }
      }
    });
  }

  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Log activity (skip vault_activity to avoid noise)
  if (name !== "vault_activity") {
    try { activityLog?.log(name, args); } catch (e) { console.error(`Activity log: ${e.message}`); }
  }

  try {
    switch (name) {
      case "vault_read": {
        const filePath = resolvePath(args.path);
        const content = await fs.readFile(filePath, "utf-8");
        return { content: [{ type: "text", text: content }] };
      }

      case "vault_write": {
        const { template: templateName, path: outputPath, variables = {}, frontmatter = {}, createDirs = true } = args;

        // 1. Validate template exists
        const templateInfo = templateRegistry.get(templateName);
        if (!templateInfo) {
          const available = Array.from(templateRegistry.keys()).join(", ");
          throw new Error(`Template "${templateName}" not found. Available templates: ${available || "(none)"}`);
        }

        // 2. Check file doesn't already exist
        const filePath = resolvePath(outputPath);
        try {
          await fs.access(filePath);
          throw new Error(`File already exists: ${outputPath}. Use vault_edit or vault_append to modify existing files.`);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
          // File doesn't exist - good, proceed
        }

        // 3. Derive title from output path
        const title = path.basename(outputPath, ".md");

        // 4. Substitute variables
        const substituted = substituteTemplateVariables(templateInfo.content, {
          title,
          custom: variables,
          frontmatter
        });

        // 5. Validate frontmatter (strict)
        const validation = validateFrontmatterStrict(substituted);
        if (!validation.valid) {
          throw new Error(`Template validation failed:\n${validation.errors.join("\n")}`);
        }

        // 6. Create directories if needed
        if (createDirs) {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
        }

        // 7. Write file
        await fs.writeFile(filePath, substituted, "utf-8");

        // 8. Return success with frontmatter summary
        const fm = validation.frontmatter;
        const createdStr = fm.created instanceof Date
          ? fm.created.toISOString().split("T")[0]
          : fm.created;
        return {
          content: [{
            type: "text",
            text: `Created ${outputPath} from template "${templateName}"\n\nFrontmatter:\n- type: ${fm.type}\n- created: ${createdStr}\n- tags: ${(fm.tags || []).filter(Boolean).join(", ")}`
          }]
        };
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
        if (args.position) {
          // Positional insert mode — heading is required and must exist
          if (!args.heading) {
            throw new Error("'heading' is required when 'position' is specified");
          }
          if (!existing.includes(args.heading)) {
            throw new Error(`Heading not found in ${args.path}: ${args.heading}`);
          }

          const headingIndex = existing.indexOf(args.heading);
          const headingLineEnd = existing.indexOf("\n", headingIndex);
          const afterHeading = headingLineEnd === -1 ? existing.length : headingLineEnd + 1;

          if (args.position === "before_heading") {
            newContent = existing.slice(0, headingIndex) + args.content + "\n" + existing.slice(headingIndex);
          } else if (args.position === "after_heading") {
            newContent = existing.slice(0, afterHeading) + args.content + "\n" + existing.slice(afterHeading);
          } else if (args.position === "end_of_section") {
            // Find section end: next heading at same or higher level
            const headingMatch = args.heading.match(/^(#{1,6})\s/);
            const headingLevel = headingMatch ? headingMatch[1].length : 0;
            let sectionEnd = existing.length;

            if (headingLevel > 0) {
              // Search line-by-line from after the heading
              const lines = existing.slice(afterHeading).split("\n");
              let offset = afterHeading;
              for (const line of lines) {
                const lineMatch = line.match(/^(#{1,6})\s/);
                if (lineMatch && lineMatch[1].length <= headingLevel) {
                  sectionEnd = offset;
                  break;
                }
                offset += line.length + 1; // +1 for newline
              }
            }

            // Insert before the section boundary, ensuring a newline separator
            const before = existing.slice(0, sectionEnd);
            const after = existing.slice(sectionEnd);
            const separator = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
            newContent = before + separator + args.content + "\n" + after;
          }
        } else if (args.heading && existing.includes(args.heading)) {
          // Legacy behavior: insert after heading (no position param)
          const headingIndex = existing.indexOf(args.heading);
          const headingLineEnd = existing.indexOf("\n", headingIndex);
          const afterHeading = headingLineEnd === -1 ? existing.length : headingLineEnd + 1;
          newContent = existing.slice(0, afterHeading) + args.content + "\n" + existing.slice(afterHeading);
        } else {
          // Append to end
          newContent = existing + "\n" + args.content;
        }

        await fs.writeFile(filePath, newContent, "utf-8");
        return { content: [{ type: "text", text: `Appended to ${args.path}${args.position ? ` (${args.position})` : ""}` }] };
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

      case "vault_neighborhood": {
        const depth = args.depth || 2;
        const direction = args.direction || "both";

        const result = await exploreNeighborhood({
          startPath: args.path,
          vaultPath: VAULT_PATH,
          depth,
          direction,
        });

        const text = formatNeighborhood(result, {
          startPath: args.path,
          depth,
          direction,
        });

        return { content: [{ type: "text", text }] };
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

      case "vault_tags": {
        const searchDir = args.folder ? resolvePath(args.folder) : VAULT_PATH;
        const files = await getAllMarkdownFiles(searchDir);
        const tagCounts = new Map();
        let notesWithTags = 0;

        for (const file of files) {
          const filePath = path.join(searchDir, file);
          const content = await fs.readFile(filePath, "utf-8");

          // Collect tags from this file (deduplicated per-file)
          const fileTags = new Set();

          // Frontmatter tags (always)
          const metadata = extractFrontmatter(content);
          if (metadata && Array.isArray(metadata.tags)) {
            for (const tag of metadata.tags) {
              if (tag) fileTags.add(String(tag).toLowerCase());
            }
          }

          // Inline tags (opt-in)
          if (args.include_inline) {
            for (const tag of extractInlineTags(content)) {
              fileTags.add(tag);
            }
          }

          // Increment counts (once per file per tag)
          if (fileTags.size > 0) {
            notesWithTags++;
            for (const tag of fileTags) {
              tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            }
          }
        }

        // Filter by pattern
        let results = Array.from(tagCounts.entries());
        if (args.pattern) {
          results = results.filter(([tag]) => matchesTagPattern(tag, args.pattern));
        }

        // Sort: count desc, then alphabetical
        results.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No tags found matching criteria." }]
          };
        }

        const header = `Found ${results.length} unique tag${results.length === 1 ? "" : "s"} across ${notesWithTags} note${notesWithTags === 1 ? "" : "s"}\n`;
        const lines = results.map(([tag, count]) => `${tag} (${count})`);

        return {
          content: [{ type: "text", text: header + "\n" + lines.join("\n") }]
        };
      }

      case "vault_activity": {
        const action = args.action || "query";

        if (action === "query") {
          const entries = activityLog?.query({
            limit: args.limit || 50,
            tool: args.tool,
            session: args.session,
            since: args.since,
            before: args.before,
            path: args.path
          }) || [];

          if (entries.length === 0) {
            return {
              content: [{ type: "text", text: `No activity entries found. (current session: ${SESSION_ID.slice(0, 8)})` }]
            };
          }

          const formatted = entries.map(e => {
            const ts = e.timestamp.replace("T", " ").slice(0, 19);
            const sessionShort = e.session_id.slice(0, 8);
            return `[${ts}] [${sessionShort}] ${e.tool_name}\n${e.args_json}`;
          }).join("\n\n");

          return {
            content: [{
              type: "text",
              text: `Activity log (${entries.length} entr${entries.length === 1 ? "y" : "ies"}, current session: ${SESSION_ID.slice(0, 8)}):\n\n${formatted}`
            }]
          };
        }

        if (action === "clear") {
          const deleted = activityLog?.clear({
            session: args.session,
            tool: args.tool,
            before: args.before
          }) || 0;

          return {
            content: [{
              type: "text",
              text: `Cleared ${deleted} activity entr${deleted === 1 ? "y" : "ies"}.`
            }]
          };
        }

        throw new Error(`Unknown action: ${action}. Use 'query' or 'clear'.`);
      }

      case "vault_semantic_search": {
        if (!semanticIndex?.isAvailable) {
          throw new Error("Semantic search not available (OPENAI_API_KEY not set)");
        }
        const text = await semanticIndex.search({
          query: args.query,
          limit: args.limit || 5,
          folder: args.folder,
          threshold: args.threshold
        });
        return { content: [{ type: "text", text }] };
      }

      case "vault_suggest_links": {
        if (!semanticIndex?.isAvailable) {
          throw new Error("Link suggestions not available (OPENAI_API_KEY not set)");
        }

        // Resolve input text
        let inputText = args.content;
        let sourcePath = args.path;
        if (!inputText && !sourcePath) {
          throw new Error("Either 'content' or 'path' must be provided");
        }
        if (!inputText) {
          const filePath = resolvePath(sourcePath);
          inputText = await fs.readFile(filePath, "utf-8");
        }

        // Strip frontmatter for embedding
        let body = inputText;
        if (body.startsWith("---")) {
          const endIdx = body.indexOf("---", 3);
          if (endIdx !== -1) body = body.slice(endIdx + 3).trim();
        }
        if (!body) throw new Error("No content to analyze");

        // Parse existing [[wikilinks]] to build exclusion set
        const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        const linkedNames = new Set();
        let match;
        while ((match = linkRegex.exec(inputText)) !== null) {
          // Store basename (without path/extension) for matching
          const target = match[1];
          linkedNames.add(path.basename(target, ".md").toLowerCase());
        }

        // Find similar notes via semantic index
        const excludeFiles = new Set();
        if (sourcePath) excludeFiles.add(sourcePath);

        const results = await semanticIndex.searchRaw({
          query: body.slice(0, 8000), // truncate to embedding model limit
          limit: (args.limit || 5) * 3, // overfetch to compensate for post-filtering
          folder: args.folder,
          threshold: args.threshold,
          excludeFiles
        });

        // Filter out already-linked notes
        const suggestions = [];
        for (const r of results) {
          if (suggestions.length >= (args.limit || 5)) break;
          const basename = path.basename(r.path, ".md").toLowerCase();
          if (linkedNames.has(basename)) continue;
          suggestions.push(r);
        }

        if (suggestions.length === 0) {
          return { content: [{ type: "text", text: "No link suggestions found." }] };
        }

        const formatted = suggestions.map(r =>
          `**${r.path}** (score: ${r.score})\n${r.preview}`
        ).join("\n\n");

        return {
          content: [{ type: "text", text: `Found ${suggestions.length} link suggestion${suggestions.length === 1 ? "" : "s"}:\n\n${formatted}` }]
        };
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

// Initialize and start the server
async function initializeServer() {
  // Load templates before connecting
  templateRegistry = await loadTemplates();

  // Build template descriptions for tool schema
  if (templateRegistry.size > 0) {
    templateDescriptions = Array.from(templateRegistry.values())
      .map(t => `- **${t.shortName}**: ${t.description}`)
      .join("\n");
  } else {
    templateDescriptions = "(No templates found - add .md files to 05-Templates/)";
  }

  // Initialize semantic index if API key is available
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (openaiApiKey) {
    try {
      semanticIndex = new SemanticIndex({ vaultPath: VAULT_PATH, openaiApiKey });
      await semanticIndex.initialize();
      console.error("Semantic index initialized");
    } catch (err) {
      console.error(`Semantic index init failed (non-fatal): ${err.message}`);
      semanticIndex = null;
    }
  } else {
    console.error("OPENAI_API_KEY not set — semantic search disabled");
  }

  // Initialize activity log
  try {
    activityLog = new ActivityLog({ vaultPath: VAULT_PATH, sessionId: SESSION_ID });
    await activityLog.initialize();
    console.error(`Activity log initialized (session: ${SESSION_ID.slice(0, 8)})`);
  } catch (err) {
    console.error(`Activity log init failed (non-fatal): ${err.message}`);
    activityLog = null;
  }

  // Connect server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`PKM MCP Server running... (${templateRegistry.size} templates loaded${semanticIndex?.isAvailable ? ", semantic search enabled" : ""}, activity log ${activityLog ? "enabled" : "disabled"})`);
}

initializeServer();
