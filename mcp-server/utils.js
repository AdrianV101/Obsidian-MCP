import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";

/** Extract YAML frontmatter from markdown content. */
export function extractFrontmatter(content) {
  if (!content.startsWith("---")) return null;
  const endIndex = content.indexOf("---", 3);
  if (endIndex === -1) return null;
  const yamlContent = content.slice(3, endIndex).trim();
  try {
    return yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA });
  } catch {
    return null;
  }
}

/** Recursively get all markdown files in a directory (skips dotfiles/dirs). */
export async function getAllMarkdownFiles(dir, baseDir = dir) {
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
