import fs from "fs/promises";
import path from "path";
import { resolvePath } from "../helpers.js";

export async function resolveProject(cwd, vaultPath) {
  try {
    await fs.access(vaultPath);
  } catch (e) {
    if (e.code === "ENOENT") {
      return { error: `VAULT_PATH does not exist: ${vaultPath}` };
    }
    return { error: `Cannot access VAULT_PATH (${e.code}): ${vaultPath}` };
  }

  const projectsDir = path.join(vaultPath, "01-Projects");
  const cwdBasename = path.basename(cwd).toLowerCase();

  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.toLowerCase() === cwdBasename) {
        return { projectPath: `01-Projects/${entry.name}` };
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT") {
      return { error: `Error reading 01-Projects/: ${e.message}` };
    }
    // 01-Projects/ doesn't exist -- fall through to CLAUDE.md check
  }

  try {
    const claudeMd = await fs.readFile(path.join(cwd, "CLAUDE.md"), "utf-8");
    const match = claudeMd.match(/^#\s+PKM:\s*(.+)$/m);
    if (match) {
      const annotatedPath = match[1].trim();
      try {
        resolvePath(annotatedPath, vaultPath);
      } catch (e) {
        if (e.message === "Path escapes vault directory") {
          return { error: `CLAUDE.md annotation escapes vault directory: ${annotatedPath}` };
        }
        throw e;
      }
      try {
        await fs.access(path.join(vaultPath, annotatedPath));
        return { projectPath: annotatedPath };
      } catch (e) {
        if (e.code === "ENOENT") {
          return { error: `CLAUDE.md annotation points to non-existent vault path: ${annotatedPath}` };
        }
        return { error: `Cannot access annotated vault path (${e.code}): ${annotatedPath}` };
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT" && e.code !== "EACCES") {
      return { error: `Error reading CLAUDE.md: ${e.message}` };
    }
    // No CLAUDE.md or not readable -- fall through
  }

  return {
    error: `No vault project found for "${path.basename(cwd)}". ` +
      `To fix: ensure your project folder name matches the repo name in 01-Projects/, ` +
      `or add "# PKM: 01-Projects/YourProject" to your project's CLAUDE.md.`
  };
}
