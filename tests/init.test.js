import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { resolveInputPath, copyTemplates, scaffoldFolders, backupVault, dirSize, buildMcpAddArgs, detectInstallType, patchMcpConfig, isPkmHookEntry, buildHookEntries, mergeHooksIntoSettings, copyHooks } from "../init.js";

describe("resolveInputPath", () => {
  it("expands ~ to home directory", () => {
    assert.equal(resolveInputPath("~/Documents/PKM"), path.join(os.homedir(), "Documents/PKM"));
  });

  it("expands lone ~", () => {
    assert.equal(resolveInputPath("~"), os.homedir());
  });

  it("expands $HOME", () => {
    assert.equal(resolveInputPath("$HOME/vault"), path.join(os.homedir(), "vault"));
  });

  it("expands ${HOME}", () => {
    assert.equal(resolveInputPath("${HOME}/vault"), path.join(os.homedir(), "vault"));
  });

  it("resolves relative paths to absolute", () => {
    const result = resolveInputPath("my/vault");
    assert.ok(path.isAbsolute(result));
    assert.ok(result.endsWith("my/vault"));
  });

  it("strips trailing slashes", () => {
    const result = resolveInputPath("/tmp/vault/");
    assert.equal(result, "/tmp/vault");
  });

  it("normalises double slashes", () => {
    const result = resolveInputPath("/tmp//vault///notes");
    assert.equal(result, "/tmp/vault/notes");
  });

  it("handles absolute paths unchanged (except normalisation)", () => {
    assert.equal(resolveInputPath("/tmp/vault"), "/tmp/vault");
  });

  it("expands multiple $HOME occurrences", () => {
    const home = os.homedir();
    const result = resolveInputPath("$HOME/projects/$HOME-backup");
    assert.equal(result, path.resolve(`${home}/projects/${home}-backup`));
  });
});

describe("copyTemplates", () => {
  let tmpDir, srcDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-test-"));
    srcDir = path.join(tmpDir, "src-templates");
    await fs.mkdir(srcDir);
    await fs.writeFile(path.join(srcDir, "adr.md"), "# ADR");
    await fs.writeFile(path.join(srcDir, "task.md"), "# Task");
    await fs.writeFile(path.join(srcDir, "note.md"), "# Note");
  });

  it("copies all templates in full mode", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    const result = await copyTemplates(srcDir, dest, "full");
    assert.equal(result.created, 3);
    assert.equal(result.skipped, 0);
    const files = await fs.readdir(dest);
    assert.equal(files.length, 3);
  });

  it("copies only note.md in minimal mode", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    const result = await copyTemplates(srcDir, dest, "minimal");
    assert.equal(result.created, 1);
    assert.equal(result.skipped, 0);
    const files = await fs.readdir(dest);
    assert.deepEqual(files, ["note.md"]);
  });

  it("returns zeros in skip mode", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    const result = await copyTemplates(srcDir, dest, "skip");
    assert.equal(result.created, 0);
    assert.equal(result.skipped, 0);
    await assert.rejects(fs.access(dest), { code: "ENOENT" });
  });

  it("skips files that already exist without overwriting", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, "adr.md"), "# Existing ADR");
    const result = await copyTemplates(srcDir, dest, "full");
    assert.equal(result.created, 2);
    assert.equal(result.skipped, 1);
    const content = await fs.readFile(path.join(dest, "adr.md"), "utf8");
    assert.equal(content, "# Existing ADR");
  });

  it("creates destination directory if it doesn't exist", async () => {
    const dest = path.join(tmpDir, "deep", "nested", "05-Templates");
    const result = await copyTemplates(srcDir, dest, "full");
    assert.equal(result.created, 3);
  });

  it("throws if source directory does not exist", async () => {
    const dest = path.join(tmpDir, "vault", "05-Templates");
    await assert.rejects(
      copyTemplates("/nonexistent/templates", dest, "full"),
      (err) => err.code === "ENOENT"
    );
  });

  it("full mode ignores non-.md files in source directory", async () => {
    await fs.writeFile(path.join(srcDir, ".DS_Store"), "junk");
    const dest = path.join(tmpDir, "vault", "05-Templates");
    const result = await copyTemplates(srcDir, dest, "full");
    assert.equal(result.created, 3); // only the 3 .md files
    const files = await fs.readdir(dest);
    assert.ok(!files.includes(".DS_Store"));
  });
});

