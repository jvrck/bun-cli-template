# MCP control surface (opt-in tier)

This tier is **parked** — the lean-core template ships **no** MCP server and
**no** MCP SDK dependency. This document is the guide for adding an opt-in
[Model Context Protocol](https://modelcontextprotocol.io) surface to a
`mytool`-style CLI when you want an MCP client (Claude Code, the Claude desktop
app, Codex CLI/desktop) to drive your tool from inside its own UI. See
[`optional/README.md`](../README.md) for the enable checklist.

## What "enabling MCP" means

1. **Add the SDK dependency** (it is deliberately absent from the core so the
   default binary stays minimal):

   ```bash
   bun add @modelcontextprotocol/sdk
   ```

2. **Implement a `mytool mcp` command** that runs an MCP server over **stdio**
   (no daemon, no listening port, no network surface) and registers one tool per
   meaningful CLI operation. Each tool handler should call the same internal
   functions your CLI commands call, so the MCP surface and the CLI never drift.

   ```ts
   // src/commands/mcp.ts  (sketch)
   import { Server } from "@modelcontextprotocol/sdk/server/index.js";
   import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
   // register tools that wrap your command functions, then:
   //   const server = new Server({ name: "mytool", version: VERSION }, { capabilities: { tools: {} } });
   //   await server.connect(new StdioServerTransport());
   ```

   Wire `mcp` into the dispatcher in `src/cli.ts` alongside `hello`.

3. **Keep the SDK out of the default `--compile` build** unless you want it
   bundled. If the MCP surface is itself optional at runtime, lazy-`import()` the
   SDK inside the `mcp` command so a user who never runs `mytool mcp` pays no
   cost.

## Client configuration

All clients launch the same command: `mytool` with args `["mcp"]`.

> **PATH for GUI-launched apps.** Desktop apps do not inherit your shell `PATH`,
> so use an **absolute** path to the binary (find it with `which mytool`).

### Claude Code

`claude mcp add mytool -- mytool mcp`, or project-scoped `.mcp.json`:

```json
{ "mcpServers": { "mytool": { "command": "mytool", "args": ["mcp"] } } }
```

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.mytool]
command = "mytool"
args = ["mcp"]
```

## Security

- **The server runs with your local privileges.** A client driving it can do
  whatever your tools expose. Only register tools you are comfortable a client
  invoking on your behalf.
- **`read`-style tools can surface secrets** into the model's context — return
  only what you intend the model to see; there is no redaction layer for free.
- **stdio only** — no port, no daemon, no inbound listener.
- **Individual-use boundary** — this is for the operator's own work, not a
  multi-tenant gateway.

## Reference implementation

`jvrck/wux` ships a production `wux mcp` stdio server (sessions/hosts domain) — a
useful structural model for the server wiring, identity envelopes, and the
security framing, even though its domain differs from yours.
