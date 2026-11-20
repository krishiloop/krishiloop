"""In-process publish/subscribe for the live event stream (GET /api/events, Server-Sent Events).

Publishers (the officer inbox, recalls, the photo ledger) call `publish`, from any thread; each subscriber is an
asyncio queue owned by the event loop that subscribed. Events carry identifiers and codes only, never a farmer's name,
phone, photo, location or question text: what an officer needs to know is "something new arrived, refresh".

Scopes keep sandboxes apart: "official" for the real server data, or a demo session id. A subscriber hears one scope.
Slow subscribers lose their oldest events (bounded queue) instead of holding memory; the client refetches on any event.
"""
from __future__ import annotations

import asyncio
import itertools
import threading
from datetime import datetime, timezone
from pathlib import Path

OFFICIAL = "official"
MAX_SUBSCRIBERS = 200
QUEUE_SIZE = 100

_lock = threading.Lock()
_subs: list["Subscription"] = []
_ids = itertools.count(1)


class Subscription:
    def __init__(self, scope: str, loop: asyncio.AbstractEventLoop):
        self.scope, self.loop, self.queue = scope, loop, asyncio.Queue(maxsize=QUEUE_SIZE)

    def _put(self, ev: dict) -> None:
        if self.queue.full():
            self.queue.get_nowait()
        self.queue.put_nowait(ev)

    def close(self) -> None:
        with _lock:
            if self in _subs:
                _subs.remove(self)


def subscribe(scope: str = OFFICIAL) -> Subscription | None:
    """Call from inside the event loop. None when the server already has MAX_SUBSCRIBERS listeners."""
    with _lock:
        if len(_subs) >= MAX_SUBSCRIBERS:
            return None
        sub = Subscription(scope, asyncio.get_running_loop())
        _subs.append(sub)
        return sub


def publish(scope: str, kind: str, data: dict) -> None:
    """Thread-safe and never raises: a broken listener must not break an inbox write or a recall."""
    ev = {"id": next(_ids), "event": kind, "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
          "data": {**data, "scope": scope}}
    with _lock:
        targets = [s for s in _subs if s.scope == scope]
    for s in targets:
        try:
            s.loop.call_soon_threadsafe(s._put, ev)
        except RuntimeError:        # that loop is closed
            s.close()


def scope_of_inbox(inbox_dir: Path | None) -> str:
    """data/demo/<sid>/inbox belongs to the demo session <sid>; no directory is the official inbox."""
    return OFFICIAL if inbox_dir is None else inbox_dir.parent.name


def scope_of_status(status_id: str) -> str:
    """A trust store's status id: 'demo-<sid>' for a sandbox, anything else is the official list."""
    return status_id[5:] if status_id.startswith("demo-") else OFFICIAL


def subscribers() -> int:
    with _lock:
        return len(_subs)
