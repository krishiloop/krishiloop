"""The Reach store: one SQLite file (stdlib, safe across threads and processes).

Tables
- codes          code -> credential id (both unique), the store that issued it
- holders        who holds a receipt and how to reach them: channel ("telegram" | "sms"), address, language
- notifications  one row per recall notice: store, receipt, rule version, channel, time, status. No address is kept here,
                 so deleting a holder (Telegram /stop) leaves no personal data behind in the log.
- chats          Telegram chats that pressed /start: chat id, language, and the demo session a chat is linked to (if any)

Personal data kept: a Telegram chat id or a sandbox SMS number, a language, and receipt ids. Nothing else.
"""
from __future__ import annotations

import contextlib
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from services.reach import codes as code_mod

SCHEMA = """
CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY, credential_id TEXT NOT NULL UNIQUE, store_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS holders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL, credential_id TEXT NOT NULL, channel TEXT NOT NULL,
  address TEXT NOT NULL, lang TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (store_id, credential_id, channel, address));
CREATE INDEX IF NOT EXISTS holders_store ON holders (store_id);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL, credential_id TEXT NOT NULL, rule TEXT NOT NULL,
  channel TEXT NOT NULL, holder_id INTEGER, at TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS notifications_rule ON notifications (store_id, rule);
CREATE TABLE IF NOT EXISTS chats (
  chat_id TEXT PRIMARY KEY, lang TEXT NOT NULL, sid TEXT, created_at TEXT NOT NULL);
"""
MAX_CODE_TRIES = 20


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class CodeSpaceExhausted(RuntimeError):
    pass


class ReachDB:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._con() as con:
            con.executescript(SCHEMA)

    @contextlib.contextmanager
    def _con(self):
        """One short connection per operation (closed at once, so Windows can delete the file in tests)."""
        con = sqlite3.connect(self.path, timeout=10)
        con.row_factory = sqlite3.Row
        try:
            with con:
                yield con
        finally:
            con.close()

    # ------------------------------------------------------------------ codes
    def issue_code(self, credential_id: str, store_id: str, new=code_mod.new_code) -> str:
        """The receipt's code: the existing one, or a new one after a collision check (idempotent)."""
        with self._lock, self._con() as con:
            row = con.execute("SELECT code FROM codes WHERE credential_id = ?", (credential_id,)).fetchone()
            if row:
                return row["code"]
            for _ in range(MAX_CODE_TRIES):
                code = new()
                if con.execute("SELECT 1 FROM codes WHERE code = ?", (code,)).fetchone():
                    continue          # collision: draw again
                try:                  # the primary key is the last word if another process drew the same code
                    con.execute("INSERT INTO codes (code, credential_id, store_id, created_at) VALUES (?, ?, ?, ?)",
                                (code, credential_id, store_id, now_iso()))
                except sqlite3.IntegrityError:
                    row = con.execute("SELECT code FROM codes WHERE credential_id = ?", (credential_id,)).fetchone()
                    if row:
                        return row["code"]
                    continue
                return code
        raise CodeSpaceExhausted(f"no free code after {MAX_CODE_TRIES} draws")

    def resolve(self, typed: str) -> str | None:
        """A typed code -> credential id, or None (unknown or not a code)."""
        code = code_mod.normalize(typed)
        if not code:
            return None
        with self._con() as con:
            row = con.execute("SELECT credential_id FROM codes WHERE code = ?", (code,)).fetchone()
        return row["credential_id"] if row else None

    def code_for(self, credential_id: str) -> str | None:
        with self._con() as con:
            row = con.execute("SELECT code FROM codes WHERE credential_id = ?", (credential_id,)).fetchone()
        return row["code"] if row else None

    # ------------------------------------------------------------------ holders
    def add_holder(self, store_id: str, credential_id: str, channel: str, address: str, lang: str) -> None:
        with self._con() as con:
            con.execute("INSERT INTO holders (store_id, credential_id, channel, address, lang, created_at) "
                        "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (store_id, credential_id, channel, address) "
                        "DO UPDATE SET lang = excluded.lang", (store_id, credential_id, channel, address, lang, now_iso()))

    def holders(self, store_id: str) -> list[dict]:
        with self._con() as con:
            return [dict(r) for r in con.execute("SELECT * FROM holders WHERE store_id = ? ORDER BY id", (store_id,))]

    def forget(self, channel: str, address: str) -> int:
        """Delete everything that names this address (Telegram /stop, or an SMS STOP from a provider)."""
        with self._con() as con:
            n = con.execute("DELETE FROM holders WHERE channel = ? AND address = ?", (channel, address)).rowcount
            if channel == "telegram":
                n += con.execute("DELETE FROM chats WHERE chat_id = ?", (address,)).rowcount
        return n

    def purge_demo(self, older_than: timedelta) -> int:
        """Holders of demo sandboxes outlive nothing: drop them once the sandbox itself has expired."""
        cut = (datetime.now(timezone.utc) - older_than).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        with self._con() as con:
            return con.execute("DELETE FROM holders WHERE store_id LIKE 'demo-%' AND created_at < ?", (cut,)).rowcount

    # ------------------------------------------------------------------ notifications
    def notified(self, store_id: str, credential_id: str, rule: str, holder_id: int) -> bool:
        with self._con() as con:
            return con.execute("SELECT 1 FROM notifications WHERE store_id = ? AND credential_id = ? AND rule = ? "
                               "AND holder_id = ? AND status IN ('sent', 'sandbox')",
                               (store_id, credential_id, rule, holder_id)).fetchone() is not None

    def record_notification(self, store_id: str, credential_id: str, rule: str, channel: str, holder_id: int | None,
                            status: str, detail: str = "") -> dict:
        row = {"store_id": store_id, "credential_id": credential_id, "rule": rule, "channel": channel,
               "holder_id": holder_id, "at": now_iso(), "status": status, "detail": detail}
        with self._con() as con:
            con.execute("INSERT INTO notifications (store_id, credential_id, rule, channel, holder_id, at, status, detail) "
                        "VALUES (:store_id, :credential_id, :rule, :channel, :holder_id, :at, :status, :detail)", row)
        return row

    def notifications(self, store_id: str, rule: str | None = None) -> list[dict]:
        q, args = "SELECT * FROM notifications WHERE store_id = ?", [store_id]
        if rule:
            q, args = q + " AND rule = ?", args + [rule]
        with self._con() as con:
            return [dict(r) for r in con.execute(q + " ORDER BY id", args)]

    # ------------------------------------------------------------------ Telegram chats
    def chat(self, chat_id: str) -> dict | None:
        with self._con() as con:
            row = con.execute("SELECT * FROM chats WHERE chat_id = ?", (chat_id,)).fetchone()
        return dict(row) if row else None

    def save_chat(self, chat_id: str, lang: str, sid: str | None = None, keep_sid: bool = True) -> dict:
        with self._con() as con:
            old = con.execute("SELECT sid FROM chats WHERE chat_id = ?", (chat_id,)).fetchone()
            if old and keep_sid and sid is None:
                sid = old["sid"]
            con.execute("INSERT INTO chats (chat_id, lang, sid, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (chat_id) "
                        "DO UPDATE SET lang = excluded.lang, sid = excluded.sid", (chat_id, lang, sid, now_iso()))
        return self.chat(chat_id) or {}

    def counts(self) -> dict:
        with self._con() as con:
            return {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                    for t in ("codes", "holders", "notifications", "chats")}
