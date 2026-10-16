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

## Live in the app

The MCP server is a separate process on the same library. Both write `notebook_db.json` under one lock file
(`notebook_db.json.lock`), so neither loses the other's change. After a tool changes something (an audit, a transcript,
lesson fields) the server rewrites `<data_dir>/library_changed`; the app's job stream turns that into a `library`
event, and the open app reloads the library and the open lesson within a second. With the app closed nothing is
lost: the change is on disk and shows up on the next start.
