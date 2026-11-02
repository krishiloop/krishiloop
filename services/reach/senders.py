"""Who delivers a message.

- SandboxSender: appends to an outbox JSONL file and NEVER sends. We have no SMS provider account, so every SMS is
  "sandbox: not sent". The outbox keeps the text and a masked number (the full number stays only in the holders table).
- TelegramSender: the Bot API's sendMessage over HTTPS (services/reach/telegram.py's transport). Real when the bot token
  is set; without one, nothing is sent and the notice is recorded as failed, never as sent.

A real SMS provider would be one more Sender (see docs/reach/README.md): same interface, status "sent" on the provider's
accepted answer.
"""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from services.reach.db import now_iso
from services.reach.sms import sms_info

SANDBOX_NOTE = "sandbox: not sent"


@dataclass
class Delivery:
    status: str          # "sent" | "sandbox" | "failed"
    detail: str = ""


class Sender(Protocol):
    channel: str

    def send(self, address: str, text: str, meta: dict | None = None) -> Delivery: ...


def mask(number: str) -> str:
    """+8801712345678 -> +880•••••••78: enough to tell numbers apart in a log, not enough to dial."""
    digits = number.lstrip("+")
    keep = digits[:3], digits[-2:]
    return ("+" if number.startswith("+") else "") + keep[0] + "•" * max(0, len(digits) - 5) + keep[1]


class SandboxSender:
    """SMS in a sandbox: one JSON line per message in the outbox. Nothing leaves this machine."""
    channel = "sms"

    def __init__(self, outbox: Path):
        self.outbox = Path(outbox)
        self._lock = threading.Lock()

    def send(self, address: str, text: str, meta: dict | None = None) -> Delivery:
        row = {"at": now_iso(), "channel": "sms", "to": mask(address), "text": text, **sms_info(text),
               "status": "sandbox", "note": SANDBOX_NOTE, **(meta or {})}
        self.outbox.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self.outbox.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        return Delivery("sandbox", SANDBOX_NOTE)

    def read(self) -> list[dict]:
        if not self.outbox.exists():
            return []
        return [json.loads(line) for line in self.outbox.read_text(encoding="utf-8").splitlines() if line.strip()]


class TelegramSender:
    """sendMessage through a Bot API transport (telegram.HttpTransport, or a fake in tests)."""
    channel = "telegram"

    def __init__(self, transport):
        self.transport = transport
        self._down = False      # after a network failure, do not wait on every remaining holder

    def send(self, address: str, text: str, meta: dict | None = None) -> Delivery:
        if self.transport is None:
            return Delivery("failed", "no Telegram bot token on this server")
        if self._down:
            return Delivery("failed", "Telegram was not reachable a moment ago")
        try:
            self.transport.call("sendMessage", {"chat_id": address, "text": text, "disable_web_page_preview": True})
            return Delivery("sent")
        except Exception as e:     # the error never carries the token: see telegram.TelegramError
            if getattr(e, "network", False):
                self._down = True
            return Delivery("failed", getattr(e, "safe", type(e).__name__))
