import fs from "fs/promises";
import path from "path";
import { extractFrontmatter } from "./utils.js";

/**
 * Resolve a relative path against the vault root with directory traversal protection.
 *
 * @param {string} relativePath - path relative to vault root
 * @param {string} vaultPath - absolute vault root path
 * @returns {string} absolute resolved path
 * @throws {Error} if resolved path escapes the vault directory
 */
export function resolvePath(relativePath, vaultPath) {
  const resolved = path.resolve(vaultPath, relativePath);
  if (resolved !== vaultPath && !resolved.startsWith(vaultPath + path.sep)) {
    throw new Error("Path escapes vault directory");
  }
  return resolved;
}

/**
 * Check if note metadata matches a set of query filters.
 *
 * @param {Object|null} metadata - parsed YAML frontmatter
 * @param {Object} filters
 * @param {string} [filters.type] - exact type match
 * @param {string} [filters.status] - exact status match
 * @param {string[]} [filters.tags] - ALL must be present
 * @param {string[]} [filters.tags_any] - ANY must be present
 * @param {string} [filters.created_after] - YYYY-MM-DD lower bound
 * @param {string} [filters.created_before] - YYYY-MM-DD upper bound
 * @returns {boolean}
 */
export function matchesFilters(metadata, filters) {
  if (!metadata) return false;

  if (filters.type && metadata.type !== filters.type) {
    return false;
  }

  if (filters.status && metadata.status !== filters.status) {
    return false;
  }

  if (filters.tags && filters.tags.length > 0) {
    const noteTags = (metadata.tags || []).filter(Boolean).map(t => String(t).toLowerCase());
    const allPresent = filters.tags.every(tag =>
      noteTags.includes(tag.toLowerCase())
    );
    if (!allPresent) return false;
  }

  if (filters.tags_any && filters.tags_any.length > 0) {
    const noteTags = (metadata.tags || []).filter(Boolean).map(t => String(t).toLowerCase());
    const anyPresent = filters.tags_any.some(tag =>
      noteTags.includes(tag.toLowerCase())
    );
    if (!anyPresent) return false;
  }

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

/**
 * Format metadata into a display-friendly summary and tag line.
 *
 * @param {Object} metadata - parsed YAML frontmatter
 * @returns {{ summary: string, tagLine: string }}
 */
export function formatMetadata(metadata) {
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

/**
 * Count non-overlapping occurrences of a substring.
 *
 * @param {string} content - text to search
 * @param {string} searchString - substring to find
 * @returns {number}
 */
export function countOccurrences(content, searchString) {
  if (searchString.length === 0) return 0;
  let count = 0;
  let position = 0;
  while ((position = content.indexOf(searchString, position)) !== -1) {
    count++;
    position += searchString.length;
  }
  return count;
}

/**
 * Extract a human-readable description from template content.
 *
 * @param {string} content - raw template markdown
 * @param {Object|null} frontmatter - parsed YAML frontmatter
 * @returns {string} description (max 80 chars)
 */
export function extractTemplateDescription(content, frontmatter) {
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

/**
 * Load all templates from the vault's 05-Templates/ directory.
 *
 * @param {string} vaultPath - absolute vault root path
 * @returns {Promise<Map<string, Object>>} template name -> { shortName, path, description, frontmatter, content }
 */
export async function loadTemplates(vaultPath) {
  const templatesDir = resolvePath("05-Templates", vaultPath);
  const templateMap = new Map();

  try {
    const files = await fs.readdir(templatesDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;

      const shortName = path.basename(file, ".md");
      const content = await fs.readFile(path.join(templatesDir, file), "utf-8");
      const frontmatter = extractFrontmatter(content);

      templateMap.set(shortName, {
        shortName,
        path: `05-Templates/${file}`,
        description: extractTemplateDescription(content, frontmatter),
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

/**
 * Substitute Templater-compatible variables and frontmatter fields in template content.
 *
 * @param {string} content - raw template content
 * @param {Object} vars
 * @param {string} [vars.title] - note title (for tp.file.title)
 * @param {Object} [vars.custom] - custom variable key-value pairs
 * @param {Object} [vars.frontmatter] - frontmatter fields to substitute
 * @returns {string} content with variables replaced
 */
export function substituteTemplateVariables(content, vars) {
  const now = new Date();
  const dateFormats = {
    "YYYY-MM-DD": now.toISOString().split("T")[0],
    "YYYY-MM-DD HH:mm": now.toISOString().replace("T", " ").slice(0, 16),
    "YYYY": now.getFullYear().toString(),
    "MM": String(now.getMonth() + 1).padStart(2, "0"),
    "DD": String(now.getDate()).padStart(2, "0")
  };

  let result = content;

  result = result.replace(/<%\s*tp\.date\.now\("([^"]+)"\)\s*%>/g, (match, format) => {
    return dateFormats[format] || now.toISOString().split("T")[0];
  });

  result = result.replace(/<%\s*tp\.file\.title\s*%>/g, vars.title || "Untitled");

  if (vars.custom) {
    for (const [key, value] of Object.entries(vars.custom)) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`<%\\s*${escaped}\\s*%>`, "g");
      result = result.replace(regex, value);
    }
  }

  if (vars.frontmatter && content.startsWith("---")) {
    const endIndex = result.indexOf("---", 3);
    if (endIndex !== -1) {
      const frontmatterSection = result.slice(0, endIndex + 3);
      const body = result.slice(endIndex + 3);

      let updatedFrontmatter = frontmatterSection;

      if (vars.frontmatter.tags && Array.isArray(vars.frontmatter.tags)) {
        const tagsYaml = vars.frontmatter.tags.map(t => `  - ${t}`).join("\n");
        let tagsReplaced = false;

        if (updatedFrontmatter.match(/^tags:\s*\[.*\]/m)) {
          updatedFrontmatter = updatedFrontmatter.replace(
            /^tags:\s*\[.*\]/m,
            `tags:\n${tagsYaml}`
          );
          tagsReplaced = true;
        }

        if (!tagsReplaced && updatedFrontmatter.match(/tags:\s*\n(?:\s+-[^\n]*\n?)*/)) {
          updatedFrontmatter = updatedFrontmatter.replace(
            /tags:\s*\n(?:\s+-[^\n]*\n?)*/,
            `tags:\n${tagsYaml}\n`
          );
          tagsReplaced = true;
        }

        if (!tagsReplaced) {
          updatedFrontmatter = updatedFrontmatter.replace(
            /\n---$/,
            `\ntags:\n${tagsYaml}\n---`
          );
        }
      }

      for (const [key, value] of Object.entries(vars.frontmatter)) {
        if (key === "tags") continue;
        if (typeof value === "string") {
          if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key)) {
            throw new Error(`Invalid frontmatter key: "${key}". Keys must start with a letter and contain only letters, digits, hyphens, or underscores.`);
          }
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

/**
 * Validate that rendered template content has all required frontmatter fields.
 *
 * @param {string} content - rendered template content
 * @returns {{ valid: boolean, errors: string[], frontmatter: Object|null }}
 */
export function validateFrontmatterStrict(content) {
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

/**
 * Extract inline #tags from markdown body (excludes frontmatter, code blocks, headings).
 *
 * @param {string} content - full markdown content including frontmatter
 * @returns {string[]} lowercase tag names
 */
export function extractInlineTags(content) {
  let body = content;

  if (content.startsWith("---")) {
    const endIndex = content.indexOf("---", 3);
    if (endIndex !== -1) {
      body = content.slice(endIndex + 3);
    }
  }

  body = body.replace(/```[\s\S]*?```/g, "");
  body = body.replace(/`[^`]+`/g, "");
  body = body.replace(/^#+\s/gm, "");

  const tags = new Set();
  const tagRegex = /(?:^|[^a-zA-Z0-9&])#([a-zA-Z_][a-zA-Z0-9_/-]*)/g;
  let match;
  while ((match = tagRegex.exec(body)) !== null) {
    tags.add(match[1].toLowerCase());
  }

  return Array.from(tags);
}

/**
 * Extract the heading level (1-6) from a markdown heading line, or 0 if not a heading.
 *
 * @param {string} line - a single line of text
 * @returns {number} heading level 1-6, or 0
 */
export function parseHeadingLevel(line) {
  const match = line.match(/^(#{1,6})\s/);
  return match ? match[1].length : 0;
}

/**
 * Find the byte-index range of a section under a given heading.
 *
 * @param {string} content - full file content
 * @param {string} heading - exact heading line to find (e.g. "## Section One")
 * @returns {{ headingStart: number, afterHeading: number, sectionEnd: number } | null}
 */
export function findSectionRange(content, heading) {
  let headingStart = -1;
  let searchFrom = 0;
  while (searchFrom < content.length) {
    const idx = content.indexOf(heading, searchFrom);
    if (idx === -1) break;
    // Only match at line boundaries: start of string or preceded by \n
    if (idx === 0 || content[idx - 1] === "\n") {
      headingStart = idx;
      break;
    }
    searchFrom = idx + 1;
  }
  if (headingStart === -1) return null;

  const headingLineEnd = content.indexOf("\n", headingStart);
  const afterHeading = headingLineEnd === -1 ? content.length : headingLineEnd + 1;

  const level = parseHeadingLevel(heading);
  let sectionEnd = content.length;

  if (level > 0) {
    const lines = content.slice(afterHeading).split("\n");
    let offset = afterHeading;
    for (const line of lines) {
      const lineLevel = parseHeadingLevel(line);
      if (lineLevel > 0 && lineLevel <= level) {
        sectionEnd = offset;
        break;
      }
      offset += line.length + 1;
    }
  }

  return { headingStart, afterHeading, sectionEnd };
}

/**
 * Return all heading lines from markdown content, excluding those inside frontmatter.
 *
 * @param {string} content - full markdown content
 * @returns {string[]} heading lines
 */
export function listHeadings(content) {
  let body = content;
  if (content.startsWith("---")) {
    const endIndex = content.indexOf("\n---", 3);
    if (endIndex !== -1) {
      body = content.slice(endIndex + 4);
    }
  }

  return body.split("\n").filter(line => /^#{1,6}\s/.test(line));
}

/**
 * Extract frontmatter + last N sections at a given heading level.
 *
 * @param {string} content - full file content
 * @param {number} n - number of sections to return
 * @param {number} level - heading level (1-6)
 * @returns {string} frontmatter + last N sections
 */
export function extractTailSections(content, n, level) {
  // Extract frontmatter
  let frontmatter = "";
  let body = content;
  if (content.startsWith("---")) {
    const endIndex = content.indexOf("\n---", 3);
    if (endIndex !== -1) {
      frontmatter = content.slice(0, endIndex + 4);
      body = content.slice(endIndex + 4);
    }
  }

  // Find all headings at exactly the given level
  const lines = body.split("\n");
  const headingPositions = [];
  let offset = 0;
  for (const line of lines) {
    if (parseHeadingLevel(line) === level) {
      headingPositions.push(offset);
    }
    offset += line.length + 1;
  }

  if (headingPositions.length === 0) {
    return content;
  }

  const startIdx = Math.max(0, headingPositions.length - n);
  const sliceStart = headingPositions[startIdx];
  const tail = body.slice(sliceStart);

  return frontmatter + (frontmatter && !frontmatter.endsWith("\n") ? "\n" : "") + tail;
}

/**
 * Match a tag against a glob-like pattern.
 * Supports: hierarchical prefix ("pkm/*"), substring ("*mcp*"), prefix ("dev*"), suffix ("*fix"), exact.
 *
 * @param {string} tag - tag to test
 * @param {string} [pattern] - glob-like pattern (returns true if omitted)
 * @returns {boolean}
 */
export function matchesTagPattern(tag, pattern) {
  if (!pattern) return true;

  const t = tag.toLowerCase();
  const p = pattern.toLowerCase();

  if (p.endsWith("/*")) {
    const prefix = p.slice(0, -2);
    return t === prefix || t.startsWith(prefix + "/");
  }

  if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
    return t.includes(p.slice(1, -1));
  }

  if (p.endsWith("*")) {
    return t.startsWith(p.slice(0, -1));
  }

  if (p.startsWith("*")) {
    return t.endsWith(p.slice(1));
  }

  return t === p;
}

/**
 * Build a lookup map from lowercase basename (without .md) to all matching vault-relative paths.
 * Also returns a Set of all file paths for O(1) exact-match checks.
 *
 * @param {string[]} allFiles - vault-relative file paths
 * @returns {{ basenameMap: Map<string, string[]>, allFilesSet: Set<string> }}
 */
export function buildBasenameMap(allFiles) {
  const basenameMap = new Map();
  const allFilesSet = new Set(allFiles);
  for (const filePath of allFiles) {
    const basename = path.basename(filePath, ".md").toLowerCase();
    if (!basenameMap.has(basename)) {
      basenameMap.set(basename, []);
    }
    basenameMap.get(basename).push(filePath);
  }
  return { basenameMap, allFilesSet };
}

/**
 * Resolve a short or partial path to a full vault-relative path.
 *
 * Resolution order:
 * 1. Exact match (path exists in allFilesSet as-is)
 * 2. Exact match with .md appended
 * 3. Basename match (with optional folder scoping)
 *
 * @param {string} inputPath - user-provided path (short name or full path)
 * @param {Map<string, string[]>} basenameMap - from buildBasenameMap
 * @param {Set<string>} allFilesSet - all vault-relative paths
 * @param {string} [folderScope] - optional folder prefix to filter matches
 * @returns {string} resolved vault-relative path
 * @throws {Error} if path not found or ambiguous
 */
export function resolveFuzzyPath(inputPath, basenameMap, allFilesSet, folderScope) {
  // 1. Exact match
  if (allFilesSet.has(inputPath)) return inputPath;

  // 2. Exact match with .md
  if (!inputPath.endsWith(".md")) {
    const withExt = inputPath + ".md";
    if (allFilesSet.has(withExt)) return withExt;
  }

  // 3. Basename match
  const basename = path.basename(inputPath, ".md").toLowerCase();
  let matches = basenameMap.get(basename) || [];

  // Apply folder scope if provided
  if (folderScope && matches.length > 1) {
    const scoped = matches.filter(p => p.startsWith(folderScope + "/"));
    if (scoped.length > 0) matches = scoped;
  }

  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new Error(`File not found: "${inputPath}". No matching file in vault.`);
  }

  const list = matches.map(p => `  - ${p}`).join("\n");
  throw new Error(
    `"${inputPath}" matches ${matches.length} files:\n${list}\nUse a more specific path or add folder param to narrow scope.`
  );
}

/**
 * Resolve a partial folder name to a full vault-relative directory path.
 *
 * Resolution order:
 * 1. Exact match — folder string is a known directory prefix of at least one file
 * 2. Substring match — case-insensitive substring of known directory paths
 *
 * @param {string} folder - user-provided folder (full or partial)
 * @param {string[]} allFiles - all vault-relative file paths
 * @returns {string} resolved vault-relative directory path
 * @throws {Error} if folder not found or ambiguous
 */
export function resolveFuzzyFolder(folder, allFiles) {
  // Collect all unique directory paths from the file list
  const dirs = new Set();
  for (const file of allFiles) {
    let dir = path.dirname(file);
    while (dir && dir !== ".") {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  }

  // 1. Exact match
  if (dirs.has(folder)) return folder;

  // 2. Substring match (case-insensitive)
  const lowerFolder = folder.toLowerCase();
  const matches = Array.from(dirs).filter(d => d.toLowerCase().includes(lowerFolder));

  // Deduplicate: if both "01-Projects/Obsidian-MCP" and
  // "01-Projects/Obsidian-MCP/development" match, prefer the shortest
  // that ends with the search term (most likely the intended target).
  if (matches.length > 1) {
    const endsWith = matches.filter(d => d.toLowerCase().endsWith(lowerFolder));
    if (endsWith.length === 1) return endsWith[0];
    if (endsWith.length > 1) {
      const list = endsWith.map(p => `  - ${p}`).join("\n");
      throw new Error(
        `"${folder}" matches ${endsWith.length} folders:\n${list}\nUse a more specific path.`
      );
    }
  }

  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new Error(`Folder not found: "${folder}". No matching directory in vault.`);
  }

  const list = matches.map(p => `  - ${p}`).join("\n");
  throw new Error(
    `"${folder}" matches ${matches.length} folders:\n${list}\nUse a more specific path.`
  );
}
