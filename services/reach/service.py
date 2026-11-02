"""Reach, mounted on the API (services/api/main.py, in its "Reach" block): endpoints, hooks and the Telegram bot.

`host` is the API module itself. Its helpers (store(), _store_for, _load_sandbox, _ask, verify, _rate_limited) are
looked up at call time, so a test that swaps the API's store or ROOT swaps Reach's too.

Endpoints
- GET  /api/code/{code}                   short code -> credential id (any case, no dash, O/0 and I/L/1 typos);
                                          404 "unknown code" for anything else, with nothing more said
- GET  /api/credentials/{id}/code         a receipt's short code, its /v/ link and its SMS text (en, bn)
- POST /api/demo/{sid}/reach/sms          sandbox SMS of a receipt to a number: written to the outbox, NOT sent;
                                          the number is kept so a recall can notify it
- GET  /api/reach/health                  is the Telegram bot polling; SMS mode (sandbox)
Hooks: issue_codes() after a plan or an answer is issued; on_recall() after a recall (both the admin and demo routes).
"""
from __future__ import annotations

import logging
import os
import re
import threading
from datetime import timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from services.reach import codes as code_mod
from services.reach import notify
from services.reach.db import ReachDB
from services.reach.senders import SANDBOX_NOTE, SandboxSender, TelegramSender, mask
from services.reach.sms import LANGS, receipt_sms, sms_info, verify_link
from services.reach.telegram import Bot, HttpTransport

log = logging.getLogger("krishiloop.reach")
TOKEN_ENV = "TELEGRAM_BOT_TOKEN"
_PHONE = re.compile(r"^\+?[0-9]{8,15}$")


class SmsRequest(BaseModel):
    credential_id: str = Field(max_length=80)
    phone: str = Field(max_length=24)
    lang: str = Field(default="en", pattern=r"^(en|bn)$")


def receipt_ids(result) -> list[str]:
    """Every receipt credential id in a plan or Ask answer (actions[].receipt_credential_id, answer.receipt_...)."""
    out: list[str] = []

    def walk(x, depth=0):
        if depth > 6:
            return
        if isinstance(x, dict):
            v = x.get("receipt_credential_id")
            if isinstance(v, str) and v.startswith("urn:uuid:") and v not in out:
                out.append(v)
            for k, y in x.items():
                if k not in ("receipt", "retrieval", "pipeline"):
                    walk(y, depth + 1)
        elif isinstance(x, list):
            for y in x:
                walk(y, depth + 1)
    walk(result)
    return out


