import fs from "fs/promises";
import path from "path";
import {
  resolvePath as resolvePathBase,
  matchesFilters,
  formatMetadata,
  countOccurrences,
  substituteTemplateVariables,
  validateFrontmatterStrict,
  extractInlineTags,
  matchesTagPattern,
  findSectionRange,
  listHeadings,
  extractTailSections,
  buildBasenameMap,
  resolveFuzzyPath,
  resolveFuzzyFolder,
} from "./helpers.js";
import { exploreNeighborhood, formatNeighborhood } from "./graph.js";
import { getAllMarkdownFiles, extractFrontmatter } from "./utils.js";

/**
 * Create all tool handler functions with shared context.
 * @param {Object} ctx
 * @param {string} ctx.vaultPath - absolute path to vault root
 * @param {Map} ctx.templateRegistry - loaded templates
 * @param {Object|null} ctx.semanticIndex - SemanticIndex instance (null if no API key)
 * @param {Object|null} ctx.activityLog - ActivityLog instance
 * @param {string} ctx.sessionId - current session UUID
 * @returns {Map<string, function>} tool name to handler function
 */
export async function createHandlers({ vaultPath, templateRegistry, semanticIndex, activityLog, sessionId }) {
  const resolvePath = (relativePath) => resolvePathBase(relativePath, vaultPath);

  // Build basename map for fuzzy path resolution (read-only tools)
  const allFiles = await getAllMarkdownFiles(vaultPath);
  const { basenameMap, allFilesSet } = buildBasenameMap(allFiles);

  /** Resolve a file path with fuzzy fallback (for read-only tools). */
  const resolveFile = (inputPath) => {
    const resolved = resolveFuzzyPath(inputPath, basenameMap, allFilesSet);
    return resolvePath(resolved);
  };

  /** Resolve a folder path with fuzzy fallback. */
  const resolveFolder = (folder) => {
    // Security check first — reject traversal attempts immediately
    const exactResolved = resolvePath(folder);

    // Check if this is a known directory (any file has it as a prefix)
    const isKnownDir = Array.from(allFilesSet).some(f => f.startsWith(folder + "/") || f.startsWith(folder + path.sep));
    if (isKnownDir) return exactResolved;

    // Not a known directory — try fuzzy resolution
    const resolvedFolder = resolveFuzzyFolder(folder, Array.from(allFilesSet));
    return resolvePath(resolvedFolder);
  };

  async function handleRead(args) {
    const filePath = resolveFile(args.path);
    const content = await fs.readFile(filePath, "utf-8");

    // Validate mutual exclusivity
    const modes = [args.heading, args.tail, args.tail_sections].filter(Boolean);
    if (modes.length > 1) {
      throw new Error("Only one of 'heading', 'tail', or 'tail_sections' can be specified at a time");
    }

    let text = content;

    if (args.heading) {
      const range = findSectionRange(content, args.heading);
      if (!range) {
        const available = listHeadings(content);
        const list = available.length > 0
          ? `Available headings:\n${available.join("\n")}`
          : "No headings found in file";
        throw new Error(`Heading not found: ${args.heading}\n${list}`);
      }
      text = content.slice(range.headingStart, range.sectionEnd);
    } else if (args.tail) {
      // Extract frontmatter and prepend it
      let frontmatter = "";
      let body = content;
      if (content.startsWith("---")) {
        const endIndex = content.indexOf("\n---", 3);
        if (endIndex !== -1) {
          frontmatter = content.slice(0, endIndex + 4);
          body = content.slice(endIndex + 4);
        }
      }
      const lines = body.split("\n");
      const tailLines = lines.slice(-args.tail);
      text = frontmatter + (frontmatter && !frontmatter.endsWith("\n") ? "\n" : "") + tailLines.join("\n");
    } else if (args.tail_sections) {
      const level = args.section_level || 2;
      text = extractTailSections(content, args.tail_sections, level);
    }

    return { content: [{ type: "text", text }] };
  }

  async function handleWrite(args) {
    const { template: templateName, path: outputPath, variables = {}, frontmatter = {}, createDirs = true } = args;

    const templateInfo = templateRegistry.get(templateName);
    if (!templateInfo) {
      const available = Array.from(templateRegistry.keys()).join(", ");
      throw new Error(`Template "${templateName}" not found. Available templates: ${available || "(none)"}`);
    }

    const filePath = resolvePath(outputPath);
    try {
      await fs.access(filePath);
      throw new Error(`File already exists: ${outputPath}. Use vault_edit or vault_append to modify existing files.`);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }

    const title = path.basename(outputPath, ".md");
    const substituted = substituteTemplateVariables(templateInfo.content, {
      title,
      custom: variables,
      frontmatter
    });

    const validation = validateFrontmatterStrict(substituted);
    if (!validation.valid) {
      throw new Error(`Template validation failed:\n${validation.errors.join("\n")}`);
    }

    if (createDirs) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
    }

    await fs.writeFile(filePath, substituted, "utf-8");

    // Update basename map with the new file
    const newBasename = path.basename(outputPath, ".md").toLowerCase();
    if (!basenameMap.has(newBasename)) {
      basenameMap.set(newBasename, []);
    }
    basenameMap.get(newBasename).push(outputPath);
    allFilesSet.add(outputPath);

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

  async function handleAppend(args) {
    const filePath = resolvePath(args.path);
    let existing;
    try {
      existing = await fs.readFile(filePath, "utf-8");
    } catch (e) {
      if (e.code === "ENOENT") {
        throw new Error(`File not found: ${args.path}. Use vault_write to create new files.`, { cause: e });
      }
      throw e;
    }

    let newContent;
    if (args.position) {
      if (!args.heading) {
        throw new Error("'heading' is required when 'position' is specified");
      }
      const range = findSectionRange(existing, args.heading);
      if (!range) {
        throw new Error(`Heading not found in ${args.path}: ${args.heading}`);
      }

      if (args.position === "before_heading") {
        newContent = existing.slice(0, range.headingStart) + args.content + "\n" + existing.slice(range.headingStart);
      } else if (args.position === "after_heading") {
        newContent = existing.slice(0, range.afterHeading) + args.content + "\n" + existing.slice(range.afterHeading);
      } else if (args.position === "end_of_section") {
        const before = existing.slice(0, range.sectionEnd);
        const after = existing.slice(range.sectionEnd);
        const separator = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
        newContent = before + separator + args.content + "\n" + after;
      }
    } else if (args.heading) {
      const range = findSectionRange(existing, args.heading);
      if (range) {
        newContent = existing.slice(0, range.afterHeading) + args.content + "\n" + existing.slice(range.afterHeading);
      } else {
        newContent = existing + "\n" + args.content;
      }
    } else {
      newContent = existing + "\n" + args.content;
    }

    await fs.writeFile(filePath, newContent, "utf-8");
    return { content: [{ type: "text", text: `Appended to ${args.path}${args.position ? ` (${args.position})` : ""}` }] };
  }

  async function handleEdit(args) {
    const filePath = resolvePath(args.path);
    const content = await fs.readFile(filePath, "utf-8");
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

    const newContent = content.replace(args.old_string, () => args.new_string);
    await fs.writeFile(filePath, newContent, "utf-8");
    return { content: [{ type: "text", text: `Successfully edited ${args.path}` }] };
  }

  async function handleSearch(args) {
    const searchDir = args.folder ? resolveFolder(args.folder) : vaultPath;
    const files = await getAllMarkdownFiles(searchDir);
    const results = [];
    const query = args.query.toLowerCase();
    const limit = args.limit || 10;

    for (const file of files) {
      if (results.length >= limit) break;
      const filePath = path.join(searchDir, file);
      const content = await fs.readFile(filePath, "utf-8");
      if (content.toLowerCase().includes(query)) {
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

  async function handleList(args) {
    const listPath = resolvePath(args.path || "");
    const entries = await fs.readdir(listPath, { withFileTypes: true });

    const items = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const itemPath = path.join(args.path || "", entry.name);
      if (entry.isDirectory()) {
        items.push(`[dir] ${itemPath}/`);
        if (args.recursive) {
          const subItems = await getAllMarkdownFiles(path.join(listPath, entry.name));
          items.push(...subItems.map(f => `  ${path.join(itemPath, f)}`));
        }
      } else if (!args.pattern || entry.name.match(new RegExp("^" + args.pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*?") + "$"))) {
        items.push(itemPath);
      }
    }

    return { content: [{ type: "text", text: items.join("\n") || "Empty directory" }] };
  }

  async function handleRecent(args) {
    const searchDir = args.folder ? resolveFolder(args.folder) : vaultPath;
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

  async function handleLinks(args) {
    const resolvedVaultRelative = resolveFuzzyPath(args.path, basenameMap, allFilesSet);
    const filePath = resolvePath(resolvedVaultRelative);
    const content = await fs.readFile(filePath, "utf-8");
    const fileName = path.basename(resolvedVaultRelative, ".md");

    const result = { outgoing: [], incoming: [] };

    if (args.direction !== "incoming") {
      const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
      let match;
      while ((match = linkRegex.exec(content)) !== null) {
        result.outgoing.push(match[1]);
      }
    }

    if (args.direction !== "outgoing") {
      const allFiles = await getAllMarkdownFiles(vaultPath);
      for (const file of allFiles) {
        if (file === resolvedVaultRelative) continue;
        const fileContent = await fs.readFile(path.join(vaultPath, file), "utf-8");
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

  async function handleNeighborhood(args) {
    const resolvedPath = resolveFuzzyPath(args.path, basenameMap, allFilesSet);
    const depth = Math.min(args.depth || 2, 5);
    const direction = args.direction || "both";

    const result = await exploreNeighborhood({
      startPath: resolvedPath,
      vaultPath,
      depth,
      direction,
    });

    const text = formatNeighborhood(result, {
      startPath: resolvedPath,
      depth,
      direction,
    });

    return { content: [{ type: "text", text }] };
  }

  async function handleQuery(args) {
    const searchDir = args.folder ? resolveFolder(args.folder) : vaultPath;
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

  async function handleTags(args) {
    const searchDir = args.folder ? resolveFolder(args.folder) : vaultPath;
    const files = await getAllMarkdownFiles(searchDir);
    const tagCounts = new Map();
    let notesWithTags = 0;

    for (const file of files) {
      const filePath = path.join(searchDir, file);
      const content = await fs.readFile(filePath, "utf-8");

      const fileTags = new Set();

      const metadata = extractFrontmatter(content);
      if (metadata && Array.isArray(metadata.tags)) {
        for (const tag of metadata.tags) {
          if (tag) fileTags.add(String(tag).toLowerCase());
        }
      }

      if (args.include_inline) {
        for (const tag of extractInlineTags(content)) {
          fileTags.add(tag);
        }
      }

      if (fileTags.size > 0) {
        notesWithTags++;
        for (const tag of fileTags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
    }

    let results = Array.from(tagCounts.entries());
    if (args.pattern) {
      results = results.filter(([tag]) => matchesTagPattern(tag, args.pattern));
    }

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

  async function handleActivity(args) {
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
          content: [{ type: "text", text: `No activity entries found. (current session: ${sessionId.slice(0, 8)})` }]
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
          text: `Activity log (${entries.length} entr${entries.length === 1 ? "y" : "ies"}, current session: ${sessionId.slice(0, 8)}):\n\n${formatted}`
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

  async function handleSemanticSearch(args) {
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

  async function handleSuggestLinks(args) {
    if (!semanticIndex?.isAvailable) {
      throw new Error("Link suggestions not available (OPENAI_API_KEY not set)");
    }

    let inputText = args.content;
    const sourcePath = args.path;
    if (!inputText && !sourcePath) {
      throw new Error("Either 'content' or 'path' must be provided");
    }
    if (!inputText) {
      const filePath = resolveFile(sourcePath);
      inputText = await fs.readFile(filePath, "utf-8");
    }

    let body = inputText;
    if (body.startsWith("---")) {
      const endIdx = body.indexOf("---", 3);
      if (endIdx !== -1) body = body.slice(endIdx + 3).trim();
    }
    if (!body) throw new Error("No content to analyze");

    const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    const linkedNames = new Set();
    let match;
    while ((match = linkRegex.exec(inputText)) !== null) {
      const target = match[1];
      linkedNames.add(path.basename(target, ".md").toLowerCase());
    }

    const excludeFiles = new Set();
    if (sourcePath) excludeFiles.add(sourcePath);

    const results = await semanticIndex.searchRaw({
      query: body.slice(0, 8000),
      limit: (args.limit || 5) * 3,
      folder: args.folder,
      threshold: args.threshold,
      excludeFiles
    });

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

  return new Map([
    ["vault_read", handleRead],
    ["vault_write", handleWrite],
    ["vault_append", handleAppend],
    ["vault_edit", handleEdit],
    ["vault_search", handleSearch],
    ["vault_list", handleList],
    ["vault_recent", handleRecent],
    ["vault_links", handleLinks],
    ["vault_neighborhood", handleNeighborhood],
    ["vault_query", handleQuery],
    ["vault_tags", handleTags],
    ["vault_activity", handleActivity],
    ["vault_semantic_search", handleSemanticSearch],
    ["vault_suggest_links", handleSuggestLinks],
  ]);
}
