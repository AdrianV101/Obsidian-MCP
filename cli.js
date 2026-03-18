#!/usr/bin/env node

import { createRequire } from "module";

const subcommand = process.argv[2];

if (subcommand === "init") {
  const { runInit } = await import("./init.js");
  await runInit();
} else if (subcommand === "--version" || subcommand === "-v") {
  const require = createRequire(import.meta.url);
  const { version } = require("./package.json");
  console.log(`pkm-mcp-server v${version}`);
} else if (!subcommand) {
  const { startServer } = await import("./index.js");
  await startServer();
} else {
  console.error(`Unknown command: ${subcommand}`);
  console.error("Usage: pkm-mcp-server [init]");
  process.exit(1);
}