describe("scaffoldFolders", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-scaffold-"));
  });

  it("creates all 7 PARA folders with _index.md stubs", async () => {
    const result = await scaffoldFolders(tmpDir);
    assert.equal(result.created, 7);
    assert.equal(result.skipped, 0);
    const dirs = await fs.readdir(tmpDir);
    assert.ok(dirs.includes("00-Inbox"));
    assert.ok(dirs.includes("06-System"));
    // Check _index.md has frontmatter
    const content = await fs.readFile(path.join(tmpDir, "00-Inbox", "_index.md"), "utf8");
    assert.ok(content.includes("type: moc"));
    assert.ok(content.includes("tags:"));
    assert.ok(content.includes("# Inbox"));
  });

  it("creates _index.md in existing folders that lack one", async () => {
    await fs.mkdir(path.join(tmpDir, "00-Inbox"), { recursive: true });
    const result = await scaffoldFolders(tmpDir);
    // created/skipped counts _index.md files only (folders are created idempotently via mkdir recursive)
    assert.equal(result.created, 7);
    assert.equal(result.skipped, 0);
    const indexContent = await fs.readFile(path.join(tmpDir, "00-Inbox", "_index.md"), "utf8");
    assert.ok(indexContent.includes("type: moc"));
  });

  it("skips existing _index.md files without overwriting", async () => {
    await fs.mkdir(path.join(tmpDir, "00-Inbox"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "00-Inbox", "_index.md"), "# My custom index");
    const result = await scaffoldFolders(tmpDir);
    assert.ok(result.skipped >= 1);
    const content = await fs.readFile(path.join(tmpDir, "00-Inbox", "_index.md"), "utf8");
    assert.equal(content, "# My custom index");
  });

  it("creates correct title and description per folder", async () => {
    await scaffoldFolders(tmpDir);
    const systemContent = await fs.readFile(path.join(tmpDir, "06-System", "_index.md"), "utf8");
    assert.ok(systemContent.includes("# System"));
    assert.ok(systemContent.includes("System configuration and metadata"));
  });
});

describe("backupVault", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-backup-"));
    await fs.writeFile(path.join(tmpDir, "note.md"), "# Hello");
    await fs.mkdir(path.join(tmpDir, "subdir"));
    await fs.writeFile(path.join(tmpDir, "subdir", "deep.md"), "# Deep");
  });

  it("copies vault to timestamped backup directory", async () => {
    const backupPath = await backupVault(tmpDir);
    assert.ok(backupPath.includes("-backup-"));
    const content = await fs.readFile(path.join(backupPath, "note.md"), "utf8");
    assert.equal(content, "# Hello");
    const deepContent = await fs.readFile(path.join(backupPath, "subdir", "deep.md"), "utf8");
    assert.equal(deepContent, "# Deep");
  });

  it("does not modify the original vault", async () => {
    await backupVault(tmpDir);
    const content = await fs.readFile(path.join(tmpDir, "note.md"), "utf8");
    assert.equal(content, "# Hello");
  });

  it("throws if source does not exist", async () => {
    await assert.rejects(
      backupVault("/nonexistent/path/vault"),
      (err) => err.code === "ENOENT" || err.message.includes("ENOENT")
    );
  });
});

describe("dirSize", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-dirsize-"));
  });

  it("sums file sizes in a directory", async () => {
    await fs.writeFile(path.join(tmpDir, "a.txt"), "hello"); // 5 bytes
    await fs.writeFile(path.join(tmpDir, "b.txt"), "world!"); // 6 bytes
    const size = await dirSize(tmpDir);
    assert.equal(size, 11);
  });

  it("recurses into subdirectories", async () => {
    await fs.mkdir(path.join(tmpDir, "sub"));
    await fs.writeFile(path.join(tmpDir, "a.txt"), "hi"); // 2 bytes
    await fs.writeFile(path.join(tmpDir, "sub", "b.txt"), "hey"); // 3 bytes
    const size = await dirSize(tmpDir);
    assert.equal(size, 5);
  });

  it("returns 0 for empty directory", async () => {
    const size = await dirSize(tmpDir);
    assert.equal(size, 0);
  });

  it("skips symlinks", async () => {
    await fs.writeFile(path.join(tmpDir, "real.txt"), "data"); // 4 bytes
    await fs.symlink(path.join(tmpDir, "real.txt"), path.join(tmpDir, "link.txt"));
    const size = await dirSize(tmpDir);
    assert.equal(size, 4);
  });
});

