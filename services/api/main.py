"""KrishiLoop API: plan with signed receipts, public verifier, recall, DID document, officer inbox, demo sandboxes.

Run:  PUBLIC_BASE_URL=https://<host> KRISHILOOP_ISSUER_SEED=... ADMIN_TOKEN=... uvicorn services.api.main:app

Demo sandboxes: every visitor session gets its own status list, recall registry and inbox, signed with the same
issuer key. A judge's recall changes only that judge's receipts; the official list (/status/1) is untouched.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
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
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from jsonschema import Draft202012Validator
from pydantic import BaseModel, Field
from referencing import Registry, Resource

try:   # optional: the Kuzu provenance graph (requirements-dev.txt); a recall works without it
    from services import graph as graph_mod
except ImportError:  # pragma: no cover
    graph_mod = None
from services.engine import events, inbox
from services.engine import snapshot as snap_mod
from services.engine.planner import DEMO_FIELDS, DEMO_PROFILES, make_plan
from services.engine.rules import REGISTRY, load_pack, pack_parameters
from services.trust.store import CRED_ID, ROOT, TrustStore
from services.vision import backbone as vision_backbone
from services.vision.ledger import LedgerError
from services.vision.service import PhotoService

WEB = Path(__file__).resolve().parent / "web"
VC_MEDIA = "application/vc"
PLAN_LIMIT_PER_MIN = 20
ASK_CACHE_MAX = 2000
SANDBOX_TTL_S, SANDBOX_MAX = 24 * 3600, 200
SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
                               "style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
}
app = FastAPI(title="KrishiLoop API", version="0.4.0")


@app.on_event("startup")
def _warm_photo_model() -> None:
    """Load the photo model in the background at start, so the first photo and area lookups do not wait for it."""
    bb = vision_backbone.load()
    if bb is not None:
        bb.warm()


@app.on_event("startup")
def _warm_ask_router() -> None:
    """Build the Ask index (and load its text models, if installed) in the background, so the first question is quick."""
    def warm():
        try:
            from services.ask import graph as ask_graph
            ask_graph.get_router()
        except Exception:   # the first question or GET /api/ask/health reports the problem instead
            pass
    threading.Thread(target=warm, daemon=True).start()


_store: TrustStore | None = None
_plan_cache: dict[tuple, dict] = {}   # (store, field, profile, day) -> plan: no new credentials on every click
_ask_cache: "OrderedDict[tuple, dict]" = OrderedDict()   # same question, same day: same answer, no second inbox case
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
    diagnosis: dict | None = None                   # a client's report: recorded, never trusted
    photo_case_id: str | None = Field(default=None, pattern=r"^pc-[0-9a-f]{16}$")   # the server's own reading


class PhotoRequest(BaseModel):
    field_id: str = Field(max_length=64)
    image_b64: str = Field(max_length=4_000_000)    # about 3 MB; the app sends a resized JPEG
    consent: bool = False                           # may the officer see the photo?


class VerdictRequest(BaseModel):
    label: str = Field(max_length=40)


class RecallRequest(BaseModel):
    rule_id: str = Field(pattern=r"^R-[A-Z]{2,8}-[0-9]{3}$")
    version: int = Field(ge=1)
    reason: str = Field(default="", max_length=500)


class ResolveRequest(BaseModel):
    note: str = Field(max_length=1000)


class AskRequest(BaseModel):
    field_id: str = Field(max_length=64)
    profile_id: str = Field(max_length=64)
    question: str = Field(min_length=1, max_length=500)
    lang: str = Field(default="en", pattern=r"^[a-z]{2,3}$")


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
    sb = {"store": st, "inbox": _demo_dir(sid) / "inbox", "dir": _demo_dir(sid), "created": created}
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


def _plan(st: TrustStore, body: PlanRequest, request: Request, inbox_dir: Path | None, photos: PhotoService | None = None):
    field, profile = DEMO_FIELDS.get(body.field_id), DEMO_PROFILES.get(body.profile_id)
    if not field or not profile:
        raise HTTPException(404, "unknown demo field or profile")
    diagnosis, from_server = body.diagnosis, False
    if body.diagnosis is not None:
        errors = [e.message for e in DIAGNOSIS_VALIDATOR.iter_errors(body.diagnosis)]
        if errors:
            raise HTTPException(422, {"diagnosis": errors[:5]})
    if body.photo_case_id:
        if photos is None:
            raise HTTPException(404, "photo cases are available in demo sessions only, for now")
        try:
            diagnosis, from_server = photos.diagnosis_for(body.photo_case_id, field), True
        except LedgerError as e:
            raise HTTPException(409, str(e))
    key = (st.status_id, body.field_id, body.profile_id, date.today().isoformat())
    with _lock:
        cached = _plan_cache.get(key)
    if cached and diagnosis is None:
        return cached
    if _rate_limited(request.client.host if request.client else "unknown"):
        raise HTTPException(429, "too many plan requests; try again in a minute")
    result = make_plan(field, profile, st, inbox_dir=inbox_dir, diagnosis=diagnosis, diagnosis_from_server=from_server)
    reach.issue_codes(st, result)   # Reach: a short verify code per receipt (see the Reach block)
    if diagnosis is None:
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
        for k in [k for k in _ask_cache if k[0] == st.status_id]:
            _ask_cache.pop(k)   # and so may cached answers
    events.publish(events.scope_of_status(st.status_id), "recall",
                   {"rule_id": body.rule_id, "version": body.version, "credentials": len(hits)})   # no reason text, no holders
    out = {"recalled_rule_credentials": hits,
           "note": "receipts that used this rule version now verify as 'recalled'; the planner no longer serves it",
           "notified": reach.on_recall(st, body.rule_id, body.version)}   # Reach: notices to the receipts' holders
    if graph_mod is not None:   # the provenance graph (Kuzu) lists the receipts it touches; the status list stays the truth
        out["graph_blast_radius"] = graph_mod.blast_radius_for_store(st.dir, body.rule_id, body.version)
    return out


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


def _photo_service(sb: dict) -> PhotoService:
    bb = vision_backbone.load()
    if bb is None:
        raise HTTPException(503, "the photo model is not installed on this server")
    with _lock:
        svc = sb.get("photo")
        if svc is None or svc.model != bb.model:
            svc = sb["photo"] = PhotoService(sb["store"], sb["dir"] / "photo", bb.model, lambda: bb.sha256, bb.labels, bb.T,
                                             bb.features)
    return svc


@app.post("/api/demo/{sid}/photo")
def demo_photo(sid: str, body: PhotoRequest, request: Request):
    """A farmer's photo in a demo session: suggested, frozen in the area's ledger, routed to the officer or answered."""
    sb, field = _sandbox(sid), DEMO_FIELDS.get(body.field_id)
    if not field:
        raise HTTPException(404, "unknown demo field")
    if _rate_limited(request.client.host if request.client else "unknown"):
        raise HTTPException(429, "too many requests; try again in a minute")
    try:
        image = base64.b64decode(body.image_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "image_b64 is not base64")
    svc = _photo_service(sb)
    try:
        return svc.submit(field, image, body.consent)
    except vision_backbone.PhotoModelUnavailable:   # a remote photo worker is down or starting: not the farmer's fault
        raise HTTPException(503, "the photo model is not reachable right now; try again in a minute")
    except (OSError, ValueError):
        raise HTTPException(422, "not a readable image")


@app.get("/api/demo/{sid}/photo/cases")
def demo_photo_cases(sid: str):
    return {"cases": _photo_service(_sandbox(sid)).list_cases()}


@app.get("/api/demo/{sid}/photo/{case_id}/image")
def demo_photo_image(sid: str, case_id: str):
    """The farmer's photo for the officer: only with consent, only until the verdict."""
    from fastapi.responses import Response
    try:
        return Response(_photo_service(_sandbox(sid)).photo(case_id), media_type="image/jpeg",
                        headers={"Cache-Control": "no-store"})
    except LedgerError:
        raise HTTPException(404, "no photo for this case")


