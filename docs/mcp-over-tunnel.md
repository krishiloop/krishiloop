# Our MCP server over a public tunnel (dev-only test, 20 Nov 2026)

Goal: show that another AI agent on the internet can reach a KrishiLoop MCP server. We did not deploy anything to do it.

## Setup
1. Start the read-only rules server over streamable HTTP. It serves public rule packs only, with no secrets and no writes:
   `.venv\Scripts\python.exe -m services.mcp.rules --transport http --port 8104`
2. Open a Pinggy tunnel over plain SSH. There is nothing to install, and it runs on the free tier with a 60-minute limit:
   `ssh -T -p 443 -R0:127.0.0.1:8104 a.pinggy.io "u:Host:127.0.0.1:8104"`
   - Our MCP server keeps its DNS-rebinding protection: it only accepts a localhost `Host` header. The tunnel rewrites the header (`u:Host:…`) instead of us loosening the server.
   - Without the rewrite, the server answered `421 Misdirected Request`, as it should.
3. Call the server through the public `https://…free.pinggy.net/mcp` address.

## Result
| Step | Response |
|---|---|
| `initialize` | `200 OK`, `serverInfo: krishiloop-rules 0.2.0` |
| `notifications/initialized` | `202` |
| `tools/list` | `list_packs`, `get_rule`, `search_rules` |

## Afterwards
- We closed the tunnel and the server right after the test. Nothing stays exposed.
- Earlier try: localtunnel's public server was unreachable that evening, so we used Pinggy.