describe("buildMcpAddArgs", () => {
  it("builds correct args for npm install with vault path only", () => {
    const args = buildMcpAddArgs({
      vaultPath: "/home/user/Documents/PKM",
      openaiKey: null,
      installType: { command: "npx", args: ["-y", "pkm-mcp-server@latest"] },
    });
    assert.deepEqual(args, [
      "mcp", "add", "-s", "user",
      "-e", "VAULT_PATH=/home/user/Documents/PKM",
      "--", "obsidian-pkm", "npx", "-y", "pkm-mcp-server@latest",
    ]);
  });

  it("includes OPENAI_API_KEY when provided", () => {
    const args = buildMcpAddArgs({
      vaultPath: "/vault",
      openaiKey: "sk-test-key",
      installType: { command: "npx", args: ["-y", "pkm-mcp-server@latest"] },
    });
    assert.ok(args.includes("-e"));
    const keyIdx = args.indexOf("OPENAI_API_KEY=sk-test-key");
    assert.ok(keyIdx > 0);
    assert.equal(args[keyIdx - 1], "-e");
  });

  it("builds correct args for source install", () => {
    const args = buildMcpAddArgs({
      vaultPath: "/vault",
      openaiKey: null,
      installType: { command: "node", args: ["/home/user/Projects/Obsidian-MCP/cli.js"] },
    });
    assert.deepEqual(args, [
      "mcp", "add", "-s", "user",
      "-e", "VAULT_PATH=/vault",
      "--", "obsidian-pkm", "node", "/home/user/Projects/Obsidian-MCP/cli.js",
    ]);
  });

  it("places all flags before server name", () => {
    const args = buildMcpAddArgs({
      vaultPath: "/vault",
      openaiKey: "sk-key",
      installType: { command: "npx", args: ["-y", "pkm-mcp-server@latest"] },
    });
    const nameIdx = args.indexOf("obsidian-pkm");
    const flagIndices = args
      .map((a, i) => (a === "-s" || a === "-e") ? i : -1)
      .filter(i => i >= 0);
    for (const fi of flagIndices) {
      assert.ok(fi < nameIdx, `flag at index ${fi} should be before server name at ${nameIdx}`);
    }
  });

  it("places -- separator before server name to terminate variadic -e", () => {
    const args = buildMcpAddArgs({
      vaultPath: "/vault",
      openaiKey: null,
      installType: { command: "npx", args: ["-y", "pkm-mcp-server@latest"] },
    });
    const nameIdx = args.indexOf("obsidian-pkm");
    const dashIdx = args.indexOf("--");
    assert.ok(dashIdx < nameIdx);
    assert.equal(dashIdx, nameIdx - 1);
  });
});

describe("detectInstallType", () => {
  it("returns npx for a path inside node_modules", () => {
    const result = detectInstallType("/usr/lib/node_modules/pkm-mcp-server/init.js");
    assert.equal(result.command, "npx");
    assert.deepEqual(result.args, ["-y", "obsidian-pkm@latest"]);
  });

  it("returns node with absolute cli.js path for a source install", () => {
    const result = detectInstallType("/home/user/Projects/Obsidian-MCP/init.js");
    assert.equal(result.command, "node");
    assert.ok(result.args[0].endsWith("cli.js"));
    assert.ok(path.isAbsolute(result.args[0]));
  });
});

