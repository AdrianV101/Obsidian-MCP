#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import crypto from "crypto";
import { createRequire } from "module";
import { SemanticIndex } from "./embeddings.js";
import { ActivityLog } from "./activity.js";
import { loadTemplates } from "./helpers.js";
import { createHandlers } from "./handlers.js";

// Read version from package.json
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("./package.json");

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

// Handler map (populated at startup)
let handlers;

// Create the server
const server = new Server(
  { name: "pkm-mcp-server", version: PKG_VERSION },
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
    const handler = handlers.get(name);
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return await handler(args);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

// Initialize and start the server
async function initializeServer() {
  templateRegistry = await loadTemplates(VAULT_PATH);

  if (templateRegistry.size > 0) {
    templateDescriptions = Array.from(templateRegistry.values())
      .map(t => `- **${t.shortName}**: ${t.description}`)
      .join("\n");
  } else {
    templateDescriptions = "(No templates found - add .md files to 05-Templates/)";
  }

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

  try {
    activityLog = new ActivityLog({ vaultPath: VAULT_PATH, sessionId: SESSION_ID });
    await activityLog.initialize();
    console.error(`Activity log initialized (session: ${SESSION_ID.slice(0, 8)})`);
  } catch (err) {
    console.error(`Activity log init failed (non-fatal): ${err.message}`);
    activityLog = null;
  }

  handlers = createHandlers({
    vaultPath: VAULT_PATH,
    templateRegistry,
    semanticIndex,
    activityLog,
    sessionId: SESSION_ID,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`PKM MCP Server running... (${templateRegistry.size} templates loaded${semanticIndex?.isAvailable ? ", semantic search enabled" : ""}, activity log ${activityLog ? "enabled" : "disabled"})`);
}

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error("Shutting down...");
  const forceTimer = setTimeout(() => {
    console.error("Shutdown timed out, forcing exit");
    process.exit(1);
  }, 5000);
  forceTimer.unref();
  try {
    if (semanticIndex) await semanticIndex.shutdown();
  } catch (e) {
    console.error(`Semantic index shutdown error: ${e.message}`);
  }
  if (activityLog) activityLog.shutdown();
  clearTimeout(forceTimer);
  process.exit(0);
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

initializeServer();