@app.post("/api/demo/{sid}/photo/{case_id}/verdict")
def demo_photo_verdict(sid: str, case_id: str, body: VerdictRequest):
    """In a demo session the visitor plays the officer. Real verdicts will need the officer's sign-in."""
    svc = _photo_service(_sandbox(sid))
    try:
        return svc.judge(case_id, body.label, by=f"demo-officer:{sid[:6]}")
    except LedgerError as e:
        raise HTTPException(409, str(e))


@app.get("/api/demo/{sid}/areas/{area}")
def demo_area(sid: str, area: str):
    if not re.fullmatch(r"[a-z0-9_]+@[A-Za-z0-9_-]+", area):
        raise HTTPException(404, "unknown area")
    return _photo_service(_sandbox(sid)).area(area)


REPLAY = ROOT / "ml" / "vision" / "artifacts" / "area_trust_replay.json"


@app.get("/api/replay/area-trust")
def area_trust_replay():
    """Earned-trust curves replayed from public CC BY rice datasets (ml/vision/analysis/earned_trust_sim_v2.py --curves).
    The datasets' labels stand in for officers' verdicts; the payload says so in its own words."""
    if not REPLAY.exists():
        raise HTTPException(404, "no replay has been generated on this server")
    return json.loads(REPLAY.read_text(encoding="utf-8"))


