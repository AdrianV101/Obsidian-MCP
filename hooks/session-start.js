#!/usr/bin/env node

import { resolveProject } from "./resolve-project.js";
import { loadProjectContext } from "./load-context.js";

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
