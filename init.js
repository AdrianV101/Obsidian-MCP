import os from "os";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFileCb);

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
  { name: "00-Inbox", title: "Inbox", desc: "Quick captures and unsorted notes" },
  { name: "01-Projects", title: "Projects", desc: "Active project folders" },
  { name: "02-Areas", title: "Areas", desc: "Ongoing areas of responsibility" },
  { name: "03-Resources", title: "Resources", desc: "Reference material and reusable knowledge" },
  { name: "04-Archive", title: "Archive", desc: "Completed or inactive items" },
  { name: "05-Templates", title: "Templates", desc: "Note templates" },
  { name: "06-System", title: "System", desc: "System configuration and metadata" },
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
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
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
    : (await fs.readdir(src)).filter(f => f.endsWith(".md"));

  let created = 0, skipped = 0;

  for (const file of files) {
    const destFile = path.join(dest, file);
    try {
      await fs.access(destFile);
      skipped++;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
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
 * Build argument array for `claude mcp add` command.
 * @param {{ vaultPath: string, openaiKey: string|null, installType: { command: string, args: string[] } }} opts
 * @returns {string[]}
 */
export function buildMcpAddArgs({ vaultPath, openaiKey, installType }) {
  const args = ["mcp", "add", "-s", "user"];
  args.push("-e", `VAULT_PATH=${vaultPath}`);
  if (openaiKey) {
    args.push("-e", `OPENAI_API_KEY=${openaiKey}`);
  }
  args.push("--", "obsidian-pkm", installType.command, ...installType.args);
  return args;
}

/**
 * Check if the `claude` CLI is available on PATH.
 * @returns {Promise<boolean>}
 */
export async function checkClaudeCli() {
  try {
    await execFileAsync("claude", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if obsidian-pkm is already registered in Claude Code.
 * @returns {Promise<boolean>}
 */
export async function checkExistingRegistration() {
  try {
    await execFileAsync("claude", ["mcp", "get", "obsidian-pkm"]);
    return true;
  } catch {
    return false;
  }
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

/**
 * Detect whether running from npm install or from source.
 * @param {string} [filePath] - Override path for testing (defaults to current file)
 * @returns {{ command: string, args: string[] }}
 */
export function detectInstallType(filePath) {
  const thisFile = filePath || fileURLToPath(import.meta.url);
  if (thisFile.includes("node_modules")) {
    return { command: "npx", args: ["-y", "pkm-mcp-server@latest"] };
  }
  const cliPath = path.join(path.dirname(thisFile), "cli.js");
  return { command: "node", args: [cliPath] };
}

/**
 * Replace the MCP_CONFIG= line in a shell script with a pre-baked JSON config.
 * @param {string} scriptContent - Shell script content
 * @param {{ command: string, args: string[] }} installType - Server command
 * @returns {string} Patched script content
 */
export function patchMcpConfig(scriptContent, installType) {
  const argsJson = JSON.stringify(installType.args);
  const replacement = `MCP_CONFIG='{"mcpServers":{"obsidian-pkm":{"command":"${installType.command}","args":${argsJson},"env":{"VAULT_PATH":"'"$VAULT_PATH"'"}}}}'`;
  const lines = scriptContent.split("\n");
  const patched = lines.map(line => line.startsWith("MCP_CONFIG=") ? replacement : line);
  return patched.join("\n");
}

const PKM_HOOK_BASENAMES = new Set(["session-start.js", "stop-sweep.sh", "capture-handler.sh"]);

/**
 * Detect if a hook entry is a PKM hook (by path substring or script basename).
 * @param {object} entry - A hook event entry with `hooks` array
 * @returns {boolean}
 */
export function isPkmHookEntry(entry) {
  if (!entry.hooks || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some(h => {
    const cmd = h.command || "";
    if (cmd.includes("hooks/pkm/")) return true;
    for (const basename of PKM_HOOK_BASENAMES) {
      if (cmd.includes(basename)) return true;
    }
    return false;
  });
}

/**
 * Build settings.json hook config entries for enabled hooks.
 * @param {string} vaultPath - Absolute vault path
 * @param {string} hooksDir - Absolute path to installed hooks directory
 * @param {{ sessionStart: boolean, stopSweep: boolean, captureHandler: boolean }} enabledHooks
 * @returns {Object} Hook entries keyed by event name (SessionStart, Stop, PostToolUse)
 */
export function buildHookEntries(vaultPath, hooksDir, enabledHooks) {
  const entries = {};

  if (enabledHooks.sessionStart) {
    entries.SessionStart = [{
      matcher: "startup|clear|compact",
      hooks: [{
        type: "command",
        command: `VAULT_PATH="${vaultPath}" node ${path.join(hooksDir, "session-start.js")}`,
        timeout: 15,
        statusMessage: "Loading PKM project context...",
      }],
    }];
  }

  if (enabledHooks.stopSweep) {
    entries.Stop = [{
      hooks: [{
        type: "command",
        command: `VAULT_PATH="${vaultPath}" ${path.join(hooksDir, "stop-sweep.sh")}`,
        async: true,
        timeout: 10,
      }],
    }];
  }

  if (enabledHooks.captureHandler) {
    entries.PostToolUse = [{
      matcher: "mcp__obsidian-pkm__vault_capture",
      hooks: [{
        type: "command",
        command: `VAULT_PATH="${vaultPath}" ${path.join(hooksDir, "capture-handler.sh")}`,
        async: true,
        timeout: 10,
      }],
    }];
  }

  return entries;
}

const SYSTEM_DIRS = new Set(["/", "/home", "/usr", "/var", "/etc", "/tmp", "/opt", "/bin", "/sbin"]);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Interactive setup wizard for the PKM MCP server.
 */
export async function runInit() {
  const { confirm: confirmPrompt, input, select, password } = await import("@inquirer/prompts");

  const bundledTemplatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "templates");
  const steps = [];

  try {
    // ── Step 1: Welcome ──
    console.log(`
pkm-mcp-server setup wizard

This will walk you through setting up your Obsidian vault for use with the
PKM MCP server. You'll be asked about 5 things:

  1. Where your vault is (or where to create one)
  2. Whether to install note templates
  3. Whether to set up the recommended folder structure
  4. An optional OpenAI API key for semantic search
  5. Registering the server with Claude Code

Nothing is written until you confirm each step. Press Ctrl+C at any time to cancel.
`);

    // ── Step 2: Vault Path ──
    const hasVault = await confirmPrompt({
      message: "Do you have an existing Obsidian vault?",
      default: false,
    });

    const defaultPath = hasVault
      ? ""
      : path.join(os.homedir(), "Documents", "PKM");

    const rawPath = await input({
      message: hasVault
        ? "Path to your vault:"
        : "Where should we create your vault?",
      default: defaultPath || undefined,
      validate: (val) => (val.trim() ? true : "Please enter a path."),
    });

    const vaultPath = await resolveVaultPath(resolveInputPath(rawPath.trim()), hasVault);

    // ── Step 3: Templates ──
    const templateMode = await select({
      message: "Install note templates? These are used by the vault_write tool to create structured notes with proper frontmatter.",
      choices: [
        { name: "Full set (13 templates — ADR, devlog, research, task, etc.)", value: "full" },
        { name: "Minimal (just note.md — a single generic template)", value: "minimal" },
        { name: "Skip (I have my own templates)", value: "skip" },
      ],
    });

    const templateDest = path.join(vaultPath, "05-Templates");
    const templateResult = await copyTemplates(bundledTemplatesDir, templateDest, templateMode);
    if (templateMode !== "skip") {
      console.log(`  Templates: ${templateResult.created} installed, ${templateResult.skipped} already existed`);
      steps.push(`Templates: ${templateResult.created} installed (${templateMode} set)`);
    } else {
      console.log("  Note: vault_write requires at least one template in 05-Templates/ to function. All other tools work without templates.");
      steps.push("Templates: skipped");
    }

    // ── Step 4: Folders ──
    console.log("\nPARA folder structure to create:");
    for (const folder of PARA_FOLDERS) {
      const suffix = (folder.name === "05-Templates" && templateMode !== "skip")
        ? " (already set up)"
        : "";
      const padded = (folder.name + "/").padEnd(19);
      console.log(`  ${padded} — ${folder.desc}${suffix}`);
    }

    const doFolders = await confirmPrompt({
      message: "Create PARA folder structure?",
      default: true,
    });

    let folderResult = null;
    if (doFolders) {
      folderResult = await scaffoldFolders(vaultPath);
      console.log(`  Folders: ${folderResult.created} created, ${folderResult.skipped} already existed`);
      steps.push(`Folders: ${folderResult.created} created`);
    } else {
      console.log("  Folders: skipped");
      steps.push("Folders: skipped");
    }

    // ── Step 5: OpenAI API Key ──
    let openaiKey = null;
    const wantSemantic = await confirmPrompt({ message: "Enable semantic search? (Requires an OpenAI API key)" });
    if (wantSemantic) {
      console.log(`
  Get an API key at: https://platform.openai.com/api-keys

  This key is stored only in your Claude Code configuration
  (~/.claude.json) and is never sent to us or anyone else.
  It's used solely for generating text embeddings via OpenAI's API.
`);
      openaiKey = await password({ message: "OpenAI API key (Enter to skip):", mask: "*" });
      if (!openaiKey) { openaiKey = null; console.log("  Skipped.\n"); }
    } else {
      console.log("  You can add this later by setting OPENAI_API_KEY in your Claude Code settings.\n");
    }
    // ── Step 6: Registration ──
    const hasClaude = await checkClaudeCli();
    if (!hasClaude) {
      const installType = detectInstallType();
      const manualCmd = `claude mcp add -s user -e VAULT_PATH=${vaultPath} -- obsidian-pkm ${installType.command} ${installType.args.join(" ")}`;
      console.log(`
  Claude Code CLI not found on PATH. To register manually, run:

    ${manualCmd}
`);
      steps.push("MCP server: skipped (Claude CLI not found)");
    } else {
      const installType = detectInstallType();
      const hasExisting = await checkExistingRegistration();

      let skipRegistration = false;
      if (hasExisting) {
        const overwrite = await confirmPrompt({ message: "Claude Code is already configured for pkm-mcp-server. Overwrite?", default: false });
        if (!overwrite) {
          console.log("  Registration skipped.\n");
          skipRegistration = true;
        } else {
          // Remove existing before re-adding
          try {
            await execFileAsync("claude", ["mcp", "remove", "obsidian-pkm"]);
          } catch (e) {
            console.warn(`  Warning: could not remove existing registration: ${e.message}`);
          }
        }
      }

      if (!skipRegistration) {
        const addArgs = buildMcpAddArgs({ vaultPath, openaiKey, installType });
        const displayCmd = `claude ${addArgs.join(" ")}`;
        console.log(`\nWill run:\n\n  ${displayCmd}\n`);

        const doRegister = await confirmPrompt({
          message: "Register MCP server with Claude Code?",
          default: true,
        });

        if (doRegister) {
          try {
            await execFileAsync("claude", addArgs);
            console.log("  MCP server registered with Claude Code");
            steps.push("MCP server: registered");
          } catch (regErr) {
            console.error(`\n  Registration failed: ${regErr.message}`);
            if (regErr.stderr) console.error(`  ${regErr.stderr.trim()}`);
            const skipReg = await confirmPrompt({ message: "Skip registration and finish setup?", default: true });
            if (!skipReg) throw regErr;
            console.log("  Registration skipped.\n");
            steps.push("MCP server: skipped (registration failed)");
          }
        } else {
          console.log("  Registration: skipped (you can run `pkm-mcp-server init` again later)");
          steps.push("MCP server: skipped");
        }
      } else {
        steps.push("MCP server: skipped");
      }
    }

    // ── Step 7: Summary ──
    // Build summary lines based on what was actually done
    const templateSummary = templateMode === "skip"
      ? "Skipped"
      : `${templateResult.created} installed in 05-Templates/`;
    const folderSummary = folderResult
      ? `${folderResult.created} created`
      : "Skipped";
    const semanticSummary = openaiKey
      ? "Enabled (API key configured)"
      : "Disabled (no API key)";
    // Determine registration summary from steps
    const regStep = steps.find(s => s.startsWith("MCP server:"));
    const registrationSummary = regStep && regStep.includes("registered")
      ? "Registered with Claude Code"
      : "Skipped";

    console.log(`
Setup complete!

  Vault:       ${vaultPath}
  Templates:   ${templateSummary}
  Folders:     ${folderSummary}
  Semantic:    ${semanticSummary}
  Claude Code: ${registrationSummary}

To verify, restart Claude Code and try:
  "List the folders in my vault"

Claude should call vault_list and show your vault's directory structure.
If that doesn't work, check: https://github.com/AdrianV101/Obsidian-MCP#troubleshooting
`);
  } catch (e) {
    if (e.name === "ExitPromptError") {
      console.log("\nSetup cancelled.");
      return;
    }
    console.error(`\nError: ${e.message}`);
    process.exit(1);
  }

  // ── Inner function: resolveVaultPath ──
  async function resolveVaultPath(resolved, hasVault) {
    console.log(`\n  Resolved path: ${resolved}\n`);

    // System directory safety check
    if (SYSTEM_DIRS.has(resolved) || resolved === os.homedir()) {
      console.log(`\n  "${resolved}" is a system directory. Using it directly as a vault could be dangerous.`);
      const newRaw = await input({
        message: "Please enter a different path:",
        validate: (val) => (val.trim() ? true : "Please enter a path."),
      });
      return resolveVaultPath(resolveInputPath(newRaw.trim()), hasVault);
    }

    // Check what exists at the path
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch (e) {
      if (e.code === "ENOENT") {
        const create = await confirmPrompt({ message: `This directory doesn't exist. Create ${resolved}?` });
        if (!create) { console.log("Setup cancelled."); process.exit(0); }
        await fs.mkdir(resolved, { recursive: true });
        console.log(`  Created ${resolved}`);
        steps.push(`Vault: created ${resolved}`);
        return resolved;
      }
      throw e;
    }

    // Path is a file, not a directory
    if (!stat.isDirectory()) {
      console.log(`\n  "${resolved}" is a file, not a directory.`);
      const newRaw = await input({
        message: "Please enter a directory path:",
        validate: (val) => (val.trim() ? true : "Please enter a path."),
      });
      return resolveVaultPath(resolveInputPath(newRaw.trim()), hasVault);
    }

    // Directory exists — check if empty
    const entries = await fs.readdir(resolved);
    if (entries.length === 0) {
      const useEmpty = await confirmPrompt({ message: `Use ${resolved} as your vault?` });
      if (!useEmpty) { console.log("Setup cancelled."); process.exit(0); }
      console.log(`  Using empty directory ${resolved}`);
      steps.push(`Vault: using ${resolved}`);
      return resolved;
    }

    // Non-empty directory
    if (hasVault) {
      // User said they have a vault — confirm then offer backup
      console.log(`  Using existing vault ${resolved}`);
      await offerBackup(resolved);
      steps.push(`Vault: using existing ${resolved}`);
      return resolved;
    }

    // Non-empty dir, user said no vault — need to decide
    const dirAction = await select({
      message: `"${resolved}" is not empty. What should we do?`,
      choices: [
        { name: "Use it as-is (add PKM structure alongside existing files)", value: "use" },
        { name: "Create a subfolder inside it", value: "subfolder" },
        { name: "Wipe it and start fresh (DESTRUCTIVE)", value: "wipe" },
      ],
    });

    if (dirAction === "use") {
      // Offer backup
      await offerBackup(resolved);
      console.log(`  Using ${resolved}`);
      steps.push(`Vault: using ${resolved}`);
      return resolved;
    }

    if (dirAction === "subfolder") {
      const subName = await input({ message: "Subfolder name:", default: "PKM" });
      const subPath = path.join(resolved, subName);
      if (!subPath.startsWith(resolved + path.sep) && subPath !== resolved) {
        console.log("  Subfolder name must not contain path separators or navigation (..).\n");
        return resolveVaultPath(resolved, hasVault);
      }
      await fs.mkdir(subPath, { recursive: true });
      console.log(`  Created ${subPath}`);
      steps.push(`Vault: created ${subPath}`);
      return subPath;
    }

    // Wipe — triple confirmation
    const bname = path.basename(resolved);
    console.log(`\n  This will permanently delete ALL contents of ${resolved}`);

    const wipeConfirm1 = await confirmPrompt({
      message: "Are you sure you want to wipe this directory?",
      default: false,
    });
    if (!wipeConfirm1) {
      return resolveVaultPath(resolved, true); // re-evaluate as existing vault
    }

    await offerBackup(resolved);

    const typedName = await input({
      message: `Type "${bname}" to confirm:`,
    });
    if (typedName !== bname) {
      console.log("  Names did not match. Wipe cancelled.");
      return resolveVaultPath(resolved, true);
    }

    // Third confirmation before wipe
    const c3 = await confirmPrompt({ message: `Last chance. Delete all contents of ${resolved}?` });
    if (!c3) { console.log("Wipe cancelled."); process.exit(0); }

    // Do the wipe
    const wipeEntries = await fs.readdir(resolved);
    for (const entry of wipeEntries) {
      await fs.rm(path.join(resolved, entry), { recursive: true, force: true });
    }
    console.log(`  Wiped and using ${resolved}`);
    steps.push(`Vault: wiped and using ${resolved}`);
    return resolved;
  }

  async function offerBackup(dirPath) {
    const size = await dirSize(dirPath);
    const sizeStr = formatBytes(size);
    const sizeWarning = size > 500 * 1024 * 1024
      ? ` (${sizeStr} — this may take a while)`
      : ` (${sizeStr})`;

    const doBackup = await confirmPrompt({
      message: `Back up ${dirPath} first?${sizeWarning}`,
      default: true,
    });

    if (doBackup) {
      try {
        const backupPath = await backupVault(dirPath);
        console.log(`  Backup created: ${backupPath}\n`);
        steps.push(`Backup: ${backupPath}`);
      } catch (e) {
        console.error(`Backup failed: ${e.message}. Aborting to keep your data safe.`);
        process.exit(1);
      }
    }
  }
}