@app.post("/api/demo/{sid}/plan")
def demo_plan(sid: str, body: PlanRequest, request: Request):
    sb = _sandbox(sid)
    return _plan(sb["store"], body, request, sb["inbox"], _photo_service(sb) if body.photo_case_id else None)


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


# ---------------------------------------------------------------- Ask router (services/ask/: LangGraph, rule text only)
def _ask_router():
    """Loaded on first use (LangGraph, the index and any installed text models). Without LangGraph there is no router."""
    try:
        from services.ask import graph as ask_graph
    except ImportError:
        raise HTTPException(503, "the Ask router needs LangGraph (requirements-dev.txt)")
    return ask_graph.get_router()


@app.post("/api/demo/{sid}/ask")
def demo_ask(sid: str, body: AskRequest, request: Request):
    """A farmer's question: one sourced rule's validated text with a signed receipt, or a case in the officer's inbox."""
    sb = _sandbox(sid)
    return _ask(sb["store"], sb["inbox"], body, request.client.host if request.client else "unknown")


def _ask(st: TrustStore, inbox_dir: Path | None, body: AskRequest, client: str) -> dict:
    """The Ask pipeline behind every channel: the demo route above and the Telegram bot (services/reach/)."""
    field, profile = DEMO_FIELDS.get(body.field_id), DEMO_PROFILES.get(body.profile_id)
    if not field or not profile:
        raise HTTPException(404, "unknown demo field or profile")
    question = body.question.strip()
    if not question:
        raise HTTPException(422, "the question is empty")
    key = (st.status_id, body.field_id, body.profile_id, body.lang,
           hashlib.sha256(question.encode("utf-8")).hexdigest(), date.today().isoformat())
    with _lock:
        cached = _ask_cache.get(key)
    if cached:
        return cached
    if _rate_limited(client):
        raise HTTPException(429, "too many requests; try again in a minute")
    result = _ask_router().ask(question, body.lang, field, profile, st, inbox_dir=inbox_dir)
    reach.issue_codes(st, result)   # Reach: a short verify code per receipt (see the Reach block)
    with _lock:
        _ask_cache[key] = result
        while len(_ask_cache) > ASK_CACHE_MAX:
            _ask_cache.popitem(last=False)
    return result


@app.get("/api/ask/health")
def ask_health():
    """Which Ask retrieval stages are active here (bm25 / dense / rerank), the models and licences, and why a stage is off."""
    return _ask_router().health()


