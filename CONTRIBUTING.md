# Contributing

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. Clone the repo and install dependencies:
   ```bash
   cd mcp-server
   npm install
   ```

2. Set required environment variables:
   ```bash
   export VAULT_PATH="/path/to/test/vault"
   # Optional: export OPENAI_API_KEY="sk-..." for semantic search
   ```

3. Run the server:
   ```bash
   npm start
   ```

## Making Changes

1. Fork the repo and create a feature branch
2. Make your changes in `mcp-server/`
3. Test against an Obsidian vault
4. Submit a pull request

## Adding Templates

Place new templates in `templates/` following existing conventions:
- YAML frontmatter with `type`, `created`, `tags` fields
- Use `<% tp.date.now("YYYY-MM-DD") %>` and `<% tp.file.title %>` for auto-substitution
- Include HTML comments as guidance for users

If you add a template, also update the table in `sample-project/CLAUDE.md`.

## Reporting Issues

Open an issue on GitHub with:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
