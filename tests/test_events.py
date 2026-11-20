"""Live event stream (GET /api/events, Server-Sent Events): inbox cases, recalls and photo events as they happen."""
import asyncio
import json
import threading

import pytest
from fastapi.testclient import TestClient

from services.api import main
from services.engine import events, inbox
from services.trust.store import TrustStore

ADMIN = {"X-Admin-Token": "test-token"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "_store", TrustStore("https://krishiloop.example", "did:web:krishiloop.example", "11" * 32,
                                                   data_dir=tmp_path / "trust"))
    monkeypatch.setattr(inbox, "INBOX_DIR", tmp_path / "inbox")
    monkeypatch.setenv("ADMIN_TOKEN", "test-token")
    monkeypatch.setenv("KRISHILOOP_ISSUER_SEED", "11" * 32)
    monkeypatch.setattr(main, "ROOT", tmp_path)
    return TestClient(main.app)


def read_events(lines, n):
    """Collect n real events (not comments, not `ready`) from an SSE line iterator."""
    out, cur = [], {}
    for line in lines:
        if line.startswith(":"):
            out.append({"comment": line})
        elif line.startswith("event: "):
            cur["event"] = line[7:]
        elif line.startswith("data: "):
            cur["data"] = json.loads(line[6:])
        elif line.startswith("id: "):
            cur["id"] = int(line[4:])
        elif line == "" and cur:
            if cur["event"] != "ready":
                out.append(cur)
            cur = {}
            if len([e for e in out if "event" in e]) >= n:
                return out
    return out


def test_a_recall_and_an_inbox_case_arrive_in_order(client):
    with client.stream("GET", "/api/events", headers=ADMIN) as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        lines = r.iter_lines()
        assert next(lines) == "retry: 3000"                       # the stream is open and subscribed
        assert client.post("/api/admin/recall", json={"rule_id": "R-PLB-008", "version": 1, "reason": "test, private"},
                           headers=ADMIN).status_code == 200
        item = inbox.create("KE-SAMPLE-01", "Secret Farmer Name", "no_matching_rule", {"en": "x"}, {"q": "private text"})
        got = read_events(lines, 2)
    assert [e["event"] for e in got] == ["recall", "inbox"] and got[0]["id"] < got[1]["id"]
    assert got[0]["data"]["rule_id"] == "R-PLB-008" and got[0]["data"]["version"] == 1
    assert got[1]["data"]["item_id"] == item and got[1]["data"]["action"] == "created"
    blob = json.dumps(got)
    assert "Secret Farmer" not in blob and "private" not in blob       # ids and codes only, never personal data


def test_a_heartbeat_comment_keeps_the_connection_alive(client, monkeypatch):
    monkeypatch.setattr(main, "SSE_HEARTBEAT_S", 0.2)
    with client.stream("GET", "/api/events", headers=ADMIN) as r:
        lines = r.iter_lines()
        assert next(lines) == "retry: 3000"
        seen = [l for l in (next(lines) for _ in range(6)) if l.startswith(": keep-alive")]
    assert seen


def test_the_official_stream_needs_the_admin_token_and_a_sandbox_id_must_be_well_formed(client):
    assert client.get("/api/events").status_code == 403
    assert client.get("/api/events", headers={"X-Admin-Token": "nope"}).status_code == 403
    assert client.get("/api/events?sid=../x").status_code == 404


def test_a_sandbox_hears_only_its_own_events():
    async def run():
        mine, other = events.subscribe("a" * 16), events.subscribe("b" * 16)
        threading.Thread(target=events.publish, args=("a" * 16, "recall", {"rule_id": "R-1", "version": 1})).start()
        ev = await asyncio.wait_for(mine.queue.get(), 2)
        assert ev["event"] == "recall" and other.queue.empty()
        mine.close(), other.close()
    asyncio.run(run())
    assert events.subscribers() == 0


def test_an_inbox_in_a_demo_folder_publishes_to_that_session(tmp_path):
    sid = "c" * 16
    async def run():
        sub = events.subscribe(sid)
        inbox.create("F", "n", "x", {"en": "y"}, {}, tmp_path / "data" / "demo" / sid / "inbox")
        ev = await asyncio.wait_for(sub.queue.get(), 2)
        sub.close()
        return ev
    ev = asyncio.run(run())
    assert ev["event"] == "inbox" and ev["data"]["scope"] == sid


def test_a_full_queue_drops_the_oldest_and_the_listener_cap_holds(monkeypatch):
    monkeypatch.setattr(events, "QUEUE_SIZE", 2)
    monkeypatch.setattr(events, "MAX_SUBSCRIBERS", 1)
    async def run():
        sub = events.subscribe("s")
        assert events.subscribe("s") is None
        for i in range(3):
            events.publish("s", "inbox", {"n": i})
            await asyncio.sleep(0.01)
        got = [sub.queue.get_nowait()["data"]["n"] for _ in range(2)]
        sub.close()
        return got
    assert asyncio.run(run()) == [1, 2]