# ---------------------------------------------------------------- BEGIN voice block (P1 #13; code in services/voice_proxy/)
# GET /api/voice/health and POST /api/voice/asr: speech to text on our own voice service (KRISHILOOP_VOICE_URL, loopback
# only). Off (503) when the variable is not set.
from services.voice_proxy import router as voice_router  # noqa: E402

app.include_router(voice_router)
# ---------------------------------------------------------------- END voice block


# ---------------------------------------------------------------- BEGIN Reach block (P1 #14; code in services/reach/)
# Short verify codes (GET /api/code/{code}, GET /api/credentials/{id}/code), sandbox SMS (POST /api/demo/{sid}/reach/sms;
# written to an outbox, never sent), recall notices to receipt holders (the "notified" summary of a recall) and the
# Telegram bot (long polling; starts only when TELEGRAM_BOT_TOKEN is set). Hooks above: _plan, _ask and _recall.
import sys as _sys  # noqa: E402

from services.reach.service import Reach  # noqa: E402

reach = Reach(_sys.modules[__name__])
app.include_router(reach.router)


@app.on_event("startup")
def _start_reach_bot() -> None:
    reach.start_telegram()


@app.on_event("shutdown")
def _stop_reach_bot() -> None:
    reach.stop_telegram()
# ---------------------------------------------------------------- END Reach block


# ---------------------------------------------------------------- BEGIN KrishiGuard block (builder R; services/engine/climate*.py, radar*.py)
# Climate-Smart Shield (GET /api/climate: next-7-day warnings from the plan's own snapshot, citing sourced rules),
# village outbreak radar (GET /api/radar: k-anonymous cells, k=3 devices, plus a SIMULATED scenario kept apart;
# POST /api/demo/{sid}/radar/warn: a fixed notice through services/reach to this session's holders in that area) and
# "ask an officer to visit or call" (POST /api/demo/{sid}/visit: an officer-inbox case, phone stored masked only).
from datetime import datetime as _dt, timezone as _tz  # noqa: E402

from services.engine import climate as climate_mod, climate_visit, radar as radar_mod  # noqa: E402
from services.engine.planner import MAX_SNAPSHOT_AGE_H as _MAX_SNAPSHOT_AGE_H  # noqa: E402


class WarnRequest(BaseModel):
    area: str = Field(pattern=r"^[A-Z]{2}-[a-z0-9-]{1,40}$")
    problem: str = Field(pattern=r"^[a-z0-9_]{1,60}$")
    layer: str = Field(default="real", pattern=r"^(real|simulated)$")


class VisitRequest(BaseModel):
    field_id: str = Field(max_length=64)
    profile_id: str = Field(max_length=64)
    date: str = Field(max_length=10)
    slot: str = Field(max_length=12)
    mode: str = Field(default="visit", max_length=8)
    phone: str | None = Field(default=None, max_length=24)
    note: str = Field(default="", max_length=400)
    lang: str = Field(default="en", pattern=r"^(en|bn|hi|sw)$")


def _find_snapshot(snapshot_id: str) -> dict | None:
    for p in (snap_mod.SNAP_DIR.glob("*.json") if snap_mod.SNAP_DIR.exists() else []):
        try:
            snap = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if snap.get("snapshot_id") == snapshot_id:
            return snap
    return None


@app.get("/api/climate")
def climate(field_id: str, snapshot_id: str, profile_id: str = "", sid: str = ""):
    """The shield for the forecast a plan used (its snapshot_id). A rule recalled in this session's sandbox is never cited."""
    field = DEMO_FIELDS.get(field_id)
    if not field:
        raise HTTPException(404, "unknown demo field")
    snap = _find_snapshot(snapshot_id)
    if not snap or snap.get("field_id") != field_id:
        raise HTTPException(404, "unknown snapshot")
    sb = _load_sandbox(sid) if sid else None
    st = sb["store"] if sb else store()
    return climate_mod.shield(snap, field, DEMO_PROFILES.get(profile_id), is_recalled=st.is_recalled,
                              max_age_h=_MAX_SNAPSHOT_AGE_H)


