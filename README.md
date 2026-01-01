# PKM + Claude Code Integration Starter Kit

This starter kit enables bidirectional knowledge flow between Claude Code and your Obsidian vault.

## What's Included

```
pkm-starter-kit/
├── mcp-server/           # MCP server for vault access
│   ├── package.json
│   └── index.js
├── templates/            # Obsidian note templates
│   ├── project-index.md
│   ├── adr.md
│   ├── devlog.md
│   └── permanent-note.md
├── sample-project/       # Sample CLAUDE.md
│   └── CLAUDE.md
└── README.md
```

## Quick Start (15 minutes)

### Step 1: Set Up Your Obsidian Vault

Create this folder structure in a new or existing vault:

```
Your-Vault/
├── 00-Inbox/
├── 01-Projects/
├── 02-Areas/
├── 03-Resources/
│   └── Development/
├── 04-Archive/
├── 05-Templates/
└── 06-System/
```

Copy the templates from `templates/` to `05-Templates/` in your vault.

### Step 2: Install the MCP Server

```bash
# Navigate to mcp-server directory
cd mcp-server

# Install dependencies
npm install

# Test it works (should print "PKM MCP Server running...")
VAULT_PATH="/path/to/your/vault" node index.js
# Press Ctrl+C to stop
```

### Step 3: Register with Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "obsidian-pkm": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/index.js"],
      "env": {
        "VAULT_PATH": "/absolute/path/to/your/obsidian/vault"
      }
    }
  }
}
```

Restart Claude Code for changes to take effect.

### Step 4: Create Your First Project

1. In your vault, create: `01-Projects/MyFirstProject/`
2. Create these subfolders:
   - `planning/`
   - `research/`
   - `development/decisions/`
   - `meetings/`
3. Create `_index.md` using the project-index template
4. Create `development/devlog.md` using the devlog template

### Step 5: Connect Your Code Repository

1. Copy `sample-project/CLAUDE.md` to your code repo
2. Edit it to point to your vault project path
3. Customize the documentation rules as needed

### Step 6: Start Using It!

In Claude Code, try these:

```
# Load project context
"Read my project overview from the PKM"

# Create an ADR
"We decided to use PostgreSQL instead of MongoDB. Create an ADR documenting this decision."

# Update dev log
"I just implemented user authentication. Update the dev log."

# Search for prior work
"Search my PKM for anything about API rate limiting"
```

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `vault_read` | Read a note's contents |
| `vault_write` | Create or overwrite a note |
| `vault_append` | Add content to existing note |
| `vault_search` | Full-text search across vault |
| `vault_list` | List files and folders |
| `vault_recent` | Get recently modified files |
| `vault_links` | Get incoming/outgoing links |

## Workflows

### Starting a Session
Claude Code should:
1. Read CLAUDE.md in the project
2. Load context notes specified
3. Check for recent updates
4. Ask what you're working on

### During Development
Claude Code can:
- Search vault for related prior work
- Create ADRs when decisions are made
- Update dev log with progress
- Extract reusable knowledge to Resources

### Ending a Session
Claude Code should:
- Summarize what was accomplished
- Update dev log
- Update project status if changed
- Note any new knowledge created

## Customization

### Adding Semantic Search
For more powerful retrieval, consider adding:
- Obsidian Copilot plugin (in Obsidian)
- Embeddings to the MCP server (enhance with LangChain/LlamaIndex)

### Extending the MCP Server
The server can be enhanced with Claude Code:
```
"Add a vault_semantic_search tool that uses embeddings for similarity search"
```

## Troubleshooting

**MCP server not connecting:**
- Check the path in settings.json is absolute
- Ensure VAULT_PATH points to vault root (where .obsidian folder is)
- Restart Claude Code after config changes

**Notes not found:**
- Paths are relative to vault root
- Don't include the vault path in file paths
- Use forward slashes even on Windows

**Permission errors:**
- Ensure the vault directory is readable/writable
- Check file permissions on the vault

## Next Steps

1. Use the system for a real project
2. Iterate on templates based on what you actually need
3. Add more note types (meeting notes, research notes)
4. Consider adding semantic search capability
5. Build custom tools for your specific workflows

---

Built with Claude Code. Improve it with Claude Code.
