import fs from "fs/promises";
import path from "path";
import { getAllMarkdownFiles, extractFrontmatter } from "./utils.js";
import { buildBasenameMap } from "./helpers.js";

const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/** Extract all wikilink targets from markdown content. */
export function extractWikilinks(content) {
  const links = [];
  const regex = new RegExp(WIKILINK_REGEX.source, WIKILINK_REGEX.flags);
  let match;
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1]);
  }
  return links;
}


/**
 * Resolve a wikilink target to actual file paths.
 *
 * Resolution order:
 * 1. Try exact relative path match (e.g., "folder/note" -> "folder/note.md")
 * 2. Fall back to basename match (e.g., "note" -> any "note.md" in vault)
 *
 * @param {string} linkTarget - raw wikilink target text
 * @param {Map<string, string[]>} resolutionMap - from buildLinkResolutionMap
 * @param {Set<string>} allFilesSet - vault-relative file paths as a Set (for O(1) exact path matching)
 * @returns {{ paths: string[], ambiguous: boolean }}
 */
export function resolveLink(linkTarget, resolutionMap, allFilesSet) {
  // Strip heading/block references: [[note#heading]] -> "note"
  const cleaned = linkTarget.split("#")[0].split("^")[0].trim();
  if (!cleaned) return { paths: [], ambiguous: false };

  // 1. Try exact path match (with .md extension)
  const withExt = cleaned.endsWith(".md") ? cleaned : cleaned + ".md";
  if (allFilesSet.has(withExt)) {
    return { paths: [withExt], ambiguous: false };
  }

  // 2. Basename match
  const basename = path.basename(cleaned, ".md").toLowerCase();
  const matches = resolutionMap.get(basename) || [];
  return { paths: matches, ambiguous: matches.length > 1 };
}

/**
 * Find all files that contain wikilinks resolving to a given target path.
 * Returns file paths and their content for downstream processing (e.g., link rewriting).
 *
 * @param {string} targetPath - vault-relative path of the target file
 * @param {string} vaultPath - absolute vault root
 * @param {string[]} allFiles - all vault-relative file paths
 * @param {Map<string, string[]>} resolutionMap - from buildBasenameMap
 * @param {Set<string>} allFilesSet - all file paths as a Set
 * @returns {Promise<Array<{file: string, content: string}>>}
 */
export async function findFilesLinkingTo(targetPath, vaultPath, allFiles, resolutionMap, allFilesSet) {
  const linking = [];
  for (const file of allFiles) {
    if (file === targetPath) continue;
    const content = await fs.readFile(path.join(vaultPath, file), "utf-8");
    const links = extractWikilinks(content);
    for (const link of links) {
      const resolved = resolveLink(link, resolutionMap, allFilesSet);
      if (resolved.paths.includes(targetPath)) {
        linking.push({ file, content });
        break;
      }
    }
  }
  return linking;
}

/**
 * Rewrite wikilinks in content that match an old target to point to a new target.
 * Preserves aliases (|text) and heading/block references (#heading, ^block).
 *
 * @param {string} content - file content
 * @param {string} oldTarget - old link target (basename or path, without .md)
 * @param {string} newTarget - new link target (basename or path, without .md)
 * @returns {string} content with links rewritten
 */