def _radar_now() -> "_dt":
    return _dt.now(_tz.utc).replace(microsecond=0)


@app.get("/api/radar")
def radar(request: Request):
    """Real reports on this server (every demo session counts as one device), k-anonymous; and the SIMULATED scenario,
    aggregated on its own. Only the areas and counts of cells with at least k devices leave the server."""
    if _rate_limited("radar:" + (request.client.host if request.client else "unknown")):
        raise HTTPException(429, "too many requests; try again in a minute")
    now = _radar_now()
    real = radar_mod.aggregate(radar_mod.collect(ROOT / "data" / "demo", inbox.INBOX_DIR, DEMO_FIELDS, now), now)
    return {"real": real, "simulated": radar_mod.simulated(now),
            "field_areas": {fid: radar_mod.field_area(f) for fid, f in DEMO_FIELDS.items()},
            "reporter": "a device: one demo session counts once, whatever fields or farmers it used"}


@app.post("/api/demo/{sid}/radar/warn")
def radar_warn(sid: str, body: WarnRequest, request: Request):
    sb = _sandbox(sid)
    if _rate_limited(request.client.host if request.client else "unknown"):
        raise HTTPException(429, "too many requests; try again in a minute")
    now = _radar_now()
    agg = radar_mod.simulated(now) if body.layer == "simulated" else \
        radar_mod.aggregate(radar_mod.collect(ROOT / "data" / "demo", inbox.INBOX_DIR, DEMO_FIELDS, now), now)
    c = radar_mod.cell(agg, body.area, body.problem)
    if not c:
        raise HTTPException(409, f"no cell shown for this area and problem (fewer than {radar_mod.K_MIN} devices reported it)")
    from services.reach.senders import TelegramSender
    senders = {"sms": reach.outbox(), "telegram": TelegramSender(reach.telegram_transport())}
    return radar_mod.warn(reach.db(), sb["store"], c, body.layer == "simulated", DEMO_FIELDS, senders, now.date().isoformat())


@app.post("/api/demo/{sid}/visit")
def demo_visit(sid: str, body: VisitRequest, request: Request):
    sb = _sandbox(sid)
    if body.field_id not in DEMO_FIELDS or body.profile_id not in DEMO_PROFILES:
        raise HTTPException(404, "unknown demo field or profile")
    if _rate_limited(request.client.host if request.client else "unknown"):
        raise HTTPException(429, "too many requests; try again in a minute")
    try:
        return climate_visit.create(body.field_id, body.profile_id, body.model_dump(), sb["inbox"], lang=body.lang)
    except climate_visit.VisitError as e:
        raise HTTPException(422, str(e))
# ---------------------------------------------------------------- END KrishiGuard block


# ---------------------------------------------------------------- BEGIN AgriTriage block (builder P; services/vision/agritriage.py)
# The owner's AgriTriage-Lite student, on the server, on the farmer's own uploaded photo (the same ONNX and gate the
# phone runs). Photo-trust policy v2 decides: a receipt (via the planner, citing this reading and the signed model
# credential), "take a clearer photo" (shortlist), or the officer. The phone's own reading is stored for agreement only.
from services.vision import agritriage as agritriage_mod  # noqa: E402


class TriageRequest(BaseModel):
    field_id: str = Field(max_length=64)
    image_b64: str = Field(max_length=4_000_000)
    consent: bool = False                           # may the server keep the photo for the officer?
    any_crop: bool = False                          # the farmer chose "any crop" instead of the field's crop
    client: dict | None = None                      # the phone's reading: recorded for agreement, never trusted


class TriagePlanRequest(BaseModel):
    profile_id: str = Field(max_length=64)


class TriageVerdictRequest(BaseModel):
    label: str = Field(max_length=80)


