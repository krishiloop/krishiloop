"""MCP servers (services/mcp/): every tool only reads, recall is not exposed, and the answers match the engine and the
public verifier. No network: Open-Meteo and STAC calls are mocked, and a guard fails any non-loopback connection."""
import asyncio
import hashlib
import json
import socket
import subprocess
import sys
import time
import urllib.error
import uuid
from datetime import date, timedelta

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from mcp import Client, StdioServerParameters

from services.api import main as api
from services.engine import snapshot as snap_mod
from services.engine.planner import DEMO_FIELDS, DEMO_PROFILES, make_plan
from services.engine.rules import REGISTRY, load_pack, pack_parameters
from services.mcp.knowledge import server as knowledge
from services.mcp.satellite import server as satellite
from services.mcp.weather import server as weather
from services.trust import store as store_mod
from services.trust.store import ROOT, TrustStore, did_from_base_url
from services.vision.service import PhotoService

SERVERS = (weather.server, satellite.server, knowledge.server)
BASE, DID, SEED = "https://krishiloop.example", "did:web:krishiloop.example", "11" * 32


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Loopback stays allowed (asyncio's own socket pair on Windows, the HTTP transport test)."""
    real = socket.socket.connect

    def guard(sock, address):
        if isinstance(address, tuple) and address[0] not in ("127.0.0.1", "::1", "localhost"):
            raise AssertionError(f"network call in a test: {address[0]}")
        return real(sock, address)
    monkeypatch.setattr(socket.socket, "connect", guard)


def run(server, *calls):
    """Call tools through the MCP protocol (in-process client); returns the CallToolResults."""
    async def go():
        async with Client(server) as c:
            return [await c.call_tool(name, args) for name, args in calls]
    return asyncio.run(go())


def ok(server, tool, args=None) -> dict:
    (r,) = run(server, (tool, args or {}))
    assert not r.is_error, r.content[0].text
    return r.structured_content


def err(server, tool, args=None) -> str:
    (r,) = run(server, (tool, args or {}))
    assert r.is_error
    return r.content[0].text


def list_tools(server):
    async def go():
        async with Client(server) as c:
            return (await c.list_tools()).tools
    return asyncio.run(go())


# ---------------------------------------------------------------- all servers
def test_every_tool_only_reads_and_recall_is_not_a_tool():
    names = {}
    for srv in SERVERS:
        for t in list_tools(srv):
            a = t.annotations
            assert a.read_only_hint is True and a.destructive_hint is False and a.idempotent_hint is True, t.name
            assert not any(w in t.name for w in ("recall", "revoke", "issue", "sign", "resolve", "judge", "verdict"))
            names.setdefault(srv.name, set()).add(t.name)
    assert names == {"krishiloop-weather": {"forecast_snapshot", "weather_parameters"},
                     "krishiloop-satellite": {"list_collections", "search_scenes", "scene_metadata"},
                     "krishiloop-knowledge": {"verify_credential", "list_packs", "get_rule", "area_photo_trust"}}


@pytest.mark.parametrize("module, tool, args", [
    ("services.mcp.weather", "weather_parameters", {"pack_id": "pack-bd-rice"}),
    ("services.mcp.satellite", "list_collections", {}),
    ("services.mcp.knowledge", "list_packs", {}),
])
def test_servers_run_over_stdio(module, tool, args):
    async def go():
        async with Client(StdioServerParameters(command=sys.executable, args=["-m", module], cwd=str(ROOT))) as c:
            return await c.call_tool(tool, args)
    result = asyncio.run(go())
    assert not result.is_error and result.structured_content


def test_server_runs_over_streamable_http():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen([sys.executable, "-m", "services.mcp.knowledge", "--transport", "http", "--port", str(port)],
                            cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        async def go():
            async with Client(f"http://127.0.0.1:{port}/mcp") as c:
                return await c.call_tool("get_rule", {"rule_id": "R-PLB-001"})
        deadline = time.monotonic() + 30
        while True:
            try:
                result = asyncio.run(go())
                break
            except Exception:
                if time.monotonic() > deadline or proc.poll() is not None:
                    raise
                time.sleep(0.3)
        assert not result.is_error and result.structured_content["sources"][0]["page"] == 27
    finally:
        proc.kill()
        proc.wait(timeout=10)


# ---------------------------------------------------------------- weather
def _forecast(days=7, rh=95, tmin=12, tmax=20, rain=12.0):
    t = [(date.today() + timedelta(days=i)).isoformat() for i in range(days)]
    return {"daily": {"time": t, "temperature_2m_max": [tmax] * days, "temperature_2m_min": [tmin] * days,
                      "precipitation_sum": [rain] * days, "relative_humidity_2m_mean": [rh] * days}}


@pytest.fixture()
def wx(tmp_path, monkeypatch):
    calls = []

    def fake_get(url, params):
        calls.append(params)
        return _forecast()
    monkeypatch.setattr(weather, "CACHE_DIR", tmp_path / "wx")
    monkeypatch.setattr(snap_mod, "SNAP_DIR", tmp_path / "planner")
    monkeypatch.setattr(snap_mod, "_get", fake_get)
    return calls


def test_forecast_facts_are_the_planners_never_a_plan(wx, tmp_path):
    pack = "pack-potato-late-blight"
    out = ok(weather.server, "forecast_snapshot", {"lat": -0.7512, "lon": 36.6049, "pack_id": pack})
    assert (wx[0]["latitude"], wx[0]["longitude"]) == (-0.75, 36.6)          # about 1 km, before it is sent
    assert out["data_mode"] == "live" and out["stale_for_planner"] is False and len(out["days"]) == 7
    snap = json.loads(next((tmp_path / "wx").glob("*.json")).read_text(encoding="utf-8"))
    assert {f: v["value"] for f, v in out["facts"].items()} == snap_mod.weather_facts(snap, pack_parameters(pack))
    assert out["facts"]["forecast_humid_mild_days"]["value"] == 7 and out["facts"]["forecast_heavy_rain_days"]["value"] == 7
    humid = out["facts"]["forecast_humid_mild_days"]
    assert {p["name"] for p in humid["parameters"]} == {"humid_rh_pct_min", "mild_temp_c_range"}
    assert all(p["set_by"] == "team" and "NOT from source" in p["note"] for p in humid["parameters"])
    assert any(c["rule_id"] == "R-PLB-008" and c["parameter"]["name"] == "humid_mild_days_min"
               for c in humid["read_by_rule_conditions"])
    assert not {"actions", "plan", "advice", "receipt", "status"} & set(out)
    assert not (tmp_path / "planner").exists()          # the planner's own snapshots are never touched


def test_forecast_falls_back_to_its_cache_and_unknown_stays_unknown(wx, tmp_path, monkeypatch):
    args = {"lat": 24.75, "lon": 90.4, "pack_id": "pack-bd-rice"}
    ok(weather.server, "forecast_snapshot", args)

    def down(url, params):
        raise urllib.error.URLError("offline")
    monkeypatch.setattr(snap_mod, "_get", down)
    out = ok(weather.server, "forecast_snapshot", args)
    assert out["data_mode"] == "snapshot" and out["stale_for_planner"] is False
    cache = next((tmp_path / "wx").glob("*.json"))
    old = json.loads(cache.read_text(encoding="utf-8"))
    old["created_at"] = "2026-01-01T00:00:00Z"
    cache.write_text(json.dumps(old), encoding="utf-8")
    assert ok(weather.server, "forecast_snapshot", args)["stale_for_planner"] is True
    assert "no earlier forecast" in err(weather.server, "forecast_snapshot", {**args, "lat": 10.0})
    monkeypatch.setattr(snap_mod, "_get", lambda url, params: _forecast(days=3))   # too few days: unknown, never 0
    facts = ok(weather.server, "forecast_snapshot", args)["facts"]
    assert facts["forecast_humid_mild_days"]["value"] is None and facts["forecast_heavy_rain_days"]["value"] is None


def test_weather_rejects_unknown_packs_and_coordinates(wx):
    assert "unknown pack" in err(weather.server, "weather_parameters", {"pack_id": "../../secrets"})
    assert "unknown pack" in err(weather.server, "forecast_snapshot", {"lat": 1, "lon": 1, "pack_id": "pack-x"})
    err(weather.server, "forecast_snapshot", {"lat": 91, "lon": 0, "pack_id": "pack-bd-rice"})
    assert wx == []
    params = ok(weather.server, "weather_parameters", {"pack_id": "pack-bd-rice"})
    assert params["facts"]["forecast_heavy_rain_days"]["parameters"][0]["value"] == pack_parameters("pack-bd-rice")["heavy_rain_mm"]


# ---------------------------------------------------------------- satellite
# Shaped like a real Earth Search item (id, time and cloud cover from a live search on Oct 28, 2026).
S2_ITEM = {
    "type": "Feature", "id": "S2B_36MZE_20261024_0_L2A", "collection": "sentinel-2-l2a",
    "bbox": [35.99, -1.45, 36.99, -0.54],
    "properties": {"datetime": "2026-10-24T08:00:12.758000Z", "platform": "sentinel-2b", "eo:cloud_cover": 17.370951,
                   "grid:code": "MGRS-36MZE"},
    "assets": {"red": {"href": "https://example.test/B04.tif", "type": "image/tiff", "roles": ["data"], "title": "Red"},
               "thumbnail": {"href": "https://example.test/thumb.jpg", "type": "image/jpeg", "roles": ["thumbnail"]}},
    "links": [{"rel": "self", "href": "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/"
                                      "S2B_36MZE_20261024_0_L2A"}],
}


@pytest.fixture()
def stac(monkeypatch):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.method == "POST" and request.url.path.endswith("/search"):
            return httpx.Response(200, json={"type": "FeatureCollection", "features": [S2_ITEM], "numberMatched": 14,
                                             "links": [{"rel": "next", "href": "https://example.test/next"}]})
        if request.url.path.endswith("/items/S2B_36MZE_20261024_0_L2A"):
            return httpx.Response(200, json=S2_ITEM)
        if "unreachable" in request.url.path:
            raise httpx.ConnectError("down")
        return httpx.Response(404, json={"code": "NotFound"})
    monkeypatch.setattr(satellite, "_TRANSPORT", httpx.MockTransport(handler))
    return seen


def test_search_scenes_sends_a_stac_query_and_summarises(stac):
    out = ok(satellite.server, "search_scenes", {"bbox": [36.55, -0.8, 36.65, -0.7], "start_date": "2026-10-01",
                                                 "end_date": "2026-10-28", "max_cloud_cover": 30, "limit": 5})
    (req,) = stac
    assert req.method == "POST" and str(req.url) == "https://earth-search.aws.element84.com/v1/search"
    body = json.loads(req.content)
    assert body["collections"] == ["sentinel-2-l2a"] and body["bbox"] == [36.55, -0.8, 36.65, -0.7] and body["limit"] == 5
    assert body["datetime"] == "2026-10-01T00:00:00Z/2026-10-28T23:59:59Z"
    assert body["query"] == {"eo:cloud_cover": {"lte": 30}} and body["sortby"][0]["direction"] == "desc"
    assert out["returned"] == 1 and out["matched"] == 14 and out["more_available"] is True
    scene = out["scenes"][0]
    assert scene["id"] == S2_ITEM["id"] and scene["cloud_cover_pct"] == 17.370951 and scene["tile"] == "MGRS-36MZE"
    assert scene["assets"] == ["red", "thumbnail"] and "Copernicus" in out["licence"]


def test_sentinel1_ignores_cloud_cover_and_planetary_computer_is_used(stac):
    out = ok(satellite.server, "search_scenes", {"bbox": [90.3, 24.7, 90.5, 24.8], "start_date": "2026-10-01",
                                                 "end_date": "2026-10-28", "collection": "sentinel-1-rtc",
                                                 "provider": "planetary-computer", "max_cloud_cover": 10})
    (req,) = stac
    assert str(req.url) == "https://planetarycomputer.microsoft.com/api/stac/v1/search"
    assert "query" not in json.loads(req.content) and any("radar" in n for n in out["notes"])
    assert "SAS token" in out["asset_access"]


@pytest.mark.parametrize("args, message", [
    ({"bbox": [36, -1, 39, 0]}, "at most"),                                   # bigger than a district
    ({"bbox": [36.7, -0.8, 36.6, -0.7]}, "west < east"),
    ({"start_date": "28/10/2026"}, "YYYY-MM-DD"),
    ({"start_date": "2026-10-29"}, "on or before"),
    ({"start_date": "2025-01-01"}, "366 days"),
    ({"collection": "sentinel-1-rtc"}, "has no collection"),                  # not on Earth Search
])
def test_search_scenes_validates_before_any_request(stac, args, message):
    base = {"bbox": [36.55, -0.8, 36.65, -0.7], "start_date": "2026-10-01", "end_date": "2026-10-28"}
    assert message in err(satellite.server, "search_scenes", {**base, **args})
    assert stac == []


def test_scene_metadata(stac):
    out = ok(satellite.server, "scene_metadata", {"scene_id": "S2B_36MZE_20261024_0_L2A"})
    assert stac[0].method == "GET" and stac[0].url.path == "/v1/collections/sentinel-2-l2a/items/S2B_36MZE_20261024_0_L2A"
    assert out["properties"]["eo:cloud_cover"] == 17.370951 and out["assets"][0]["href"].endswith("B04.tif")
    assert "not found" in err(satellite.server, "scene_metadata", {"scene_id": "S2B_NOPE"})
    assert "unreachable" in err(satellite.server, "scene_metadata", {"scene_id": "unreachable"})
    n = len(stac)
    assert "only letters" in err(satellite.server, "scene_metadata", {"scene_id": "../../search"})
    assert len(stac) == n
    assert ok(satellite.server, "list_collections")["providers"]["earth-search"]["collections"]


# ---------------------------------------------------------------- receipts and knowledge
@pytest.fixture()
def kn(tmp_path, monkeypatch):
    """An official store and the data folder the knowledge server reads, both in tmp_path."""
    monkeypatch.setattr(knowledge, "DATA_DIR", tmp_path)
    monkeypatch.setenv("PUBLIC_BASE_URL", BASE)
    monkeypatch.setenv("ISSUER_DID", DID)
    monkeypatch.setenv("KRISHILOOP_ISSUER_SEED", SEED)
    return TrustStore(BASE, DID, SEED, data_dir=knowledge._official_dir())


def _plan(store, tmp_path) -> dict:
    days = [{"date": (date.today() + timedelta(days=i)).isoformat(), "rh_mean_pct": 95, "tmin_c": 12, "tmax_c": 20,
             "precip_mm": 1.0} for i in range(7)]
    snap = {"snapshot_id": "snap-t", "field_id": "KE-SAMPLE-01", "mode": "live", "location": {"precision": "sample_location"},
            "created_at": snap_mod._now(), "forecast": {"source": "open-meteo:forecast", "issued_at": snap_mod._now(), "days": days}}
    plan = make_plan(DEMO_FIELDS["KE-SAMPLE-01"], DEMO_PROFILES["demo-farmer-a"], store, snap=snap, inbox_dir=tmp_path / "inbox")
    assert plan["status"] == "ok"
    return plan


def test_verify_matches_the_public_verifier_and_sees_a_recall_at_once(kn, tmp_path, monkeypatch):
    action = _plan(kn, tmp_path)["actions"][0]
    cred, ref = action["receipt_credential_id"], action["receipt"]["rule_refs"][0]
    out = ok(knowledge.server, "verify_credential", {"credential_id": cred})
    assert out["status"] == "authentic" and out["sandbox"] is False and out["credential"]["id"] == cred
    monkeypatch.setattr(api, "_store", kn)
    public = TestClient(api.app).get(f"/api/verify/{cred}").json()
    keys = ("status", "reason", "sandbox", "status_list", "credential")
    assert {k: out[k] for k in keys} == {k: public[k] for k in keys}
    kn.recall_rule(ref["rule_id"], ref["version"], "test recall")      # the admin's recall, outside MCP
    out = ok(knowledge.server, "verify_credential", {"credential_id": cred})
    assert out["status"] == "recalled" and f"{ref['rule_id']} v{ref['version']}" in out["reason"]
    assert ok(knowledge.server, "get_rule", {"rule_id": ref["rule_id"]})["recall_in_official_store"]["reason"] == "test recall"
    rules = {r["rule_id"]: r for p in ok(knowledge.server, "list_packs")["packs"] for r in p["rules"]}
    assert rules[ref["rule_id"]]["recalled_in_official_store"] is True


def test_verify_rejects_unknown_and_malformed_ids_and_creates_nothing(kn, tmp_path):
    before = sorted(p for p in tmp_path.rglob("*"))
    for bad in ("..%5C..%5Csecret", "../../secrets/.env", "C:\\Windows\\win.ini", "not-a-uuid", f"urn:uuid:{uuid.uuid4()}"):
        assert ok(knowledge.server, "verify_credential", {"credential_id": bad})["status"] == "invalid"
    assert sorted(p for p in tmp_path.rglob("*")) == before


def test_verification_needs_the_seed_and_never_echoes_it(kn, monkeypatch):
    cred = f"urn:uuid:{uuid.uuid4()}"
    monkeypatch.delenv("KRISHILOOP_ISSUER_SEED")
    assert "KRISHILOOP_ISSUER_SEED is not set" in err(knowledge.server, "verify_credential", {"credential_id": cred})
    assert ok(knowledge.server, "list_packs")["packs"]             # knowledge tools need no secret
    monkeypatch.setenv("KRISHILOOP_ISSUER_SEED", "zq" * 32)
    message = err(knowledge.server, "verify_credential", {"credential_id": cred})
    assert "malformed" in message and "zq" not in message


LABELS = ["healthy", "blast", "brown_spot"]
CLASS_DIRS = np.random.RandomState(0).randn(3, 16)


def _fake_features(image: bytes) -> np.ndarray:
    """'blast:7' -> a photo of blast (number 7), as in tests/test_photo_service.py."""
    label, n = image.decode().split(":")
    return CLASS_DIRS[LABELS.index(label)] + 0.15 * np.random.RandomState(int(n)).randn(16)


def test_area_photo_trust_reads_the_sandbox_ledger_and_credential(kn, tmp_path, monkeypatch):
    sid = "0123456789abcdef"
    sandbox = TrustStore(BASE, DID, SEED, data_dir=tmp_path / "demo" / sid / "trust", status_id=f"demo-{sid}")
    svc = PhotoService(sandbox, tmp_path / "demo" / sid / "photo", "leaf@1", "a" * 64, LABELS,
                       CLASS_DIRS + 0.6 * np.random.RandomState(1).randn(3, 16), _fake_features)
    field = {"field_id": "BD-T", "crop": "rice", "country": "BD", "stage": "tillering", "pack_id": "pack-bd-rice"}
    for i in range(80):            # officer verdicts until the gate opens
        case = svc.submit(field, f"{LABELS[i % 3]}:{i}".encode(), consent=False)
        if case["route"] == "officer" and (svc.judge(case["case_id"], LABELS[i % 3], "officer-1")["event"] or {}).get("event") == "opened":
            break
    args = {"area": "rice@BD", "session_id": sid}
    out = ok(knowledge.server, "area_photo_trust", args)
    (model,) = out["models"]
    assert out["trusted_models"] == ["leaf@1"] and model["ledger"]["gate_open"] and model["ledger"]["lower_bound"] >= 0.85
    assert model["ledger"] == {k: v for k, v in svc.area("rice@BD").items() if k not in ("area", "model", "trust_credential_id")}
    assert model["trust_credential"]["status"] == "authentic" and model["trust_credential_id"] == svc.area("rice@BD")["trust_credential_id"]
    cred = model["trust_credential_id"]
    v = ok(knowledge.server, "verify_credential", {"credential_id": cred})
    assert v["status"] == "authentic" and v["sandbox"] is True and v["status_list"] == f"{BASE}/status/demo-{sid}"
    assert ok(knowledge.server, "area_photo_trust", {"area": "rice@BD"})["trusted_models"] == []   # official is separate
    sandbox.revoke(cred)            # trust withdrawn (drift); the next call sees it
    assert ok(knowledge.server, "verify_credential", {"credential_id": cred})["status"] == "recalled"
    assert ok(knowledge.server, "area_photo_trust", args)["trusted_models"] == []
    monkeypatch.setattr(knowledge, "SANDBOX_TTL_S", -1)            # an expired session is unknown, as in the API
    assert "expired" in err(knowledge.server, "area_photo_trust", args)
    assert ok(knowledge.server, "verify_credential", {"credential_id": cred})["status"] == "invalid"
    assert "crop@AREA" in err(knowledge.server, "area_photo_trust", {"area": "../rice"})


def test_knowledge_server_finds_stores_where_the_api_does(tmp_path, monkeypatch):
    assert knowledge.SANDBOX_TTL_S == api.SANDBOX_TTL_S
    monkeypatch.setattr(store_mod, "ROOT", tmp_path)
    monkeypatch.setattr(knowledge, "DATA_DIR", tmp_path / "data")
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://localhost:8000")
    monkeypatch.delenv("ISSUER_DID", raising=False)
    assert TrustStore("http://localhost:8000", did_from_base_url("http://localhost:8000"), SEED).dir == knowledge._official_dir()


def test_rules_carry_their_sources_verbatim():
    packs = ok(knowledge.server, "list_packs")["packs"]
    assert {p["pack_id"] for p in packs} == {p.name for p in REGISTRY.iterdir() if p.is_dir()}
    assert all(p["pack_tests"]["passed"] and p["rule_count"] == len(load_pack(p["pack_id"])) for p in packs)
    rules = [r for p in packs for r in load_pack(p["pack_id"])]
    results = run(knowledge.server, *[("get_rule", {"rule_id": r["rule_id"], "version": r["version"]}) for r in rules])
    for rule, result in zip(rules, results):
        out = result.structured_content
        assert out["rule_sha256"] == rule["rule_sha256"] and out["action"] == rule["action"]
        for got, want in zip(out["sources"], rule["sources"]):
            assert (got["doc_id"], got["page"], got["quote"]) == (want["doc_id"], want["page"], want["quote"])
            assert got["quote_sha256"] == hashlib.sha256(got["quote"].encode("utf-8")).hexdigest()
            assert got["licence_status"] and got["acknowledgement"]
    assert "unknown rule" in err(knowledge.server, "get_rule", {"rule_id": "R-PLB-999"})
    assert "no version 9" in err(knowledge.server, "get_rule", {"rule_id": "R-PLB-001", "version": 9})
    assert "look like" in err(knowledge.server, "get_rule", {"rule_id": "../R-PLB-001"})
