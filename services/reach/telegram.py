"""The KrishiLoop Telegram bot: Bot API over HTTPS with LONG POLLING. No webhook: nothing on our machines is public.

Commands
- /start [session]  pick the language (bn or en). An optional deep-link payload (a demo session id) links the chat to
                    that web demo session, so a recall made in that session's officer console reaches this chat.
- /bn, /en          switch language
- any other text    a question, through the SAME Ask pipeline as POST /api/demo/{sid}/ask (main._ask): the validated rule
                    text with the receipt's short code and verify link, or the abstention message (the question went
                    to the officer)
- /verify CODE      Authentic, Recalled or Cannot verify, from the same verifier code as GET /api/verify/{id}
- /stop             deletes this chat's data (chat id, language, receipt ids)
Recall notices are pushed by services/reach/notify.py through TelegramSender.

The token comes from env TELEGRAM_BOT_TOKEN only. It is never printed, logged or put in an error message: errors carry
the method name and Telegram's own description, never the URL. Without a token the bot does not start.

Personal data kept (services/reach/db.py): chat id, language, receipt ids. Group chats are ignored.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import urllib.error
import urllib.request
from typing import Any, Protocol

from services.reach import codes as code_mod
from services.reach.db import ReachDB
from services.reach.messages import say

API = "https://api.telegram.org"
POLL_TIMEOUT_S = 25
log = logging.getLogger("krishiloop.reach.telegram")
_SID = re.compile(r"^(?:s_)?([0-9a-f]{16})$")


class TelegramError(Exception):
    """A Bot API failure. `safe` is the only text it carries: method, HTTP status and Telegram's description."""

    def __init__(self, method: str, safe: str, network: bool = False, status: int | None = None,
                 retry_after: int | None = None):
        super().__init__(f"{method}: {safe}")
        self.safe, self.network, self.status, self.retry_after = f"{method}: {safe}", network, status, retry_after


class Transport(Protocol):
    def call(self, method: str, params: dict, timeout: float | None = None) -> Any: ...