class ModelRecallRequest(BaseModel):
    reason: str = Field(default="", max_length=500)


def _triage(sb: dict):
    try:
        with _lock:
            svc = sb.get("agritriage")
            if svc is None:
                svc = sb["agritriage"] = agritriage_mod.AgriTriageService(sb["store"], sb["dir"] / "agritriage")
        return svc
    except (OSError, ImportError) as e:
        raise HTTPException(503, f"the AgriTriage photo model is not available on this server ({type(e).__name__})")


@app.post("/api/demo/{sid}/agritriage")
def demo_triage(sid: str, body: TriageRequest, request: Request):
    sb, field = _sandbox(sid), DEMO_FIELDS.get(body.field_id)
    if not field:
        raise HTTPException(404, "unknown demo field")
    if _rate_limited(request.client.host if request.client else "unknown"):
        raise HTTPException(429, "too many requests; try again in a minute")
    try:
        image = base64.b64decode(body.image_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "image_b64 is not base64")
    svc = _triage(sb)
    try:
        case = svc.submit(field, image, body.consent, any_crop=body.any_crop, client=body.client)
    except LedgerError as e:
        raise HTTPException(409, str(e))
    except (OSError, ValueError):
        raise HTTPException(422, "not a readable image")
    return {"case": case, "area": svc.area(case["area"]), "model": svc.model_info()}


@app.post("/api/demo/{sid}/agritriage/{case_id}/plan")
def demo_triage_plan(sid: str, case_id: str, body: TriagePlanRequest, request: Request):
    """The weekly plan with this photo case's server reading: the photo-keyed practice gets its receipt."""
    sb = _sandbox(sid)
    svc = _triage(sb)
    try:
        case = svc.case(case_id)
    except LedgerError:
        raise HTTPException(404, "unknown photo case")
    return _plan(sb["store"], PlanRequest(field_id=case["field_id"], profile_id=body.profile_id, photo_case_id=case_id),
                 request, sb["inbox"], svc)


@app.post("/api/demo/{sid}/agritriage/{case_id}/escalate")
def demo_triage_escalate(sid: str, case_id: str):
    try:
        return _triage(_sandbox(sid)).escalate(case_id)
    except LedgerError as e:
        raise HTTPException(409, str(e))


@app.get("/api/demo/{sid}/agritriage/cases")
def demo_triage_cases(sid: str):
    return {"cases": _triage(_sandbox(sid)).list_cases()}


@app.get("/api/demo/{sid}/agritriage/model")
def demo_triage_model(sid: str):
    return _triage(_sandbox(sid)).model_info()


@app.get("/api/demo/{sid}/agritriage/areas/{area}")
def demo_triage_area(sid: str, area: str):
    if not re.fullmatch(r"[a-z0-9_]+@[A-Za-z0-9_-]+", area):
        raise HTTPException(404, "unknown area")
    return _triage(_sandbox(sid)).area(area)


@app.get("/api/demo/{sid}/agritriage/{case_id}/image")
def demo_triage_image(sid: str, case_id: str):
    from fastapi.responses import Response
    try:
        return Response(_triage(_sandbox(sid)).photo(case_id), media_type="image/jpeg", headers={"Cache-Control": "no-store"})
    except LedgerError:
        raise HTTPException(404, "no photo for this case")


@app.get("/api/demo/{sid}/agritriage/{case_id}/heat")
def demo_triage_heat(sid: str, case_id: str):
    """The server's occlusion map (where hiding the leaf lowers the top class most), on the kept photo only."""
    try:
        return _triage(_sandbox(sid)).heat(case_id)
    except LedgerError:
        raise HTTPException(404, "no photo for this case")


@app.post("/api/demo/{sid}/agritriage/{case_id}/verdict")
def demo_triage_verdict(sid: str, case_id: str, body: TriageVerdictRequest):
    try:
        return _triage(_sandbox(sid)).judge(case_id, body.label, by=f"demo-officer:{sid[:6]}")
    except LedgerError as e:
        raise HTTPException(409, str(e))


