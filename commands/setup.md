---
name: setup
description: Configure Obsidian PKM plugin — set vault path, API keys, and verify setup
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion]
---

# Obsidian PKM Setup

You are configuring the Obsidian PKM plugin. Walk the user through these steps:

## Step 1: Vault Path

Ask the user for their Obsidian vault path. Validate that:
- The path exists and is a directory
- It contains at least one `.md` file
- Suggest `~/Documents/PKM` as a default

If the path is valid, instruct the user to add `export VAULT_PATH="/absolute/path/to/vault"` to their shell profile (`~/.zshrc` or `~/.bashrc`) if not already set. Verify with `echo $VAULT_PATH`.

## Step 2: OpenAI API Key (Optional)

Ask if they want semantic search features (vault_semantic_search, vault_suggest_links). If yes:
- **NEVER ask the user to type their API key in the chat** — it would be stored in conversation history
- Instead, tell them to run this command themselves (they should type `!` followed by the command in the prompt, or run it in a separate terminal):
  ```
  echo 'export OPENAI_API_KEY="sk-YOUR-KEY-HERE"' >> ~/.zshrc && source ~/.zshrc
  ```
- Explain this enables 2 additional tools (semantic search + link suggestions) but is completely optional
- Explain they need to replace `sk-YOUR-KEY-HERE` with their actual key from https://platform.openai.com/api-keys

## Step 3: Verify Setup

Run these checks:
1. `echo $VAULT_PATH` — confirm it's set
2. Count `.md` files in the vault: `find "$VAULT_PATH" -name "*.md" | wc -l`
3. Check if templates exist: `ls "$VAULT_PATH/05-Templates/"` — if missing, offer to run `obsidian-pkm init` to scaffold the vault structure

## Step 4: Migration Check

Check if the old `pkm-mcp-server` is installed:
1. Run `npm list -g pkm-mcp-server --depth=0 2>/dev/null`
2. Check for stale hooks: `ls ~/.claude/hooks/pkm/ 2>/dev/null`

If found:
- Suggest: `npm uninstall -g pkm-mcp-server`
- Suggest removing `~/.claude/hooks/pkm/` directory (hooks are now managed by the plugin)
- Check `~/.claude/settings.json` for old hook entries and offer to clean them up

## Step 5: Done

Confirm setup is complete. Tell the user:
- "Your Obsidian PKM plugin is configured. Try asking me to list your vault folders to verify."
- If OPENAI_API_KEY was set: "Semantic search will build its index in the background on first use."
- **Important**: "If you just added environment variables to your shell profile, you'll need to restart your Claude Code session (or run `source ~/.zshrc`) for the MCP server and hooks to pick them up."