describe("patchMcpConfig", () => {
  const sampleScript = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)',
    'MCP_CONFIG=$(node -e "console.log(JSON.stringify({mcpServers:{\'obsidian-pkm\':{command:\'node\',args:[process.argv[1]],env:{VAULT_PATH:process.argv[2]}}}}))" "$SCRIPT_DIR/../index.js" "${VAULT_PATH:-$HOME/Documents/PKM}")',
    'echo "$MCP_CONFIG"',
  ].join("\n");

  it("replaces MCP_CONFIG line for npx install", () => {
    const installType = { command: "npx", args: ["-y", "pkm-mcp-server@latest"] };
    const result = patchMcpConfig(sampleScript, installType);
    assert.ok(!result.includes('$(node -e'));
    assert.ok(result.includes('"command":"npx"'));
    assert.ok(result.includes('"args":["-y","pkm-mcp-server@latest"]'));
    // Verify exact shell quoting: '..."VAULT_PATH":"'"$VAULT_PATH"'"}}}'
    // The pattern is: close single-quote, open double-quote, $VAULT_PATH, close double-quote, open single-quote
    assert.ok(result.includes(`'"$VAULT_PATH"'`), "must use correct shell quoting for $VAULT_PATH expansion");
    // Other lines preserved
    assert.ok(result.includes('#!/usr/bin/env bash'));
    assert.ok(result.includes('echo "$MCP_CONFIG"'));
  });

  it("replaces MCP_CONFIG line for source install", () => {
    const installType = { command: "node", args: ["/home/user/Projects/Obsidian-MCP/cli.js"] };
    const result = patchMcpConfig(sampleScript, installType);
    assert.ok(result.includes('"command":"node"'));
    assert.ok(result.includes("/home/user/Projects/Obsidian-MCP/cli.js"));
  });

  it("preserves lines that don't start with MCP_CONFIG=", () => {
    const result = patchMcpConfig(sampleScript, { command: "npx", args: ["-y", "pkm-mcp-server@latest"] });
    const lines = result.split("\n");
    assert.equal(lines[0], '#!/usr/bin/env bash');
    assert.equal(lines[1], 'set -euo pipefail');
    assert.equal(lines[2], 'SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)');
    assert.equal(lines[4], 'echo "$MCP_CONFIG"');
  });

  it("returns script unchanged if no MCP_CONFIG= line found", () => {
    const noConfig = "#!/bin/bash\necho hello\n";
    const result = patchMcpConfig(noConfig, { command: "npx", args: ["-y", "pkm-mcp-server@latest"] });
    assert.equal(result, noConfig);
  });

  it("replaces multi-line MCP_CONFIG=$(node -e ...) block", () => {
    const multiLineScript = [
      '#!/usr/bin/env bash',
      'SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)',
      'MCP_CONFIG=$(node -e "',
      "  const { existsSync } = require('fs');",
      "  const path = require('path');",
      "  const localIndex = path.join(process.argv[1], '..', 'index.js');",
      "  console.log(JSON.stringify({ mcpServers: { 'obsidian-pkm': server } }));",
      '" "$SCRIPT_DIR" "${VAULT_PATH:-$HOME/Documents/PKM}")',
      'echo "$MCP_CONFIG"',
    ].join("\n");
    const installType = { command: "npx", args: ["-y", "pkm-mcp-server@latest"] };
    const result = patchMcpConfig(multiLineScript, installType);
    // All node -e lines should be gone
    assert.ok(!result.includes("existsSync"), "node -e body lines must be removed");
    assert.ok(!result.includes("require('fs')"), "node -e body lines must be removed");
    assert.ok(!result.includes('$(node -e'), "command substitution must be replaced");
    // Replacement should be present
    assert.ok(result.includes('"command":"npx"'));
    assert.ok(result.includes('"args":["-y","pkm-mcp-server@latest"]'));
    // Surrounding lines preserved
    assert.ok(result.includes('#!/usr/bin/env bash'));
    assert.ok(result.includes('echo "$MCP_CONFIG"'));
    // Should have exactly 4 lines: shebang, SCRIPT_DIR, MCP_CONFIG replacement, echo
    assert.equal(result.split("\n").length, 4);
  });

  it("handles already-patched single-line MCP_CONFIG (idempotent)", () => {
    const patchedScript = [
      '#!/usr/bin/env bash',
      `MCP_CONFIG='{"mcpServers":{"obsidian-pkm":{"command":"npx","args":["-y","pkm-mcp-server@latest"],"env":{"VAULT_PATH":"'"$VAULT_PATH"'"}}}}'`,
      'echo done',
    ].join("\n");
    const installType = { command: "node", args: ["/new/path/cli.js"] };
    const result = patchMcpConfig(patchedScript, installType);
    assert.ok(result.includes('"command":"node"'));
    assert.ok(result.includes("/new/path/cli.js"));
    assert.equal(result.split("\n").length, 3);
  });
});

