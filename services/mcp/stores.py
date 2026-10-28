"""Where KrishiLoop's trust data lives, found the way the API finds it (services/api/main.py): the official store in
data/trust/<issuer>, and one folder per demo session in data/demo/<session>, which is unknown once older than the
API's time to live.

Only folders that already exist are read or opened, so nothing here creates a file. Plain state (recalls, status-list
counters, the area-trust index) is read as JSON and needs no secret. Opening a TrustStore, which is needed to verify or
to rebuild the signed status list, needs the issuer seed from the environment; the seed is never logged or echoed.

Environment: PUBLIC_BASE_URL and ISSUER_DID (as for the API), KRISHILOOP_ISSUER_SEED, and KRISHILOOP_DATA_DIR (default
<repo>/data, the folder the API writes).
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from pathlib import Path

from mcp.server.mcpserver.exceptions import ToolError

from services.trust.store import CRED_ID, ROOT, TrustStore, did_from_base_url

DATA_DIR = Path(os.environ.get("KRISHILOOP_DATA_DIR") or ROOT / "data")
SANDBOX_TTL_S = 24 * 3600   # as services/api/main.py (tests/test_mcp.py keeps the two equal)
SESSION_ID = re.compile(r"^[0-9a-f]{16}$")
SEED_MISSING = "this needs KRISHILOOP_ISSUER_SEED, which is not set in this server's environment"


def identity() -> tuple[str, str]:
    """(public base URL, issuer DID), as the API derives them."""
    base = os.environ.get("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
    return base, os.environ.get("ISSUER_DID", did_from_base_url(base))


def official_dir() -> Path:
    return DATA_DIR / "trust" / re.sub(r"[^A-Za-z0-9._-]+", "_", identity()[1])   # TrustStore's default folder


def sandbox_dir(session_id: str) -> Path | None:
    """A live demo session's folder; expired sessions are unknown, as in the API."""
    d = DATA_DIR / "demo" / session_id
    if not SESSION_ID.fullmatch(session_id) or not (d / "trust" / "state.json").exists():
        return None
    return d if time.time() - d.stat().st_ctime <= SANDBOX_TTL_S else None


def scope(session_id: str | None) -> tuple[Path, str, Path | None]:
    """(trust folder, status-list id, photo folder or None) for the official store or a live demo session."""
    if session_id is None:
        return official_dir(), "1", None
    d = sandbox_dir(session_id)
    if d is None:
        raise ToolError("unknown or expired demo session")
    return d / "trust", f"demo-{session_id}", d / "photo"


def read_state(trust_dir: Path) -> dict:
    """A store's plain state, or {} if there is no store there. It must belong to this server's issuer."""
    p = trust_dir / "state.json"
    if not p.exists():
        return {}
    state = json.loads(p.read_text(encoding="utf-8"))
    return state if state.get("did") == identity()[1] else {}


def locate(cred_id: str) -> tuple[Path, str] | None:
    """(trust folder, status-list id) of the store holding a credential: the official one, then live sandboxes."""
    m = CRED_ID.match(cred_id or "")
    if not m:
        return None
    name = f"{uuid.UUID(m.group(1))}.json"
    official = official_dir()
    if read_state(official) and (official / "creds" / name).exists():
        return official, "1"
    for path in sorted((DATA_DIR / "demo").glob(f"*/trust/creds/{name}")):
        d = sandbox_dir(path.parents[2].name)
        if d and read_state(d / "trust"):
            return d / "trust", f"demo-{d.name}"
    return None


def open_store(trust_dir: Path, status_id: str) -> TrustStore | None:
    """Open an existing store (never create one). Needs the issuer seed."""
    seed = os.environ.get("KRISHILOOP_ISSUER_SEED")
    if not seed:
        raise ToolError(SEED_MISSING)
    if not read_state(trust_dir):
        return None
    base, did = identity()
    try:
        return TrustStore(base, did, seed, data_dir=trust_dir, status_id=status_id)
    except Exception:      # a malformed seed; say nothing about its value
        raise ToolError("KRISHILOOP_ISSUER_SEED is malformed (expected 64 hex characters)") from None