class HttpTransport:
    """The real Bot API. The token lives only in this object; repr() and errors never show it."""

    def __init__(self, token: str, timeout: float = 10):
        if not token or not re.fullmatch(r"[0-9]{5,16}:[A-Za-z0-9_-]{30,64}", token.strip()):
            raise ValueError("TELEGRAM_BOT_TOKEN does not look like a bot token")
        self.__token = token.strip()
        self.timeout = timeout

    def __repr__(self) -> str:
        return "HttpTransport(token hidden)"

    def call(self, method: str, params: dict, timeout: float | None = None) -> Any:
        req = urllib.request.Request(f"{API}/bot{self.__token}/{method}", data=json.dumps(params).encode("utf-8"),
                                     headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as r:
                body = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                body = json.loads(e.read().decode("utf-8"))
            except Exception:
                body = {}
            raise TelegramError(method, f"HTTP {e.code} {str(body.get('description', ''))[:200]}".strip(), status=e.code,
                                retry_after=(body.get("parameters") or {}).get("retry_after")) from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            raise TelegramError(method, f"network ({type(e).__name__})", network=True) from None
        if not body.get("ok"):
            raise TelegramError(method, str(body.get("description", "not ok"))[:200])
        return body.get("result")


class Backend(Protocol):
    """What the bot needs from the API process (service.HostBackend; a fake in tests)."""

    def ask(self, chat: dict, question: str) -> dict: ...

    def verify(self, typed_code: str) -> dict: ...

    def session_exists(self, sid: str) -> bool: ...

    def field_label(self) -> str: ...


def _lang_of(user: dict | None) -> str:
    return "bn" if str((user or {}).get("language_code", "")).lower().startswith("bn") else "en"


LANG_KEYBOARD = {"inline_keyboard": [[{"text": "বাংলা", "callback_data": "lang:bn"},
                                      {"text": "English", "callback_data": "lang:en"}]]}


class Bot:
    def __init__(self, transport: Transport, backend: Backend, db: ReachDB):
        self.transport, self.backend, self.db = transport, backend, db
        self.offset: int | None = None

    # ------------------------------------------------------------------ sending
    def send(self, chat_id: str, text: str, **extra) -> None:
        self.transport.call("sendMessage", {"chat_id": chat_id, "text": text, "disable_web_page_preview": True, **extra})

    # ------------------------------------------------------------------ updates
    def handle(self, update: dict) -> None:
        if "callback_query" in update:
            return self._callback(update["callback_query"])
        msg = update.get("message")
        if not msg or (msg.get("chat") or {}).get("type") != "private":
            return                                       # groups and channels: not ours to read
        chat_id = str(msg["chat"]["id"])
        text = (msg.get("text") or "").strip()
        chat = self.db.chat(chat_id)
        lang = chat["lang"] if chat else _lang_of(msg.get("from"))
        if not text:
            return self.send(chat_id, say(lang, "text_only"))
        if text.startswith("/"):
            cmd, _, arg = text.partition(" ")
            return self._command(chat_id, chat, lang, cmd.split("@", 1)[0].lower(), arg.strip(), msg.get("from"))
        if not chat:
            return self.send(chat_id, say(lang, "need_start"), reply_markup=LANG_KEYBOARD)
        return self._question(chat, text)

    def _command(self, chat_id: str, chat: dict | None, lang: str, cmd: str, arg: str, user: dict | None) -> None:
        if cmd == "/start":
            sid, note = None, None
            m = _SID.match(arg)
            if m:
                if self.backend.session_exists(m.group(1)):
                    sid, note = m.group(1), "linked"
                else:
                    note = "link_unknown"
            elif chat:
                sid = chat.get("sid")
            self.db.save_chat(chat_id, lang, sid=sid, keep_sid=False)
            if note:
                self.send(chat_id, say(lang, note))
            return self.send(chat_id, say(lang, "pick"), reply_markup=LANG_KEYBOARD)
        if cmd in ("/bn", "/en"):
            return self._set_lang(chat_id, cmd[1:])
        if cmd == "/stop":
            self.db.forget("telegram", chat_id)
            return self.send(chat_id, say(lang, "stopped"))
        if cmd == "/verify":
            return self._verify(chat_id, lang, arg)
        return self.send(chat_id, say(lang, "help"))

    def _callback(self, cq: dict) -> None:
        data = str(cq.get("data", ""))
        msg = cq.get("message") or {}
        chat_id = str((msg.get("chat") or {}).get("id", ""))
        try:
            self.transport.call("answerCallbackQuery", {"callback_query_id": cq.get("id")})
        except TelegramError:
            pass
        if chat_id and (msg.get("chat") or {}).get("type") == "private" and data in ("lang:bn", "lang:en"):
            self._set_lang(chat_id, data[5:])

    def _set_lang(self, chat_id: str, lang: str) -> None:
        self.db.save_chat(chat_id, lang)
        self.send(chat_id, say(lang, "lang_set") + "\n\n" + say(lang, "welcome", field=self.backend.field_label()))

    def _question(self, chat: dict, text: str) -> None:
        lang, chat_id = chat["lang"], chat["chat_id"]
        r = self.backend.ask(chat, text[:500])
        if r.get("unlinked"):
            self.send(chat_id, say(lang, "link_unknown"))
        if r["kind"] == "answer":
            self.db.add_holder(r["store_id"], r["credential_id"], "telegram", chat_id, lang)
            out = say(lang, "answer", text=r["text"], rule=r["rule"], code=r["code"], url=r["url"])
            if r.get("notice"):
                out = r["notice"] + "\n" + out
            if r.get("sandbox"):
                out += "\n" + say(lang, "sandbox")
            return self.send(chat_id, out)
        if r["kind"] == "abstained":
            return self.send(chat_id, r.get("message") or say(lang, "abstained"))
        return self.send(chat_id, say(lang, "busy" if r["kind"] == "busy" else "unavailable"))

    def _verify(self, chat_id: str, lang: str, arg: str) -> None:
        if not code_mod.normalize(arg):
            return self.send(chat_id, say(lang, "verify_usage"))
        v = self.backend.verify(arg)
        if v["status"] == "unknown_code":
            return self.send(chat_id, say(lang, "verify_unknown", code=v["code"]))
        if v["status"] == "authentic":
            out = say(lang, "authentic", rule=v.get("rule", ""), url=v["url"])
            if v.get("expired"):
                out += "\n" + say(lang, "expired")
        elif v["status"] == "recalled":
            out = say(lang, "recalled", rule=", ".join(v.get("rules") or []) or v.get("rule", ""), url=v["url"])
        else:
            out = say(lang, "invalid", reason=v.get("reason") or "")
        if v.get("sandbox"):
            out += "\n" + say(lang, "sandbox")
        return self.send(chat_id, out)

    # ------------------------------------------------------------------ polling
    def poll_once(self, timeout: int = POLL_TIMEOUT_S) -> int:
        params: dict = {"timeout": timeout, "allowed_updates": ["message", "callback_query"]}
        if self.offset is not None:
            params["offset"] = self.offset
        updates = self.transport.call("getUpdates", params, timeout=timeout + 10) or []
        for u in updates:
            self.offset = int(u["update_id"]) + 1      # never handle an update twice, even one that failed
            try:
                self.handle(u)
            except Exception as e:                      # one bad update must not stop the bot
                log.warning("Telegram update %s failed: %s", u.get("update_id"),
                            getattr(e, "safe", type(e).__name__))
        return len(updates)

    def run(self, stop: threading.Event) -> None:
        try:
            me = self.transport.call("getMe", {})
            log.info("Telegram bot @%s polling (long polling, no webhook)", (me or {}).get("username", "?"))
        except TelegramError as e:
            log.warning("Telegram bot not started: %s", e.safe)
            return
        backoff = 1.0
        while not stop.is_set():
            try:
                self.poll_once()
                backoff = 1.0
            except TelegramError as e:
                wait = e.retry_after or (30 if e.status == 409 else backoff)
                log.warning("Telegram getUpdates failed (%s); retrying in %ss%s", e.safe, wait,
                            " (another poller or a webhook is active)" if e.status == 409 else "")
                stop.wait(wait)
                backoff = min(backoff * 2, 60)