describe("isPkmHookEntry", () => {
  it("matches entry with hooks/pkm/ in command", () => {
    const entry = { hooks: [{ type: "command", command: 'VAULT_PATH="/vault" node /home/user/.claude/hooks/pkm/session-start.js' }] };
    assert.equal(isPkmHookEntry(entry), true);
  });

  it("matches entry with session-start.js basename", () => {
    const entry = { hooks: [{ type: "command", command: 'VAULT_PATH="/vault" node /home/user/Projects/Obsidian-MCP/hooks/session-start.js' }] };
    assert.equal(isPkmHookEntry(entry), true);
  });

  it("matches entry with stop-sweep.js basename", () => {
    const entry = { hooks: [{ type: "command", command: '/path/to/stop-sweep.js' }] };
    assert.equal(isPkmHookEntry(entry), true);
  });

  it("matches entry with capture-handler.sh basename", () => {
    const entry = { hooks: [{ type: "command", command: '/path/to/capture-handler.sh' }] };
    assert.equal(isPkmHookEntry(entry), true);
  });

  it("does not match unrelated hook entry", () => {
    const entry = { hooks: [{ type: "command", command: '/usr/local/bin/my-hook.sh' }] };
    assert.equal(isPkmHookEntry(entry), false);
  });

  it("does not match entry with no hooks array", () => {
    const entry = { matcher: "Bash" };
    assert.equal(isPkmHookEntry(entry), false);
  });

  it("does not match entry with empty hooks array", () => {
    const entry = { hooks: [] };
    assert.equal(isPkmHookEntry(entry), false);
  });
});

describe("buildHookEntries", () => {
  const vaultPath = "/home/user/Documents/PKM";
  const hooksDir = "/home/user/.claude/hooks/pkm";

  it("returns empty object when no hooks enabled", () => {
    const result = buildHookEntries(vaultPath, hooksDir, { sessionStart: false, stopSweep: false, captureHandler: false });
    assert.deepEqual(result, {});
  });

  it("builds SessionStart entry when enabled", () => {
    const result = buildHookEntries(vaultPath, hooksDir, { sessionStart: true, stopSweep: false, captureHandler: false });
    assert.ok(result.SessionStart);
    assert.equal(result.SessionStart.length, 1);
    assert.equal(result.SessionStart[0].matcher, "startup|clear|compact");
    assert.ok(result.SessionStart[0].hooks[0].command.includes("session-start.js"));
    assert.ok(result.SessionStart[0].hooks[0].command.includes(vaultPath));
    assert.equal(result.SessionStart[0].hooks[0].timeout, 15);
    assert.equal(result.SessionStart[0].hooks[0].statusMessage, "Loading PKM project context...");
  });

  it("builds Stop entry when enabled", () => {
    const result = buildHookEntries(vaultPath, hooksDir, { sessionStart: false, stopSweep: true, captureHandler: false });
    assert.ok(result.Stop);
    assert.equal(result.Stop[0].hooks[0].async, true);
    assert.ok(result.Stop[0].hooks[0].command.includes("stop-sweep.js"));
  });

  it("builds PostToolUse entry when enabled", () => {
    const result = buildHookEntries(vaultPath, hooksDir, { sessionStart: false, stopSweep: false, captureHandler: true });
    assert.ok(result.PostToolUse);
    assert.equal(result.PostToolUse[0].matcher, "mcp__obsidian-pkm__vault_capture");
    assert.ok(result.PostToolUse[0].hooks[0].command.includes("capture-handler.sh"));
    assert.equal(result.PostToolUse[0].hooks[0].async, true);
  });

  it("builds all three when all enabled", () => {
    const result = buildHookEntries(vaultPath, hooksDir, { sessionStart: true, stopSweep: true, captureHandler: true });
    assert.ok(result.SessionStart);
    assert.ok(result.Stop);
    assert.ok(result.PostToolUse);
  });

  it("escapes vault path with double quotes in command", () => {
    const result = buildHookEntries("/path/with spaces/vault", hooksDir, { sessionStart: true, stopSweep: false, captureHandler: false });
    assert.ok(result.SessionStart[0].hooks[0].command.includes('VAULT_PATH="/path/with spaces/vault"'));
  });
});