export function rewriteWikilinks(content, oldTarget, newTarget) {
  // Match [[...]] links, capturing the full inner text
  return content.replace(/\[\[([^\]]+)\]\]/g, (fullMatch, inner) => {
    // Split on | first to separate alias
    const pipeIdx = inner.indexOf("|");
    const linkPart = pipeIdx !== -1 ? inner.slice(0, pipeIdx) : inner;
    const aliasPart = pipeIdx !== -1 ? inner.slice(pipeIdx) : ""; // includes the |

    // Split link part on # to separate heading/block ref
    const hashIdx = linkPart.indexOf("#");
    const pathPart = hashIdx !== -1 ? linkPart.slice(0, hashIdx) : linkPart;
    const fragPart = hashIdx !== -1 ? linkPart.slice(hashIdx) : ""; // includes the #

    // Check if this link's path matches the old target
    const pathTrimmed = pathPart.trim();
    const pathNoExt = pathTrimmed.endsWith(".md") ? pathTrimmed.slice(0, -3) : pathTrimmed;

    // Match by exact path or by basename
    const oldNoExt = oldTarget.endsWith(".md") ? oldTarget.slice(0, -3) : oldTarget;
    const oldBasename = oldNoExt.includes("/") ? oldNoExt.split("/").pop() : oldNoExt;

    if (pathNoExt === oldNoExt || pathNoExt === oldBasename) {
      return `[[${newTarget}${fragPart}${aliasPart}]]`;
    }

    return fullMatch;
  });
}

// --- Link Discovery ---

/**
 * Build an incoming link index: for each resolved target file, which source files link to it.
 * Uses proper link resolution so ambiguous basenames are handled correctly.
 *
 * @param {string} vaultPath - absolute vault path
 * @param {string[]} allFiles - vault-relative file paths
 * @param {Map<string, string[]>} resolutionMap - from buildLinkResolutionMap
 * @param {Set<string>} allFilesSet - vault-relative file paths as a Set
 * @returns {Promise<Map<string, Set<string>>>} targetPath -> Set<sourcePath>
 */
async function buildIncomingIndex(vaultPath, allFiles, resolutionMap, allFilesSet) {
  const index = new Map(); // targetPath -> Set<sourcePath>

  for (const file of allFiles) {
    const content = await fs.readFile(path.join(vaultPath, file), "utf-8");
    const links = extractWikilinks(content);
    for (const link of links) {
      const resolved = resolveLink(link, resolutionMap, allFilesSet);
      for (const targetPath of resolved.paths) {
        if (targetPath === file) continue; // skip self-links
        if (!index.has(targetPath)) {
          index.set(targetPath, new Set());
        }
        index.get(targetPath).add(file);
      }
    }
  }

  return index;
}

/**
 * Get incoming links for a specific file.
 *
 * @param {string} filePath - vault-relative path
 * @param {Map<string, Set<string>>} incomingIndex - from buildIncomingIndex
 * @returns {string[]} source file paths
 */
function getIncomingLinks(filePath, incomingIndex) {
  const sources = incomingIndex.get(filePath);
  return sources ? Array.from(sources) : [];
}

// --- Graph Traversal ---

/**
 * Explore the graph neighborhood around a note using BFS.
 *
 * @param {Object} options
 * @param {string} options.startPath - vault-relative path to the starting note
 * @param {string} options.vaultPath - absolute vault root path
 * @param {number} [options.depth=2] - maximum traversal depth
 * @param {"both"|"outgoing"|"incoming"} [options.direction="both"] - link direction to follow
 * @returns {Promise<NeighborhoodResult>}
 *
 * @typedef {Object} NeighborhoodResult
 * @property {Map<number, NodeInfo[]>} depthGroups - nodes grouped by hop distance
 * @property {number} totalNodes - total nodes discovered
 *
 * @typedef {Object} NodeInfo
 * @property {string} path - vault-relative file path
 * @property {number} depth - hop distance from start
 * @property {boolean} ambiguous - true if reached via an ambiguous link
 * @property {Object} metadata - frontmatter metadata
 * @property {string|null} metadata.type
 * @property {string|null} metadata.status
 * @property {string[]} metadata.tags
 */