class Reach:
    def __init__(self, host):
        self.host = host
        self._dbs: dict[Path, ReachDB] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._transport: HttpTransport | None = None
        self.router = APIRouter()
        self._routes()

    # ------------------------------------------------------------------ where things live
    def db(self) -> ReachDB:
        """data/trust/<issuer>/reach/reach.sqlite3 (beside the issuer's store), or KRISHILOOP_REACH_DB."""
        env = os.environ.get("KRISHILOOP_REACH_DB")
        path = Path(env) if env else self.host.store().dir / "reach" / "reach.sqlite3"
        with self._lock:
            if path not in self._dbs:
                self._dbs[path] = ReachDB(path)
            return self._dbs[path]

    def outbox(self) -> SandboxSender:
        return SandboxSender(self.db().path.parent / "sms_outbox.jsonl")

    def public_base(self) -> str:
        return self.host.store().base_url

    def telegram_transport(self) -> HttpTransport | None:
        token = os.environ.get(TOKEN_ENV, "").strip()
        if not token:
            return None
        if self._transport is None:
            try:
                self._transport = HttpTransport(token)
            except ValueError:
                log.warning("%s is set but does not look like a bot token; Telegram stays off", TOKEN_ENV)
                return None
        return self._transport

    # ------------------------------------------------------------------ hooks called by the API
    def issue_codes(self, st, result) -> None:
        """A short code for every receipt just issued (idempotent). A failure here never fails the plan or answer."""
        try:
            db = self.db()
            for cid in receipt_ids(result):
                db.issue_code(cid, st.status_id)
        except Exception as e:
            log.warning("short codes not issued: %s", type(e).__name__)

    def on_recall(self, st, rule_id: str, version: int) -> dict:
        """Notify every holder of a receipt in `st` that cites the recalled rule version; the officer's summary."""
        try:
            senders = {"sms": self.outbox(), "telegram": TelegramSender(self.telegram_transport())}
            return notify.fan_out(self.db(), st, rule_id, version, self.public_base(), senders)
        except Exception as e:      # the recall itself already happened; say plainly that notices did not go out
            log.warning("recall notices failed: %s", type(e).__name__)
            return {"total": 0, "telegram": 0, "sms_sandbox": 0, "sms_sent": 0, "failed": 0, "receipts": 0,
                    "error": f"notices could not be sent ({type(e).__name__})"}

    # ------------------------------------------------------------------ the bot
    def start_telegram(self) -> bool:
        """Start long polling in a daemon thread if TELEGRAM_BOT_TOKEN is set (and KRISHILOOP_TELEGRAM is not off)."""
        if os.environ.get("KRISHILOOP_TELEGRAM", "").strip().lower() == "off":
            log.info("Telegram bot off (KRISHILOOP_TELEGRAM=off)")
            return False
        transport = self.telegram_transport()
        if transport is None:
            log.info("Telegram bot off: %s is not set", TOKEN_ENV)
            return False
        if self._thread and self._thread.is_alive():
            return True
        bot = Bot(transport, HostBackend(self), self.db())
        self._stop.clear()
        self._thread = threading.Thread(target=bot.run, args=(self._stop,), daemon=True, name="krishiloop-telegram")
        self._thread.start()
        return True

    def stop_telegram(self) -> None:
        self._stop.set()

    # ------------------------------------------------------------------ endpoints
    def _routes(self) -> None:
        r = self.router

        @r.get("/api/code/{code}")
        def resolve_code(code: str, request: Request):
            if self.host._rate_limited("code:" + (request.client.host if request.client else "unknown")):
                raise HTTPException(429, "too many requests; try again in a minute")
            cid = self.db().resolve(code)
            if not cid:
                raise HTTPException(404, "unknown code")
            canon = code_mod.normalize(code)
            return {"code": code_mod.display(canon), "credential_id": cid,
                    "verify_path": f"/verify/{cid.removeprefix('urn:uuid:')}",
                    "note": "a lookup handle, not a proof: the signature check decides"}

        @r.get("/api/credentials/{cred_id}/code")
        def credential_code(cred_id: str):
            st, cred = self._receipt(cred_id)
            code = self.db().issue_code(cred["id"], st.status_id)   # receipts issued before Reach get one now
            base = self.public_base()
            sms = {lang: {"text": (t := receipt_sms(cred, lang, code, base)), **sms_info(t)} for lang in LANGS}
            return {"code": code_mod.display(code), "credential_id": cred["id"], "verify_url": verify_link(base, code),
                    "sms": sms, "sms_note": SANDBOX_NOTE}

        @r.post("/api/demo/{sid}/reach/sms")
        def demo_sms(sid: str, body: SmsRequest, request: Request):
            sb = self.host._sandbox(sid)
            if self.host._rate_limited(request.client.host if request.client else "unknown"):
                raise HTTPException(429, "too many requests; try again in a minute")
            phone = re.sub(r"[\s\-().]", "", body.phone)
            if not _PHONE.match(phone):
                raise HTTPException(422, "phone must be 8 to 15 digits, optionally starting with +")
            st, cred = self._receipt(body.credential_id)
            if st is not sb["store"]:
                raise HTTPException(404, "unknown credential in this session")
            db = self.db()
            db.purge_demo(timedelta(seconds=self.host.SANDBOX_TTL_S))
            code = db.issue_code(cred["id"], st.status_id)
            db.add_holder(st.status_id, cred["id"], "sms", phone, body.lang)
            text = receipt_sms(cred, body.lang, code, self.public_base())
            d = self.outbox().send(phone, text, {"credential_id": cred["id"], "kind": "receipt"})
            return {"status": d.status, "note": SANDBOX_NOTE, "to": mask(phone), "code": code_mod.display(code),
                    "text": text, **sms_info(text)}

        @r.get("/api/reach/health")
        def reach_health():
            return {"telegram": {"token_set": bool(os.environ.get(TOKEN_ENV, "").strip()),
                                 "polling": bool(self._thread and self._thread.is_alive()),
                                 "mode": "long polling (no webhook)"},
                    "sms": SANDBOX_NOTE}

    def _receipt(self, cred_id: str):
        st = self.host._store_for(cred_id)
        if not st:
            raise HTTPException(404, "unknown credential")
        try:
            cred = st.get(cred_id if cred_id.startswith("urn:uuid:") else f"urn:uuid:{cred_id}")
        except (FileNotFoundError, ValueError):
            raise HTTPException(404, "unknown credential")
        if "AdviceReceiptCredential" not in cred.get("type", []):
            raise HTTPException(404, "not an advice receipt")
        return st, cred


