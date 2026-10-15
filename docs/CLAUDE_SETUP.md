# Connecting Claude

## Claude Code

The repository ships a `.mcp.json`. When you open the project, Claude Code offers to enable the `lecture-studio`
server — accept. Check with `/mcp` in a session.

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lecture-studio": {
      "command": "/opt/homebrew/bin/uv",
      "args": ["run", "--quiet", "--directory", "/path/to/lecture-studio", "python", "mcp_server.py"]
    }
  }
}
```

Restart Claude Desktop (Cmd+Q).

## Cursor / Cline

The same command: `uv run --quiet --directory <path to the repository> python mcp_server.py`, stdio transport.

## Agent behaviour

Rules live in [CLAUDE.md](../CLAUDE.md): for questions about lessons go to MCP first, timecodes are `[MM:SS]` on the
clean timeline only, audits use the slide-notes style.

You do not start the MCP server yourself: the client launches it. The app's Shut down button does not touch it.