export async function exploreNeighborhood({
  startPath,
  vaultPath,
  depth: maxDepth = 2,
  direction = "both",
}) {
  // Verify start file exists
  const startFullPath = path.resolve(vaultPath, startPath);
  if (startFullPath !== vaultPath && !startFullPath.startsWith(vaultPath + path.sep)) {
    throw new Error("Path escapes vault directory");
  }
  await fs.access(startFullPath); // throws if missing

  // Build indexes once
  const allFiles = await getAllMarkdownFiles(vaultPath);
  const { basenameMap: resolutionMap, allFilesSet } = buildBasenameMap(allFiles);

  const needIncoming = direction === "both" || direction === "incoming";
  const incomingIndex = needIncoming
    ? await buildIncomingIndex(vaultPath, allFiles, resolutionMap, allFilesSet)
    : null;

  // BFS state
  const visited = new Set();
  const depthGroups = new Map();
  let queue = [{ path: startPath, depth: 0, ambiguous: false }];

  while (queue.length > 0) {
    const nextQueue = [];

    for (const { path: nodePath, depth, ambiguous } of queue) {
      if (visited.has(nodePath)) continue;
      visited.add(nodePath);

      // Read file and extract metadata
      let metadata = { type: null, status: null, tags: [] };
      let content = null;
      try {
        content = await fs.readFile(path.join(vaultPath, nodePath), "utf-8");
        const fm = extractFrontmatter(content);
        if (fm) {
          metadata = {
            type: fm.type || null,
            status: fm.status || null,
            tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
          };
        }
      } catch {
        // File unreadable - still record the node but skip link discovery
      }

      // Record node
      if (!depthGroups.has(depth)) {
        depthGroups.set(depth, []);
      }
      depthGroups.get(depth).push({ path: nodePath, depth, ambiguous, metadata });

      // Don't discover links beyond max depth
      if (depth >= maxDepth) continue;
      if (!content) continue;

      // Discover neighbors
      const needOutgoing = direction === "both" || direction === "outgoing";

      if (needOutgoing) {
        const outgoing = extractWikilinks(content);
        for (const link of outgoing) {
          const resolved = resolveLink(link, resolutionMap, allFilesSet);
          for (const targetPath of resolved.paths) {
            if (!visited.has(targetPath)) {
              nextQueue.push({
                path: targetPath,
                depth: depth + 1,
                ambiguous: resolved.ambiguous,
              });
            }
          }
        }
      }

      if (needIncoming && incomingIndex) {
        const incoming = getIncomingLinks(nodePath, incomingIndex);
        for (const sourcePath of incoming) {
          if (!visited.has(sourcePath)) {
            nextQueue.push({
              path: sourcePath,
              depth: depth + 1,
              ambiguous: false,
            });
          }
        }
      }
    }

    queue = nextQueue;
  }

  return {
    depthGroups,
    totalNodes: visited.size,
  };
}

/**
 * Format a neighborhood result as human-readable text.
 *
 * @param {NeighborhoodResult} result - from exploreNeighborhood
 * @param {Object} options
 * @param {string} options.startPath
 * @param {number} options.depth
 * @param {string} options.direction
 * @returns {string}
 */
export function formatNeighborhood(result, { startPath, depth, direction }) {
  const { depthGroups, totalNodes } = result;

  let output = `**Graph neighborhood for ${startPath}** (depth: ${depth}, direction: ${direction})\n`;
  output += `Total: ${totalNodes} node${totalNodes === 1 ? "" : "s"}\n`;

  // Sort depth keys
  const depths = Array.from(depthGroups.keys()).sort((a, b) => a - b);

  for (const d of depths) {
    const nodes = depthGroups.get(d);
    const label = d === 0 ? "Center" : `Depth ${d}`;
    output += `\n**${label}** (${nodes.length} node${nodes.length === 1 ? "" : "s"})\n`;

    for (const node of nodes) {
      let line = `- ${node.path}`;
      if (node.ambiguous) line += " [ambiguous]";

      const meta = [];
      if (node.metadata.type) meta.push(`type: ${node.metadata.type}`);
      if (node.metadata.status) meta.push(`status: ${node.metadata.status}`);
      if (node.metadata.tags.length > 0) meta.push(`tags: ${node.metadata.tags.join(", ")}`);
      if (meta.length > 0) line += `\n  ${meta.join(" | ")}`;

      output += line + "\n";
    }
  }

  return output;
}
