# Connecting an MCP client

`mcp_server.py` is a stdio MCP server named `lecture-studio`. Any MCP client can start it with:

```text
uv run --quiet --directory /path/to/lecture-studio python mcp_server.py
```

A typical client config:

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

Use the full path to `uv` (`which uv`) when the client does not inherit your shell's PATH, then restart the client.

## How an agent should use it

For questions about lessons, lectures or notes go to the MCP tools first ([MCP_REFERENCE.md](MCP_REFERENCE.md)).
Timecodes are `[MM:SS]` on the clean timeline only; audits use the slide-notes style ([PROJECT_RULES.md](PROJECT_RULES.md)).

You do not start the MCP server yourself: the client launches it. The app's Shut down button does not touch it.

## Your subscription

Claude Desktop or Claude Code signs in through Anthropic's own flow and calls this server's tools, as with any MCP
server; your Claude plan pays for that work. The app never sees your Claude login and never runs Claude on your
behalf. Its own AI features (the audit after processing, the assistant) use an API key you enter or a local model,
which is what Anthropic's terms ask of third-party products
([legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)).

## Live in the app

The MCP server is a separate process on the same library. Both write `notebook_db.json` under one lock file
(`notebook_db.json.lock`), so neither loses the other's change. After a tool changes something (an audit, a transcript,
lesson fields) the server rewrites `<data_dir>/library_changed`; the app's job stream turns that into a `library`
event, and the open app reloads the library and the open lesson within a second. With the app closed nothing is
lost: the change is on disk and shows up on the next start.