describe("mergeHooksIntoSettings", () => {
  let tmpDir, settingsPath;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-settings-"));
    settingsPath = path.join(tmpDir, "settings.json");
  });

  it("creates settings.json if it doesn't exist", async () => {
    const hookEntries = {
      SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "node hooks/pkm/session-start.js" }] }],
    };
    await mergeHooksIntoSettings(settingsPath, hookEntries, []);
    const content = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    assert.ok(content.hooks);
    assert.ok(content.hooks.SessionStart);
    assert.equal(content.hooks.SessionStart.length, 1);
  });

  it("preserves existing non-hook settings", async () => {
    await fs.writeFile(settingsPath, JSON.stringify({ permissions: { allow: ["Bash"] }, env: { FOO: "bar" } }));
    const hookEntries = {
      SessionStart: [{ hooks: [{ type: "command", command: "node hooks/pkm/session-start.js" }] }],
    };
    await mergeHooksIntoSettings(settingsPath, hookEntries, []);
    const content = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    assert.deepEqual(content.permissions, { allow: ["Bash"] });
    assert.deepEqual(content.env, { FOO: "bar" });
  });

  it("preserves unrelated hooks in the same event", async () => {
    const existing = {
      hooks: {
        SessionStart: [
          { matcher: "startup", hooks: [{ type: "command", command: "/usr/local/bin/my-custom-hook.sh" }] },
        ],
      },
    };
    await fs.writeFile(settingsPath, JSON.stringify(existing));
    const hookEntries = {
      SessionStart: [{ matcher: "startup|clear|compact", hooks: [{ type: "command", command: "node hooks/pkm/session-start.js" }] }],
    };
    await mergeHooksIntoSettings(settingsPath, hookEntries, []);
    const content = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    assert.equal(content.hooks.SessionStart.length, 2);
    assert.ok(content.hooks.SessionStart.some(e => e.hooks[0].command.includes("my-custom-hook")));
  });

  it("replaces existing PKM hook entries on re-run", async () => {
    const existing = {
      hooks: {
        SessionStart: [
          { matcher: "startup|clear|compact", hooks: [{ type: "command", command: 'VAULT_PATH="/old" node /old/hooks/pkm/session-start.js' }] },
        ],
      },
    };
    await fs.writeFile(settingsPath, JSON.stringify(existing));
    const hookEntries = {
      SessionStart: [{ matcher: "startup|clear|compact", hooks: [{ type: "command", command: 'VAULT_PATH="/new" node /new/hooks/pkm/session-start.js' }] }],
    };
    await mergeHooksIntoSettings(settingsPath, hookEntries, []);
    const content = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    assert.equal(content.hooks.SessionStart.length, 1);
    assert.ok(content.hooks.SessionStart[0].hooks[0].command.includes("/new/"));
  });

  it("removes PKM entries for disabled events", async () => {
    const existing = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "/path/hooks/pkm/stop-sweep.js" }] }],
      },
    };
    await fs.writeFile(settingsPath, JSON.stringify(existing));
    await mergeHooksIntoSettings(settingsPath, {}, ["Stop"]);
    const content = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    assert.equal(content.hooks.Stop, undefined);
  });

  it("removes event key when array becomes empty after disabling", async () => {
    const existing = {
      hooks: {
        PostToolUse: [{ matcher: "mcp__obsidian-pkm__vault_capture", hooks: [{ type: "command", command: "/path/hooks/pkm/capture-handler.sh" }] }],
      },
    };
    await fs.writeFile(settingsPath, JSON.stringify(existing));
    await mergeHooksIntoSettings(settingsPath, {}, ["PostToolUse"]);
    const content = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    assert.ok(!("PostToolUse" in (content.hooks || {})));
  });

  it("keeps unrelated entries when disabling PKM hook for that event", async () => {
    const existing = {
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "/my/other-hook.sh" }] },
          { hooks: [{ type: "command", command: "/path/hooks/pkm/stop-sweep.js" }] },
        ],
      },
    };
    await fs.writeFile(settingsPath, JSON.stringify(existing));
    await mergeHooksIntoSettings(settingsPath, {}, ["Stop"]);
    const content = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    assert.equal(content.hooks.Stop.length, 1);
    assert.ok(content.hooks.Stop[0].hooks[0].command.includes("other-hook"));
  });

  it("returns { error } for malformed JSON without modifying the file", async () => {
    await fs.writeFile(settingsPath, "{ not valid json ");
    const result = await mergeHooksIntoSettings(settingsPath, { SessionStart: [{}] }, []);
    assert.ok(result.error);
    const raw = await fs.readFile(settingsPath, "utf8");
    assert.equal(raw, "{ not valid json ");
  });

  it("writes with 2-space indentation", async () => {
    await mergeHooksIntoSettings(settingsPath, {
      SessionStart: [{ hooks: [{ type: "command", command: "test" }] }],
    }, []);
    const raw = await fs.readFile(settingsPath, "utf8");
    assert.ok(raw.includes('  "hooks"'));
  });
});

