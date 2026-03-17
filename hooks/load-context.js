import fs from "fs/promises";
import path from "path";
import { extractFrontmatter } from "../utils.js";
import { extractTailSections } from "../helpers.js";

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
    const tailSections = extractTailSections(devlogContent, 3, 2);
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
