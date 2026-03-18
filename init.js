import os from "os";
import path from "path";
import fs from "fs/promises";

/**
 * Resolve user-provided path input: expand ~, $HOME, resolve relative, normalise.
 */
export function resolveInputPath(raw) {
  let p = raw;

  // Expand ~ at start
  if (p === "~") {
    p = os.homedir();
  } else if (p.startsWith("~/")) {
    p = path.join(os.homedir(), p.slice(2));
  }

  // Expand $HOME and ${HOME}
  p = p.replace(/\$\{HOME\}/g, os.homedir());
  p = p.replace(/\$HOME/g, os.homedir());

  // Resolve to absolute
  p = path.resolve(p);

  // Normalise (path.resolve already handles double slashes and trailing slashes)
  // But strip any remaining trailing slash (path.resolve keeps root /)
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }

  return p;
}

const PARA_FOLDERS = [
  { name: "00-Inbox", title: "Inbox", desc: "Quick captures and unsorted notes." },
  { name: "01-Projects", title: "Projects", desc: "Active project folders." },
  { name: "02-Areas", title: "Areas", desc: "Ongoing areas of responsibility." },
  { name: "03-Resources", title: "Resources", desc: "Reference material and reusable knowledge." },
  { name: "04-Archive", title: "Archive", desc: "Completed or inactive items." },
  { name: "05-Templates", title: "Templates", desc: "Note templates for vault_write." },
  { name: "06-System", title: "System", desc: "System configuration and metadata." },
];

function makeIndexStub(title, desc) {
  const today = new Date().toISOString().split("T")[0];
  return `---\ntype: moc\ncreated: ${today}\ntags:\n  - index\n---\n\n# ${title}\n\n${desc}\n`;
}

/**
 * Create PARA folder structure with _index.md stubs.
 * @param {string} vaultPath
 * @returns {Promise<{created: number, skipped: number}>}
 */
export async function scaffoldFolders(vaultPath) {
  let created = 0, skipped = 0;

  for (const folder of PARA_FOLDERS) {
    const dirPath = path.join(vaultPath, folder.name);
    await fs.mkdir(dirPath, { recursive: true });

    const indexPath = path.join(dirPath, "_index.md");
    try {
      await fs.access(indexPath);
      skipped++;
    } catch {
      await fs.writeFile(indexPath, makeIndexStub(folder.title, folder.desc));
      created++;
    }
  }

  return { created, skipped };
}

/**
 * Copy templates from src to dest directory.
 * @param {string} src - Source templates directory (bundled)
 * @param {string} dest - Destination 05-Templates/ directory in vault
 * @param {"full"|"minimal"|"skip"} mode
 * @returns {Promise<{created: number, skipped: number}>}
 */
export async function copyTemplates(src, dest, mode) {
  if (mode === "skip") return { created: 0, skipped: 0 };

  await fs.mkdir(dest, { recursive: true });

  const files = mode === "minimal"
    ? ["note.md"]
    : await fs.readdir(src);

  let created = 0, skipped = 0;

  for (const file of files) {
    const destFile = path.join(dest, file);
    try {
      await fs.access(destFile);
      skipped++;
    } catch {
      await fs.copyFile(path.join(src, file), destFile);
      created++;
    }
  }

  return { created, skipped };
}

/**
 * Back up a vault directory to a timestamped sibling directory.
 * @param {string} vaultPath
 * @returns {Promise<string>} Path to the backup directory.
 */
export async function backupVault(vaultPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = `${vaultPath}-backup-${timestamp}`;
  await fs.cp(vaultPath, backupPath, { recursive: true });
  return backupPath;
}

/**
 * Calculate total size of a directory (in bytes). Skips symlinks.
 * @param {string} dirPath
 * @returns {Promise<number>}
 */
export async function dirSize(dirPath) {
  let total = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(fullPath);
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath);
      total += stat.size;
    }
  }
  return total;
}
