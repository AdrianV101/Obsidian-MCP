import fs from "fs/promises";
import path from "path";

/**
 * Extract YAML frontmatter as simple key-value pairs.
 * Lightweight parser — only handles scalar values (sufficient for status/priority).
 */
function extractFrontmatter(content) {
  if (!content.startsWith("---")) return null;
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) return null;
  const yamlContent = content.slice(4, endIndex);
  const result = {};
  for (const line of yamlContent.split("\n")) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

function parseHeadingLevel(line) {
  const match = line.match(/^(#{1,6})\s/);
  return match ? match[1].length : 0;
}

/**
 * Extract the last N sections at a given heading level from markdown content.
 */
function extractTailSections(content, n, level) {
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

export async function loadProjectContext(vaultPath, projectPath) {
  const projectName = path.basename(projectPath);
  const projectDir = path.join(vaultPath, projectPath);
  const sections = [];

  sections.push(`## PKM Project Context: ${projectName}`);

  try {
    const indexContent = await fs.readFile(path.join(projectDir, "_index.md"), "utf-8");
    sections.push(`### Project Index\n${indexContent}`);
  } catch (e) {
    if (e.code !== "ENOENT") console.error("PKM load-context: error reading _index.md:", e.message);
  }

  try {
    const devlogContent = await fs.readFile(
      path.join(projectDir, "development", "devlog.md"), "utf-8"
    );
    const sectionLevel = /^## Sessions\s*$/m.test(devlogContent) ? 3 : 2;
    const tailSections = extractTailSections(devlogContent, 3, sectionLevel);
    sections.push(`### Recent Development Activity\n${tailSections}`);
  } catch (e) {
    if (e.code !== "ENOENT") console.error("PKM load-context: error reading devlog:", e.message);
  }

  const tasks = [];
  try {
    const taskDir = path.join(projectDir, "tasks");
    const entries = await fs.readdir(taskDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const content = await fs.readFile(path.join(taskDir, entry), "utf-8");
      const fm = extractFrontmatter(content);
      if (!fm || (fm.status !== "active" && fm.status !== "pending")) continue;

      const bodyStart = content.indexOf("\n---", 3);
      const body = bodyStart !== -1 ? content.slice(bodyStart + 4).trim() : content;
      const lines = body.split("\n");
      const titleLine = lines.find(l => l.startsWith("# "));
      const title = titleLine ? titleLine.slice(2).trim() : entry.replace(".md", "");
      const descLines = lines
        .filter(l => l.trim() && !l.startsWith("#"))
        .slice(0, 2)
        .map(l => `  ${l.trim()}`)
        .join("\n");

      tasks.push(`- ${title} (status: ${fm.status}, priority: ${fm.priority || "normal"})\n${descLines}`);
    }
  } catch (e) {
    if (e.code !== "ENOENT") console.error("PKM load-context: error reading tasks:", e.message);
  }

  if (tasks.length > 0) {
    sections.push(`### Active Tasks\n${tasks.join("\n")}`);
  } else {
    sections.push("### Active Tasks\nNo active tasks");
  }

  return sections.join("\n\n");
}
