"""Shared pieces of KrishiLoop's MCP servers: read-only tool annotations and one command line for both transports.

Every tool on every server only reads. Nothing here signs, issues, recalls or revokes; recall stays behind the API's
admin token (services/api/main.py) and is deliberately not an MCP tool.
"""
from __future__ import annotations

import argparse

from mcp.server.mcpserver import MCPServer
from mcp_types import ToolAnnotations

# Reads local repository data only (rule packs, the trust store, area ledgers).
READ_LOCAL = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
# Reads a public web API (Open-Meteo, STAC catalogues).
READ_WEB = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=True)


def serve(server: MCPServer, default_port: int, argv: list[str] | None = None) -> None:
    """`--transport stdio` (default) or `--transport http` (streamable HTTP at http://<host>:<port>/mcp).

    HTTP binds to 127.0.0.1 by default, where the SDK turns on DNS-rebinding protection."""
    ap = argparse.ArgumentParser(description=f"{server.name}: read-only KrishiLoop MCP server")
    ap.add_argument("--transport", choices=("stdio", "http"), default="stdio")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=default_port)
    args = ap.parse_args(argv)
    if args.transport == "stdio":
        server.run("stdio")
    else:
        server.run("streamable-http", host=args.host, port=args.port)