class TriageHeatRequest(BaseModel):
    field_id: str = Field(max_length=64)
    image_b64: str = Field(max_length=4_000_000)
    any_crop: bool = False
    target: str = Field(max_length=80)              # the class to explain (the phone's top class)


@app.post("/api/demo/{sid}/agritriage/heat")
def demo_triage_heat_once(sid: str, body: TriageHeatRequest, request: Request):
    """'Show where' on the server (the farmer asked for it): the occlusion map of the posted photo. The photo is used once
    for this answer and never written to disk; nothing is recorded in any case or ledger."""
    sb, field = _sandbox(sid), DEMO_FIELDS.get(body.field_id)
    if not field:
        raise HTTPException(404, "unknown demo field")
    if _rate_limited(request.client.host if request.client else "unknown"):
        raise HTTPException(429, "too many requests; try again in a minute")
    try:
        image = base64.b64decode(body.image_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "image_b64 is not base64")
    svc = _triage(sb)
    if body.target not in svc.model.classes:
        raise HTTPException(422, "unknown class")
    crop = None if body.any_crop else svc.model_crop(field)
    try:
        return {**svc.model.heat(image, crop, body.target), "where": "server", "kept": False}
    except (OSError, ValueError):
        raise HTTPException(422, "not a readable image")


@app.post("/api/demo/{sid}/agritriage/recall-model")
def demo_triage_recall(sid: str, body: ModelRecallRequest):
    """Recall the photo model in this sandbox: every receipt that cited its readings verifies as recalled."""
    sb = _sandbox(sid)
    hits = agritriage_mod.recall_model(sb["store"], body.reason, actor=f"demo-session-{sid}")
    return {"recalled_model_credentials": hits, "model": agritriage_mod.MODEL,
            "note": "receipts that used this model's readings now verify as 'recalled'; it gives no new receipts"}
# ---------------------------------------------------------------- END AgriTriage block


# ---------------------------------------------------------------- live events (Server-Sent Events)
# GET /api/events?sid=<demo session>: new officer-inbox cases, recalls and photo-ledger events as they happen, from the
# in-process hub (services/engine/events.py). Events hold ids and codes only; the client refetches what it shows.
# A demo sandbox's stream needs no token (the sandbox is the visitor's own, like its inbox endpoint). The official
# stream (no sid) needs the admin token in the X-Admin-Token header, as the official inbox does.
SSE_HEARTBEAT_S = 15.0


def _sse(ev: dict) -> str:
    return f"id: {ev['id']}\nevent: {ev['event']}\ndata: {json.dumps({**ev['data'], 'at': ev['at']}, separators=(',', ':'))}\n\n"


@app.get("/api/events")
async def live_events(request: Request, sid: str = "", x_admin_token: str = Header(default="")):
    if sid:
        if not re.fullmatch(r"[0-9a-f]{16}", sid):
            raise HTTPException(404, "unknown demo session")
        scope = sid
    else:
        _admin(x_admin_token)
        scope = events.OFFICIAL
    if _rate_limited("events:" + (request.client.host if request.client else "unknown")):
        raise HTTPException(429, "too many requests; try again in a minute")
    sub = events.subscribe(scope)
    if sub is None:
        raise HTTPException(503, "too many live listeners; try again later")

    async def stream():
        try:
            yield "retry: 3000\n\nevent: ready\ndata: {}\n\n"
            while True:
                try:
                    ev = await asyncio.wait_for(sub.queue.get(), timeout=SSE_HEARTBEAT_S)
                    yield _sse(ev)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            sub.close()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- simple pages
@app.get("/", response_class=HTMLResponse)
def home():
    return FileResponse(WEB / "index.html")


@app.get("/verify/{cred_id}", response_class=HTMLResponse)
def verify_page(cred_id: str):
    return FileResponse(WEB / "verify.html")
