"""KrishiLoop satellite MCP server: read-only STAC search for Sentinel-2 L2A and Sentinel-1 scenes.

Two public catalogues (both checked on Oct 28, 2026): Element 84 Earth Search and Microsoft Planetary Computer.
The server returns scene metadata and asset links only. It downloads no imagery and fetches no access tokens:
Planetary Computer blobs need a SAS token, and Earth Search's Sentinel-1 assets are requester-pays.

Run:  python -m services.mcp.satellite [--transport stdio|http] [--port 8102]
"""
from __future__ import annotations

import logging
import re
import sys
from pathlib import Path

if __package__ in (None, ""):  # run as a script (python services/mcp/satellite/server.py): make `services` importable
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from datetime import date
from typing import Annotated, Any, Literal
from urllib.parse import quote

import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

from services.mcp.common import READ_LOCAL, READ_WEB, serve

logging.getLogger("httpx").setLevel(logging.WARNING)   # no log line per catalogue request
LICENCE = "Copernicus Sentinel data: free and open, with attribution"
PROVIDERS: dict[str, dict] = {
    "earth-search": {
        "name": "Element 84 Earth Search", "root": "https://earth-search.aws.element84.com/v1",
        "collections": {
            "sentinel-2-l2a": "Sentinel-2 L2A surface reflectance (optical; cloud cover applies)",
            "sentinel-1-grd": "Sentinel-1 GRD radar backscatter (sees through cloud)",
        },
        "asset_access": "Sentinel-2 L2A assets are public cloud-optimised GeoTIFFs; Sentinel-1 GRD assets are in a "
                        "requester-pays bucket.",
    },
    "planetary-computer": {
        "name": "Microsoft Planetary Computer", "root": "https://planetarycomputer.microsoft.com/api/stac/v1",
        "collections": {
            "sentinel-2-l2a": "Sentinel-2 L2A surface reflectance (optical; cloud cover applies)",
            "sentinel-1-grd": "Sentinel-1 GRD radar backscatter (sees through cloud)",
            "sentinel-1-rtc": "Sentinel-1 radiometrically terrain-corrected backscatter (sees through cloud)",
        },
        "asset_access": "Asset reads need a SAS token from /api/sas/v1/token/<collection> (this server fetches none).",
    },
}
MAX_BBOX_SIDE_DEG = 2.0       # about 220 km: a district, not a continent
MAX_DAYS = 366
SCENE_ID = re.compile(r"^[A-Za-z0-9_.\-]{1,200}$")
TIMEOUT_S = 30
_TRANSPORT: httpx.BaseTransport | None = None   # tests put an httpx.MockTransport here; no test touches the network

Provider = Literal["earth-search", "planetary-computer"]
Collection = Literal["sentinel-2-l2a", "sentinel-1-grd", "sentinel-1-rtc"]

server = MCPServer(
    "krishiloop-satellite", title="KrishiLoop satellite scenes (STAC)", version="0.1.0",
    instructions="Read-only. Searches public STAC catalogues (Earth Search, Planetary Computer) for Sentinel-2 L2A "
                 "and Sentinel-1 scenes by bounding box, dates and cloud cover, and returns scene metadata. It "
                 "downloads no imagery and gives no advice.")


def _http() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT_S, transport=_TRANSPORT, headers={"User-Agent": "krishiloop-mcp-satellite/0.1"})


def _provider(provider: str, collection: str) -> dict:
    p = PROVIDERS.get(provider)
    if p is None:
        raise ToolError(f"unknown provider {provider!r}; known: {', '.join(PROVIDERS)}")
    if collection not in p["collections"]:
        raise ToolError(f"{provider} has no collection {collection!r} here; it has {', '.join(p['collections'])}")
    return p


def _request(method: str, url: str, **kw) -> dict:
    try:
        with _http() as client:
            r = client.request(method, url, **kw)
    except httpx.HTTPError as e:
        raise ToolError(f"STAC catalogue unreachable ({type(e).__name__})") from None
    if r.status_code == 404:
        raise ToolError("not found in the catalogue")
    if r.status_code != 200:
        raise ToolError(f"STAC catalogue answered HTTP {r.status_code}")
    try:
        return r.json()
    except ValueError:
        raise ToolError("STAC catalogue sent a response that is not JSON") from None


def _self_link(item: dict) -> str | None:
    return next((link.get("href") for link in item.get("links", []) if link.get("rel") == "self"), None)


def _summary(item: dict) -> dict:
    p = item.get("properties") or {}
    out = {"id": item.get("id"), "collection": item.get("collection"), "datetime": p.get("datetime"),
           "platform": p.get("platform"), "cloud_cover_pct": p.get("eo:cloud_cover"),
           "tile": p.get("grid:code") or p.get("s2:mgrs_tile"), "orbit_state": p.get("sat:orbit_state"),
           "relative_orbit": p.get("sat:relative_orbit"), "instrument_mode": p.get("sar:instrument_mode"),
           "polarizations": p.get("sar:polarizations"), "bbox": item.get("bbox"),
           "assets": sorted((item.get("assets") or {}).keys()), "item_url": _self_link(item)}
    return {k: v for k, v in out.items() if v is not None}


