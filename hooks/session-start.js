#!/usr/bin/env node

import { resolveProject } from "./resolve-project.js";
import { loadProjectContext } from "./load-context.js";
import fs from "node:fs/promises";
import path from "node:path";

const VAULT_PATH = process.env.VAULT_PATH;

async function main() {
  let inputJson = "";
  for await (const chunk of process.stdin) {
    inputJson += chunk;
  }

  let input;
  try {
    input = JSON.parse(inputJson);
  } catch {
    const output = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "PKM hook error: could not parse hook input JSON."
      }
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  const { cwd } = input;

  if (!cwd || typeof cwd !== "string") {
    const output = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "PKM hook error: hook input missing 'cwd' field."
      }
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  if (!VAULT_PATH) {
    const output = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "PKM hook warning: VAULT_PATH environment variable not set. Vault context unavailable."
      }
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  const { projectPath, error } = await resolveProject(cwd, VAULT_PATH);

  if (error) {
    const output = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `PKM: ${error}`
      }
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  // Check if CWD's CLAUDE.md has ## PKM Integration section
  let hasPkmSection = false;
  try {
    const claudeMdContent = await fs.readFile(path.join(cwd, "CLAUDE.md"), "utf-8");
    hasPkmSection = /^## PKM Integration/m.test(claudeMdContent);
  } catch (e) {
    if (e.code !== "ENOENT") {
      console.error(`PKM session-start: error reading CLAUDE.md: ${e.message}`);
    }
    // hasPkmSection stays false
  }

  if (!hasPkmSection) {
    let context = "";
    try {
      context = await loadProjectContext(VAULT_PATH, projectPath);
    } catch (e) {
      console.error(`PKM session-start: failed to load project context: ${e.message}`);
      // context stays "" — still show the nudge
    }

    const output = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: (context ? context + "\n\n" : "") +
          "PKM: This project's CLAUDE.md does not have a ## PKM Integration section. " +
          "The obsidian-pkm plugin is installed but this project is not configured for proactive vault usage. " +
          "If the user asks about PKM or documentation, suggest running /obsidian-pkm:init-project."
      },
      systemMessage: "Obsidian PKM: This project isn't configured yet. Run /obsidian-pkm:init-project to set up vault integration."
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  let context;
  try {
    context = await loadProjectContext(VAULT_PATH, projectPath);
  } catch (e) {
    const output = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `PKM hook error: failed to load project context: ${e.message}`
      }
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context
    }
  };
  console.log(JSON.stringify(output));
}

main().catch((err) => {
  console.error(`PKM SessionStart hook error: ${err.message}`);
  process.exit(1);
});
