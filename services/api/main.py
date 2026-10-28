"""KrishiLoop API: plan with signed receipts, public verifier, recall, DID document, officer inbox, demo sandboxes.

Run:  PUBLIC_BASE_URL=https://<host> KRISHILOOP_ISSUER_SEED=... ADMIN_TOKEN=... uvicorn services.api.main:app

Demo sandboxes: every visitor session gets its own status list, recall registry and inbox, signed with the same
issuer key. A judge's recall changes only that judge's receipts; the official list (/status/1) is untouched.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import threading
import time
import uuid
from collections import OrderedDict, defaultdict, deque
from datetime import date
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from jsonschema import Draft202012Validator
from pydantic import BaseModel, Field
from referencing import Registry, Resource

from services.engine import inbox
from services.engine import snapshot as snap_mod
from services.engine.planner import DEMO_FIELDS, DEMO_PROFILES, make_plan
from services.engine.rules import REGISTRY, load_pack, pack_parameters
from services.trust.store import CRED_ID, ROOT, TrustStore

WEB = Path(__file__).resolve().parent / "web"
VC_MEDIA = "application/vc"
PLAN_LIMIT_PER_MIN = 20
SANDBOX_TTL_S, SANDBOX_MAX = 24 * 3600, 200
SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
                               "style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
}
app = FastAPI(title="KrishiLoop API", version="0.4.0")
_store: TrustStore | None = None
_plan_cache: dict[tuple, dict] = {}   # (store, field, profile, day) -> plan: no new credentials on every click
_hits: dict[str, deque] = defaultdict(deque)
_sandboxes: "OrderedDict[str, dict]" = OrderedDict()
_lock = threading.Lock()


def _schema_validator(name: str) -> Draft202012Validator:
    reg, schemas = Registry(), {}
    for p in (ROOT / "contracts" / "schemas").glob("*.schema.json"):
        s = json.loads(p.read_text(encoding="utf-8")); schemas[p.name] = s
        reg = reg.with_resource(s["$id"], Resource.from_contents(s))
    return Draft202012Validator(schemas[name], registry=reg)


DIAGNOSIS_VALIDATOR = _schema_validator("diagnosis.schema.json")


class PlanRequest(BaseModel):
    field_id: str = Field(max_length=64)
    profile_id: str = Field(max_length=64)
    diagnosis: dict | None = None


class RecallRequest(BaseModel):
    rule_id: str = Field(pattern=r"^R-[A-Z]{2,8}-[0-9]{3}$")
    version: int = Field(ge=1)
    reason: str = Field(default="", max_length=500)


class ResolveRequest(BaseModel):
    note: str = Field(max_length=1000)


def store() -> TrustStore:
    global _store
    if _store is None:
        _store = TrustStore.from_env(os.environ.get("PUBLIC_BASE_URL", "http://localhost:8000"))
    return _store


def _admin(token: str) -> None:
    expected = os.environ.get("ADMIN_TOKEN", "")
    if not expected or not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(403, "admin token required")


def _rate_limited(client: str) -> bool:
    now = time.monotonic()
    with _lock:
        q = _hits[client]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= PLAN_LIMIT_PER_MIN:
            return True
        q.append(now)
    return False


def _rule_exists(rule_id: str, version: int) -> bool:
    return any(r["rule_id"] == rule_id and r["version"] == version
               for pack in REGISTRY.iterdir() if pack.is_dir() for r in load_pack(pack.name))


def _demo_dir(sid: str) -> Path:
    return ROOT / "data" / "demo" / sid


def _open_sandbox(sid: str, created: float) -> dict:
    base = store()
    st = TrustStore(base.base_url, base.issuer.did, os.environ["KRISHILOOP_ISSUER_SEED"], data_dir=_demo_dir(sid) / "trust",
                    status_id=f"demo-{sid}")
    sb = {"store": st, "inbox": _demo_dir(sid) / "inbox", "created": created}
    with _lock:
        _sandboxes[sid] = sb
        while len(_sandboxes) > SANDBOX_MAX:
            _sandboxes.popitem(last=False)
    return sb


def _load_sandbox(sid: str) -> dict | None:
    """Sessions survive a server restart: they are reopened from disk while younger than the TTL."""
    if not re.fullmatch(r"[0-9a-f]{16}", sid or ""):
        return None
    with _lock:
        sb = _sandboxes.get(sid)
    if sb:
        return sb if time.time() - sb["created"] <= SANDBOX_TTL_S else None
    state = _demo_dir(sid) / "trust" / "state.json"
    if not state.exists():
        return None
    created = _demo_dir(sid).stat().st_ctime
    return _open_sandbox(sid, created) if time.time() - created <= SANDBOX_TTL_S else None


def _sandbox(sid: str) -> dict:
    sb = _load_sandbox(sid)
    if not sb:
        raise HTTPException(404, "unknown or expired demo session")
    return sb


def _store_for(cred_id: str) -> TrustStore | None:
    """The official store or the demo sandbox that issued a credential (reopening a sandbox from disk if needed)."""
    if store().has(cred_id):
        return store()
    with _lock:
        live = [sb["store"] for sb in _sandboxes.values()]
    for st in live:
        if st.has(cred_id):
            return st
    m = CRED_ID.match(cred_id or "")
    if m:
        for path in (ROOT / "data" / "demo").glob(f"*/trust/creds/{str(uuid.UUID(m.group(1)))}.json"):
            sb = _load_sandbox(path.parents[2].name)
            if sb and sb["store"].has(cred_id):
                return sb["store"]
    return None


def _plan(st: TrustStore, body: PlanRequest, request: Request, inbox_dir: Path | None):
    field, profile = DEMO_FIELDS.get(body.field_id), DEMO_PROFILES.get(body.profile_id)
    if not field or not profile:
        raise HTTPException(404, "unknown demo field or profile")
    if body.diagnosis is not None:
        errors = [e.message for e in DIAGNOSIS_VALIDATOR.iter_errors(body.diagnosis)]
        if errors:
            raise HTTPException(422, {"diagnosis": errors[:5]})
    key = (st.status_id, body.field_id, body.profile_id, date.today().isoformat())
    with _lock:
        cached = _plan_cache.get(key)
    if cached and body.diagnosis is None:
        return cached
    if _rate_limited(request.client.host if request.client else "unknown"):
        raise HTTPException(429, "too many plan requests; try again in a minute")
    result = make_plan(field, profile, st, inbox_dir=inbox_dir, diagnosis=body.diagnosis)
    if body.diagnosis is None:
        with _lock:
            _plan_cache[key] = result
    return result


def _recall(st: TrustStore, body: RecallRequest, actor: str) -> dict:
    if not _rule_exists(body.rule_id, body.version):
        raise HTTPException(404, "unknown rule version")
    hits = st.recall_rule(body.rule_id, body.version, body.reason, actor=actor)
    with _lock:
        for k in [k for k in _plan_cache if k[0] == st.status_id]:
            _plan_cache.pop(k)  # cached plans may contain the recalled rule
    return {"recalled_rule_credentials": hits,
            "note": "receipts that used this rule version now verify as 'recalled'; the planner no longer serves it"}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.update(SECURITY_HEADERS)
    return response


# ---------------------------------------------------------------- public: identity, status, verification
@app.get("/health")
def health():
    return {"ok": True, "issuer": store().issuer.did}


@app.get("/.well-known/did.json")
def did_document():
    return store().did_document()


@app.get("/status/{status_id}")
def status_list(status_id: str):
    if status_id == store().status_id:
        return JSONResponse(store().status.credential(), media_type=VC_MEDIA)
    sb = _load_sandbox(status_id[5:]) if status_id.startswith("demo-") else None
    if sb:
        return JSONResponse(sb["store"].status.credential(), media_type=VC_MEDIA)
    raise HTTPException(404, "unknown status list")


@app.get("/api/credentials/{cred_id}")
def credential(cred_id: str):
    st = _store_for(cred_id)
    if not st:
        raise HTTPException(404, "unknown credential")
    return JSONResponse(st.get(cred_id), media_type=VC_MEDIA)


@app.get("/api/verify/{cred_id}")
def verify(cred_id: str):
    """authentic | recalled | invalid, plus the verified credential (pages render only signed content)."""
    st = _store_for(cred_id)
    if not st:
        return {"status": "invalid", "reason": "unknown credential"}
    return {**st.verify(cred_id), "sandbox": st.status_id != "1", "status_list": st.status.url}


# ---------------------------------------------------------------- official API
@app.get("/api/demo")
def demo():
    return {"fields": list(DEMO_FIELDS.values()), "profiles": list(DEMO_PROFILES.values()),
            "public_base_url": store().base_url}


@app.post("/api/plan")
def plan(body: PlanRequest, request: Request):
    return _plan(store(), body, request, None)


@app.post("/api/admin/recall")
def recall(body: RecallRequest, x_admin_token: str = Header(default="")):
    _admin(x_admin_token)
    return _recall(store(), body, "admin")


@app.get("/api/inbox")
def officer_inbox(x_admin_token: str = Header(default="")):
    _admin(x_admin_token)  # officer accounts are planned; the admin token stands in for now
    return {"items": inbox.list_items()}


@app.get("/api/inbox/{item_id}")
def officer_inbox_item(item_id: str, x_admin_token: str = Header(default="")):
    _admin(x_admin_token)
    try:
        return inbox.get_item(item_id)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "unknown inbox item")


@app.post("/api/inbox/{item_id}/resolve")
def officer_resolve(item_id: str, body: ResolveRequest, x_admin_token: str = Header(default="")):
    _admin(x_admin_token)
    try:
        return inbox.resolve(item_id, body.note, "officer (admin token)")
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "unknown inbox item")


@app.get("/api/stats")
def stats():
    st = store()
    return {**st.stats(), "inbox_open": sum(i["status"] == "open" for i in inbox.list_items())}


@app.get("/api/snapshots/{snapshot_id}")
def snapshot(snapshot_id: str):
    """The field snapshot behind a plan, with a per-day late-blight weather risk from the same reviewer-set thresholds."""
    for p in (snap_mod.SNAP_DIR.glob("*.json") if snap_mod.SNAP_DIR.exists() else []):
        snap = json.loads(p.read_text(encoding="utf-8"))
        if snap.get("snapshot_id") != snapshot_id:
            continue
        field = DEMO_FIELDS.get(snap.get("field_id"), {})
        params = pack_parameters(field["pack_id"]) if field.get("pack_id") else {}
        rh_min = float(params.get("humid_rh_pct_min", 90))
        lo, hi = snap_mod._range(params.get("mild_temp_c_range", "10-25"))
        for d in (snap.get("forecast") or {}).get("days") or []:
            if any(d.get(k) is None for k in ("rh_mean_pct", "tmin_c", "tmax_c")):
                d["risk"] = "unknown"
            else:
                d["risk"] = "high" if d["rh_mean_pct"] >= rh_min and lo <= d["tmin_c"] and d["tmax_c"] <= hi else "low"
        snap["risk_basis"] = "humid and mild day by team-set thresholds (not from a source; pathologist review pending)"
        return snap
    raise HTTPException(404, "unknown snapshot")


@app.get("/api/packs")
def packs():
    out = []
    for pack in sorted(p.name for p in REGISTRY.iterdir() if p.is_dir()):
        rules = load_pack(pack)
        out.append({"pack_id": pack, "crops": sorted({r.get("crop", "") for r in rules}), "rules": len(rules),
                    "review_levels": dict(sorted({lvl: sum(r.get("review", {}).get("level") == lvl for r in rules)
                                                  for lvl in {r.get("review", {}).get("level", "pending") for r in rules}}.items())),
                    "signatures": "planned (Knowledge Compiler not built yet)"})
    return {"packs": out}


@app.get("/api/packs/{pack_id}/signatures")
def pack_signatures(pack_id: str):
    if pack_id not in {p.name for p in REGISTRY.iterdir() if p.is_dir()}:
        raise HTTPException(404, "unknown pack")
    return {"pack_id": pack_id, "signatures": [], "status": "planned: symptom signatures come from the Knowledge Compiler"}


# ---------------------------------------------------------------- demo sandboxes (no tokens; isolated per visitor)
@app.post("/api/demo/session")
def demo_session():
    sid = uuid.uuid4().hex[:16]
    st = _open_sandbox(sid, time.time())["store"]
    return {"session_id": sid, "status_list": st.status.url, "expires_in_s": SANDBOX_TTL_S,
            "note": "sandbox: recalls here affect only this session's receipts"}


@app.post("/api/demo/{sid}/plan")
def demo_plan(sid: str, body: PlanRequest, request: Request):
    sb = _sandbox(sid)
    return _plan(sb["store"], body, request, sb["inbox"])


@app.post("/api/demo/{sid}/recall")
def demo_recall(sid: str, body: RecallRequest):
    sb = _sandbox(sid)
    return _recall(sb["store"], body, f"demo-session-{sid}")


@app.get("/api/demo/{sid}/inbox")
def demo_inbox(sid: str):
    return {"items": inbox.list_items(_sandbox(sid)["inbox"])}


@app.get("/api/demo/{sid}/stats")
def demo_stats(sid: str):
    sb = _sandbox(sid)
    return {**sb["store"].stats(), "inbox_open": sum(i["status"] == "open" for i in inbox.list_items(sb["inbox"]))}


# ---------------------------------------------------------------- simple pages
@app.get("/", response_class=HTMLResponse)
def home():
    return FileResponse(WEB / "index.html")


@app.get("/verify/{cred_id}", response_class=HTMLResponse)
def verify_page(cred_id: str):
    return FileResponse(WEB / "verify.html")