@server.tool(annotations=READ_LOCAL, structured_output=True)
def list_collections() -> dict[str, Any]:
    """The STAC catalogues and collections this server can search, and how their assets can be read. Offline."""
    return {"providers": {k: {"name": v["name"], "root": v["root"], "collections": v["collections"],
                              "asset_access": v["asset_access"]} for k, v in PROVIDERS.items()},
            "licence": LICENCE,
            "limits": {"max_bbox_side_deg": MAX_BBOX_SIDE_DEG, "max_days": MAX_DAYS, "max_results": 50}}


@server.tool(annotations=READ_WEB, structured_output=True)
def search_scenes(
    bbox: Annotated[list[float], Field(min_length=4, max_length=4,
                                       description="[west, south, east, north] in degrees (WGS84)")],
    start_date: Annotated[str, Field(description="First day, YYYY-MM-DD (UTC)")],
    end_date: Annotated[str, Field(description="Last day, YYYY-MM-DD (UTC), inclusive")],
    collection: Annotated[Collection, Field(description="STAC collection id")] = "sentinel-2-l2a",
    provider: Annotated[Provider, Field(description="STAC catalogue")] = "earth-search",
    max_cloud_cover: Annotated[float | None, Field(ge=0, le=100, description="Sentinel-2 only: keep scenes with "
                                                   "eo:cloud_cover <= this percentage")] = None,
    limit: Annotated[int, Field(ge=1, le=50, description="Most scenes to return, newest first")] = 10,
) -> dict[str, Any]:
    """Search Sentinel-2 L2A or Sentinel-1 scenes that intersect a bounding box between two dates, newest first,
    optionally filtered by cloud cover (Sentinel-2 only: radar is not blocked by cloud). Returns scene summaries."""
    p = _provider(provider, collection)
    west, south, east, north = bbox
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ToolError("bbox must be [west, south, east, north] with west < east and south < north, in degrees")
    if east - west > MAX_BBOX_SIDE_DEG or north - south > MAX_BBOX_SIDE_DEG:
        raise ToolError(f"bbox sides must be at most {MAX_BBOX_SIDE_DEG} degrees")
    try:
        start, end = date.fromisoformat(start_date), date.fromisoformat(end_date)
    except ValueError:
        raise ToolError("dates must be YYYY-MM-DD") from None
    if start > end or (end - start).days > MAX_DAYS:
        raise ToolError(f"start_date must be on or before end_date, at most {MAX_DAYS} days apart")
    body: dict[str, Any] = {"collections": [collection], "bbox": [west, south, east, north],
                            "datetime": f"{start.isoformat()}T00:00:00Z/{end.isoformat()}T23:59:59Z", "limit": limit,
                            "sortby": [{"field": "properties.datetime", "direction": "desc"}]}
    notes = []
    if max_cloud_cover is not None:
        if collection.startswith("sentinel-2"):
            body["query"] = {"eo:cloud_cover": {"lte": max_cloud_cover}}
        else:
            notes.append("max_cloud_cover ignored: Sentinel-1 is radar and has no cloud-cover property")
    page = _request("POST", f"{p['root']}/search", json=body)
    scenes = [_summary(f) for f in page.get("features") or []]
    matched = page.get("numberMatched", (page.get("context") or {}).get("matched"))
    more = any(link.get("rel") == "next" for link in page.get("links", []))
    if more:
        notes.append("more scenes match: narrow the dates or the box, or raise limit")
    return {"provider": provider, "collection": collection, "query": body, "returned": len(scenes),
            "matched": matched, "more_available": more, "scenes": scenes, "asset_access": p["asset_access"],
            "licence": LICENCE, "notes": notes}


@server.tool(annotations=READ_WEB, structured_output=True)
def scene_metadata(
    scene_id: Annotated[str, Field(description="STAC item id from search_scenes")],
    collection: Annotated[Collection, Field(description="STAC collection id")] = "sentinel-2-l2a",
    provider: Annotated[Provider, Field(description="STAC catalogue")] = "earth-search",
) -> dict[str, Any]:
    """Full STAC metadata for one scene: acquisition time, footprint, all properties (cloud cover, tile, orbit,
    polarisations, processing baseline) and its assets with links. Links only; nothing is downloaded."""
    p = _provider(provider, collection)
    if not SCENE_ID.fullmatch(scene_id):
        raise ToolError("scene_id may contain only letters, digits, '_', '-' and '.'")
    item = _request("GET", f"{p['root']}/collections/{collection}/items/{quote(scene_id, safe='')}")
    assets = [{"key": k, "title": a.get("title"), "type": a.get("type"), "roles": a.get("roles"), "href": a.get("href")}
              for k, a in sorted((item.get("assets") or {}).items())]
    return {"provider": provider, "collection": item.get("collection", collection), "id": item.get("id"),
            "bbox": item.get("bbox"), "geometry": item.get("geometry"), "properties": item.get("properties") or {},
            "assets": assets, "item_url": _self_link(item), "asset_access": p["asset_access"], "licence": LICENCE}


def main(argv: list[str] | None = None) -> None:
    serve(server, 8102, argv)


if __name__ == "__main__":
    main()
