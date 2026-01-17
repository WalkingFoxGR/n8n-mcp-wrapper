# MCP Wrapper (Railway)

This service hosts a stdio MCP server and exposes it over HTTP so Zyntra can connect to it like Claude does.

## Deploy on Railway (n8n example)

1) Create a new Railway project.
2) Deploy from GitHub and set the root to `mcp-wrapper/`.
3) Set environment variables:
   - `MCP_COMMAND`: `npx`
   - `MCP_ARGS`: `["-y","@makafeli/n8n-workflow-builder"]`
   - `MCP_ENV`: `{"N8N_HOST":"https://your-n8n-host/api/v1","N8N_API_KEY":"YOUR_KEY"}`
   - `PORT`: `3000`
4) Deploy. Use the Railway URL as the **Wrapper Server URL** in Zyntra (add `/` only, no path).

## Health Check

`GET /health` returns `{ "ok": true }`.

## Notes

- The wrapper speaks MCP JSON-RPC over HTTP POST.
- Zyntra sends JSON-RPC to the wrapper; the wrapper forwards it to the MCP stdio server.