class HostBackend:
    """The bot's view of the API: the same Ask pipeline (main._ask) and the same verifier (main.verify)."""

    def __init__(self, reach: Reach):
        self.reach = reach

    @property
    def host(self):
        return self.reach.host

    def field_profile(self) -> tuple[str, str]:
        fields, profiles = self.host.DEMO_FIELDS, self.host.DEMO_PROFILES
        return (os.environ.get("REACH_FIELD_ID") or next(iter(fields)),
                os.environ.get("REACH_PROFILE_ID") or next(iter(profiles)))

    def field_label(self) -> str:
        return self.field_profile()[0]

    def session_exists(self, sid: str) -> bool:
        return self.host._load_sandbox(sid) is not None

    def ask(self, chat: dict, question: str) -> dict:
        from services.reach.messages import say
        h, unlinked, sb = self.host, False, None
        if chat.get("sid"):
            sb = h._load_sandbox(chat["sid"])
            if not sb:     # the linked demo session expired: back to the main service, and say so
                self.reach.db().save_chat(chat["chat_id"], chat["lang"], sid=None, keep_sid=False)
                unlinked = True
        st, inbox_dir = (sb["store"], sb["inbox"]) if sb else (h.store(), None)
        field_id, profile_id = self.field_profile()
        try:
            body = h.AskRequest(field_id=field_id, profile_id=profile_id, question=question.strip()[:500] or "?",
                                lang=chat["lang"])
            result = h._ask(st, inbox_dir, body, f"telegram:{chat['chat_id']}")
        except HTTPException as e:
            return {"kind": "busy" if e.status_code == 429 else "unavailable", "unlinked": unlinked}
        except Exception as e:      # the farmer gets a plain "not available", never silence
            log.warning("Telegram question failed: %s", type(e).__name__)
            return {"kind": "unavailable", "unlinked": unlinked}
        if result.get("status") == "ok":
            a = result["answer"]
            code = self.reach.db().issue_code(a["receipt_credential_id"], st.status_id)
            return {"kind": "answer", "text": a["text"], "rule": f"{a['rule_id']} v{a['rule_version']}",
                    "code": code_mod.display(code), "url": verify_link(self.reach.public_base(), code),
                    "credential_id": a["receipt_credential_id"], "store_id": st.status_id,
                    "sandbox": sb is not None, "notice": (a.get("lang_notice") or {}).get(chat["lang"]),
                    "unlinked": unlinked}
        reason = (result.get("abstention") or {}).get("reason") or {}
        msg = reason.get(chat["lang"]) or (reason.get("en") if chat["lang"] == "en" else say(chat["lang"], "abstained"))
        return {"kind": "abstained", "message": msg, "unlinked": unlinked}

    def verify(self, typed_code: str) -> dict:
        from services.reach.sms import rule_label
        code = code_mod.normalize(typed_code)
        cid = self.reach.db().resolve(typed_code) if code else None
        if not cid:
            return {"status": "unknown_code", "code": code_mod.display(code) if code else typed_code[:16]}
        v = self.host.verify(cid)
        subject = (v.get("credential") or {}).get("credentialSubject") or {}
        return {"status": v.get("status", "invalid"), "reason": v.get("reason", ""), "rules": v.get("rules"),
                "expired": v.get("expired", False), "sandbox": v.get("sandbox", False), "rule": rule_label(subject),
                "code": code_mod.display(code), "url": verify_link(self.reach.public_base(), code)}
