"""Exercise every tool of KrishiLoop's five MCP servers through the MCP protocol, as an outside client would.

    python tools/mcp_demo_client.py            # stdio: each server is launched as a subprocess
    python tools/mcp_demo_client.py --http     # streamable HTTP: each server is started on 127.0.0.1

Weather and satellite calls reach the public APIs (Open-Meteo, Earth Search, Planetary Computer), so this needs the
internet. The receipts, rules and photo-trust servers read a DEMO FIXTURE built in a temporary folder, never the real
trust store:
- a throwaway issuer key (generated here, passed only to the receipts server in its environment, never printed);
- one plan for the sample Kenyan location (no farmer) from a live forecast, with its signed receipts;
- an area ledger filled with SYNTHETIC photo features and scripted officer verdicts (as in tests/test_photo_service.py),
  only to exercise the photo-trust tools; it is not evidence about any model.
The recall in the middle is made through the trust store, as the API's admin endpoint does: recall is not an MCP tool.
The replay (trust_replay) is the committed one, from public datasets; it is read as it is.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
from mcp import Client, StdioServerParameters  # noqa: E402
from mcp.client.stdio import get_default_environment  # noqa: E402

from services.engine import snapshot as snap_mod  # noqa: E402
from services.engine.planner import DEMO_FIELDS, DEMO_PROFILES, make_plan, trust_area  # noqa: E402
from services.trust.store import TrustStore, did_from_base_url  # noqa: E402
from services.vision.service import PhotoService  # noqa: E402

BASE = "http://localhost:8000"
PORTS = {"weather": 8101, "satellite": 8102, "receipts": 8103, "rules": 8104, "photo_trust": 8105}
LABELS = ["healthy", "blast", "brown_spot"]
DIRS = np.random.RandomState(0).randn(3, 16)


def say(text: str = "") -> None:
    print(text, flush=True)


def brief(value, limit: int = 160) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit - 3] + "..."


# ---------------------------------------------------------------- the fixture
def build_fixture(tmp: Path, seed: str) -> dict:
    """A throwaway official store with one live-forecast plan, and a demo sandbox with a synthetic area ledger."""
    did = did_from_base_url(BASE)
    official = TrustStore(BASE, did, seed, data_dir=tmp / "trust" / re.sub(r"[^A-Za-z0-9._-]+", "_", did))  # its default
    field = DEMO_FIELDS["KE-SAMPLE-01"]
    snap = snap_mod.build(field, cache_dir=tmp / "snapshots")
    plan = make_plan(field, DEMO_PROFILES["demo-farmer-a"], official, snap=snap, inbox_dir=tmp / "inbox")
    fixture = {"official": official, "plan": plan, "field": field}

    sid = secrets.token_hex(8)
    sandbox = TrustStore(BASE, did, seed, data_dir=tmp / "demo" / sid / "trust", status_id=f"demo-{sid}")

    def fake_features(image: bytes) -> np.ndarray:
        label, n = image.decode().split(":")
        return DIRS[LABELS.index(label)] + 0.15 * np.random.RandomState(int(n)).randn(16)
    model = "synthetic-leaf@fixture"
    svc = PhotoService(sandbox, tmp / "demo" / sid / "photo", model, "0" * 64, LABELS,
                       DIRS + 0.6 * np.random.RandomState(1).randn(3, 16), fake_features)
    photo_field = DEMO_FIELDS["BD-SAMPLE-02"]
    for i in range(80):
        case = svc.submit(photo_field, f"{LABELS[i % 3]}:{i}".encode(), consent=False)
        if case["route"] == "officer":
            event = svc.judge(case["case_id"], LABELS[i % 3], "scripted-officer")["event"] or {}
            if event.get("event") == "opened":
                break
    area = trust_area(photo_field)
    fixture.update(session_id=sid, area=area, area_credential=sandbox.trusted_photo_model(model, area))
    return fixture


# ---------------------------------------------------------------- servers
def free_port(preferred: int) -> int:
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", preferred))
        except OSError:
            s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Servers:
    """Connect to a server over stdio, or start it over streamable HTTP and connect to its URL."""

    def __init__(self, http: bool, env: dict[str, dict]):
        self.http, self.env, self.procs = http, env, []

    def client(self, name: str) -> Client:
        module, env = f"services.mcp.{name}", {**get_default_environment(), **self.env.get(name, {})}
        if not self.http:
            return Client(StdioServerParameters(command=sys.executable, args=["-m", module], cwd=str(ROOT), env=env))
        port = free_port(PORTS[name])
        self.procs.append(subprocess.Popen([sys.executable, "-m", module, "--transport", "http", "--port", str(port)],
                                           cwd=str(ROOT), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            with socket.socket() as s:
                if s.connect_ex(("127.0.0.1", port)) == 0:
                    break
            time.sleep(0.2)
        return Client(f"http://127.0.0.1:{port}/mcp")

    def close(self) -> None:
        for p in self.procs:
            p.kill()
            p.wait(timeout=10)


async def call(c: Client, tool: str, args: dict) -> dict:
    say(f"-> {tool} {json.dumps(args)}")
    r = await c.call_tool(tool, args)
    if r.is_error:
        say(f"   error: {r.content[0].text}")
        return {}
    return r.structured_content


async def header(c: Client, name: str, transport: str) -> None:
    tools = (await c.list_tools()).tools
    say(f"\n== {name} over {transport}: {len(tools)} tools, all readOnlyHint="
        f"{all(t.annotations.read_only_hint for t in tools)}, destructiveHint={any(t.annotations.destructive_hint for t in tools)}")
    say("   " + ", ".join(f"{t.name}{' (web)' if t.annotations.open_world_hint else ''}" for t in tools))


# ---------------------------------------------------------------- the demo
async def weather(c: Client, field: dict, transport: str) -> None:
    await header(c, "krishiloop-weather", transport)
    pack = field["pack_id"]
    out = await call(c, "weather_parameters", {"pack_id": pack})
    for fact, b in out.get("facts", {}).items():
        params = ", ".join(f"{p['name']}={p.get('value')}{p.get('unit', '')} ({p.get('set_by', '?')})" for p in b["parameters"])
        rules = ", ".join(f"{x['rule_id']} {x['op']} {x['value']}" for x in b["read_by_rule_conditions"])
        say(f"   {fact}: {params}; read by {rules}")
    out = await call(c, "forecast_snapshot", {"lat": field["lat"], "lon": field["lon"], "pack_id": pack, "include_flood": True})
    if out:
        say(f"   data_mode={out['data_mode']} data_as_of={out['data_as_of']} stale_for_planner={out['stale_for_planner']} "
            f"source={out['source']['forecast']} window_from={out['window']['from']}")
        say("   facts: " + ", ".join(f"{f}={v['value']}" for f, v in out["facts"].items())
            + f"; flood trend={(out.get('flood') or {}).get('trend')}")
        d = out["days"][0]
        say(f"   day 1 of {len(out['days'])}: {brief(d)}")
        say(f"   note: {out['note']}")


async def satellite(c: Client, field: dict, transport: str) -> None:
    await header(c, "krishiloop-satellite", transport)
    out = await call(c, "list_collections", {})
    for k, v in out.get("providers", {}).items():
        say(f"   {k}: {', '.join(v['collections'])}")
    bbox = [round(field["lon"] - 0.05, 4), round(field["lat"] - 0.05, 4), round(field["lon"] + 0.05, 4), round(field["lat"] + 0.05, 4)]
    end = date.today()
    start = end - timedelta(days=30)
    s2 = await call(c, "search_scenes", {"bbox": bbox, "start_date": start.isoformat(), "end_date": end.isoformat(),
                                         "collection": "sentinel-2-l2a", "provider": "earth-search", "max_cloud_cover": 40,
                                         "limit": 3})
    for s in s2.get("scenes", []):
        say(f"   {s['id']}  {s['datetime']}  cloud={s.get('cloud_cover_pct')}%  tile={s.get('tile')}")
    if s2:
        say(f"   returned={s2['returned']} matched={s2['matched']} more_available={s2['more_available']}")
    s1 = await call(c, "search_scenes", {"bbox": bbox, "start_date": start.isoformat(), "end_date": end.isoformat(),
                                         "collection": "sentinel-1-rtc", "provider": "planetary-computer", "limit": 2})
    for s in s1.get("scenes", []):
        say(f"   {s['id']}  {s['datetime']}  {s.get('instrument_mode')} {s.get('polarizations')} orbit={s.get('orbit_state')}")
    if s2.get("scenes"):
        meta = await call(c, "scene_metadata", {"scene_id": s2["scenes"][0]["id"], "collection": "sentinel-2-l2a"})
        if meta:
            p = meta["properties"]
            say(f"   {meta['id']}: {len(p)} properties, {len(meta['assets'])} assets; processing baseline "
                f"{p.get('s2:processing_baseline')}, vegetation {p.get('s2:vegetation_percentage')}%")
            say(f"   asset access: {meta['asset_access']}")


async def receipts(c: Client, fx: dict, transport: str) -> None:
    await header(c, "krishiloop-receipts", transport)
    plan = fx["plan"]
    say(f"   [fixture] plan for {fx['field']['field_id']} (sample location, no farmer): status={plan['status']}, "
        f"data_mode={plan['data_mode']}")
    action = (plan.get("actions") or [None])[0]
    if action:
        cred, ref = action["receipt_credential_id"], action["receipt"]["rule_refs"][0]
        fx["rule_ref"] = ref
        v = await call(c, "verify_credential", {"credential_id": cred})
        say(f"   status={v.get('status')} sandbox={v.get('sandbox')}: {v.get('reason')}")
        g = await call(c, "get_credential", {"credential_id": cred})
        if g:
            subject = g["credential"]["credentialSubject"]
            say(f"   {g['type']} issued by {g['credential']['issuer']}; advice: {brief(subject['advice']['title']['en'], 90)}")
            say(f"   rule refs: {[(r['rule_id'], r['version']) for r in subject['rule_refs']]}; "
                f"sources: {[(s['doc_id'], s['page']) for s in subject['sources']]}")
        s = await call(c, "status_list_info", {})
        say(f"   {s.get('status_list')}: entries used={s.get('entries_used')} revoked={s.get('entries_revoked')} "
            f"recalled={s.get('recalled_rule_versions')}")
        fx["official"].recall_rule(ref["rule_id"], ref["version"], "demo: admin recall, outside MCP")
        say(f"   [fixture] the admin recalls {ref['rule_id']} v{ref['version']} through the trust store (not an MCP tool)")
        v = await call(c, "verify_credential", {"credential_id": cred})
        say(f"   status={v.get('status')}: {v.get('reason')}")
        s = await call(c, "status_list_info", {"include_credential": True})
        say(f"   entries revoked={s.get('entries_revoked')}; recalled: "
            + ", ".join(f"{r['rule_version']} at {r['at']} ({r['reason']})" for r in s.get("recalled_rule_versions", []))
            + f"; signed list: {(s.get('credential') or {}).get('type')}")
    v = await call(c, "verify_credential", {"credential_id": "urn:uuid:00000000-0000-4000-8000-000000000000"})
    say(f"   status={v.get('status')}: {v.get('reason')}")
    if fx.get("area_credential"):
        say("   [fixture] the area photo-trust credential below comes from a SYNTHETIC ledger (see photo-trust)")
        v = await call(c, "verify_credential", {"credential_id": fx["area_credential"]})
        say(f"   status={v.get('status')} sandbox={v.get('sandbox')}: {brief(v.get('reason', ''), 120)}")


async def rules(c: Client, fx: dict, transport: str) -> None:
    await header(c, "krishiloop-rules", transport)
    out = await call(c, "list_packs", {})
    for p in out.get("packs", []):
        say(f"   {p['pack_id']}: crops={p['crops']} rules={p['rule_count']} review={p['review_levels']} "
            f"pack_tests_passed={p['pack_tests']['passed']} sources={[d['doc_id'] for d in p['source_documents']]}")
    out = await call(c, "search_rules", {"query": "spray forecast", "limit": 5})
    if out:
        say(f"   {out['total']} rules match every word:")
        for r in out["rules"]:
            say(f"   {r['rule_id']} v{r['version']} {r['pack_id']} {r['kind']}/{r.get('decision')} "
                f"matched_in={r['matched_in']} sources={r['sources']}")
    ref = fx.get("rule_ref") or {"rule_id": "R-PLB-008", "version": 1}
    rule = await call(c, "get_rule", {"rule_id": ref["rule_id"], "version": ref["version"]})
    if rule:
        s = rule["sources"][0]
        say(f"   {rule['rule_id']} v{rule['version']} ({rule['action']['kind']}, {rule['action'].get('traffic_light')}): "
            f"{brief(rule['action']['title']['en'], 110)}")
        say(f"   source: {s['doc_id']} p.{s['page']} [{s['licence_status']}] \"{brief(s['quote'], 110)}\"")
        say(f"   review: {rule['review'].get('level')}; parameters: {[p['name'] for p in rule['reviewer_parameters']]}; "
            f"recall in official store: {brief(rule['recall_in_official_store'] or 'none', 100)}")


async def photo_trust(c: Client, fx: dict, transport: str) -> None:
    await header(c, "krishiloop-photo-trust", transport)
    say("   [fixture] SYNTHETIC area ledger: fake photo features and scripted officer verdicts, only to exercise the tools")
    out = await call(c, "list_areas", {"session_id": fx["session_id"]})
    for a in out.get("areas", []):
        say(f"   {a['area']} {a['model']}: verdicts={a['verdicts']} gate_open={a['gate_open']} trust_stands={a['trust_stands']}")
    a = await call(c, "area_photo_trust", {"area": fx["area"], "session_id": fx["session_id"]})
    for m in a.get("models", []):
        lg = m["ledger"] or {}
        say(f"   {m['model']}: gate_open={lg.get('gate_open')} verdicts={lg.get('verdicts')} "
            f"sure_right={lg.get('sure_right_in_window')}/{lg.get('sure_in_window')} lower_bound={lg.get('lower_bound')} "
            f"trust_stands={m['trust_stands']}")
    if a:
        say(f"   {a['summary']}")
        say(f"   policy v{a['policy']['version']} ({a['policy']['status']}): open at lower bound >= "
            f"{a['policy']['open_lower_bound']}, close below {a['policy']['close_lower_bound']}")
    a = await call(c, "area_photo_trust", {"area": fx["area"]})
    say(f"   {a.get('summary')}")
    r = await call(c, "trust_replay", {})
    if r:
        say(f"   note (from the replay file): {r['note']}")
        for name, s in r["areas"].items():
            say(f"   {name}: photos={s['photos']} verdicts_until_open={s['confirmations_until_open']} "
                f"auto_answers={s['auto_answers']} auto_precision={s['auto_precision']} closings={s['gate_closings']}")
        first = next(iter(r["areas"]))
        curve = await call(c, "trust_replay", {"area": first})
        if curve:
            pts = curve["curve"]["points"]
            say(f"   {first} curve: {len(pts)} points, fields={curve['curve']['fields']}; last={pts[-1]}")


async def demo(http: bool) -> None:
    transport = "streamable HTTP" if http else "stdio"
    tmp = Path(tempfile.mkdtemp(prefix="krishiloop-mcp-demo-"))
    seed = secrets.token_hex(32)   # throwaway; never printed
    data = {"KRISHILOOP_DATA_DIR": str(tmp), "PUBLIC_BASE_URL": BASE}
    servers = Servers(http, {"receipts": {**data, "KRISHILOOP_ISSUER_SEED": seed}, "rules": data, "photo_trust": data})
    try:
        say(f"KrishiLoop MCP demo client: transport={transport}, {date.today().isoformat()}")
        fx = build_fixture(tmp, seed)
        async with servers.client("weather") as c:
            await weather(c, fx["field"], transport)
        async with servers.client("satellite") as c:
            await satellite(c, fx["field"], transport)
        async with servers.client("receipts") as c:
            await receipts(c, fx, transport)
        async with servers.client("rules") as c:
            await rules(c, fx, transport)
        async with servers.client("photo_trust") as c:
            await photo_trust(c, fx, transport)
    finally:
        servers.close()
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")   # Bangla rule text on a Windows console
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--http", action="store_true", help="use streamable HTTP instead of stdio")
    asyncio.run(demo(ap.parse_args().http))


if __name__ == "__main__":
    main()