describe("copyHooks", () => {
  let tmpDir, srcDir, destDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-hooks-"));
    srcDir = path.join(tmpDir, "src-hooks");
    destDir = path.join(tmpDir, "dest-hooks");
    await fs.mkdir(srcDir);
    // Create mock hook files
    await fs.writeFile(path.join(srcDir, "session-start.js"), '#!/usr/bin/env node\nconsole.log("hello");\n');
    await fs.writeFile(path.join(srcDir, "resolve-project.js"), 'export function resolveProject() {}\n');
    await fs.writeFile(path.join(srcDir, "load-context.js"), 'export function loadProjectContext() {}\n');
    await fs.writeFile(path.join(srcDir, "stop-sweep.js"), '#!/usr/bin/env node\nconsole.log("sweep");\n');
    await fs.writeFile(path.join(srcDir, "capture-handler.sh"), '#!/usr/bin/env bash\nSCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)\nMCP_CONFIG=$(node -e "original")\necho done\n');
    // Also add README.md to ensure it's NOT copied
    await fs.writeFile(path.join(srcDir, "README.md"), "# Docs\n");
  });

  it("copies all 5 hook files to destination", async () => {
    const installType = { command: "npx", args: ["-y", "pkm-mcp-server@latest"] };
    await copyHooks(srcDir, destDir, installType);
    const files = (await fs.readdir(destDir)).sort();
    assert.deepEqual(files, ["capture-handler.sh", "load-context.js", "resolve-project.js", "session-start.js", "stop-sweep.js"]);
  });

  it("does not copy README.md", async () => {
    const installType = { command: "npx", args: ["-y", "pkm-mcp-server@latest"] };
    await copyHooks(srcDir, destDir, installType);
    const files = await fs.readdir(destDir);
    assert.ok(!files.includes("README.md"));
  });

  it("patches MCP_CONFIG in shell scripts", async () => {
    const installType = { command: "npx", args: ["-y", "pkm-mcp-server@latest"] };
    await copyHooks(srcDir, destDir, installType);
    const captureContent = await fs.readFile(path.join(destDir, "capture-handler.sh"), "utf8");
    assert.ok(!captureContent.includes('$(node -e "original")'));
    assert.ok(captureContent.includes('"command":"npx"'));
  });

  it("does not patch stop-sweep.js (auto-detects MCP config)", async () => {
    const installType = { command: "npx", args: ["-y", "pkm-mcp-server@latest"] };
    await copyHooks(srcDir, destDir, installType);
    const sweepContent = await fs.readFile(path.join(destDir, "stop-sweep.js"), "utf8");
    assert.equal(sweepContent, '#!/usr/bin/env node\nconsole.log("sweep");\n');
  });

  it("does not patch JS files", async () => {
    const installType = { command: "npx", args: ["-y", "pkm-mcp-server@latest"] };
    await copyHooks(srcDir, destDir, installType);
    const jsContent = await fs.readFile(path.join(destDir, "session-start.js"), "utf8");
    assert.equal(jsContent, '#!/usr/bin/env node\nconsole.log("hello");\n');
  });

  it("creates destination directory if it doesn't exist", async () => {
    const nested = path.join(tmpDir, "deep", "nested", "hooks");
    const installType = { command: "npx", args: ["-y", "pkm-mcp-server@latest"] };
    await copyHooks(srcDir, nested, installType);
    const files = await fs.readdir(nested);
    assert.equal(files.length, 5);
  });

  it("overwrites existing files", async () => {
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(path.join(destDir, "session-start.js"), "old content");
    const installType = { command: "npx", args: ["-y", "pkm-mcp-server@latest"] };
    await copyHooks(srcDir, destDir, installType);
    const content = await fs.readFile(path.join(destDir, "session-start.js"), "utf8");
    assert.ok(content.includes("hello"));
  });
});
