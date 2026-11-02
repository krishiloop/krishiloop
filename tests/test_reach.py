"""Reach (services/reach/): short verify codes, the SMS text and its parity with the web preview, recall notices to
receipt holders, and the Telegram bot's handlers. No network: Telegram is a fake Bot API transport, SMS is the sandbox
outbox, weather is a fixed sample forecast and the Ask router runs BM25 only (as in tests/test_ask.py).
"""
import json
import threading
import urllib.error
from collections import defaultdict, deque
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from services.ask import graph as ask_graph
from services.ask.graph import Router
from services.reach import codes, sms
from services.reach.db import CodeSpaceExhausted, ReachDB
from services.reach.senders import SandboxSender, TelegramSender, mask
from services.reach.telegram import Bot, HttpTransport, TelegramError
from services.trust.store import TrustStore

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / "services" / "reach" / "fixtures" / "sms_parity.json").read_text(encoding="utf-8"))
BASE = "https://krishiloop.example"
TOKEN = "123456789:" + "A" * 35          # a token-shaped string for the tests (not a real token)


# ---------------------------------------------------------------------------------------------- codes
def test_new_codes_are_8_crockford_characters_shown_in_two_groups():
    seen = {codes.new_code() for _ in range(500)}
    assert len(seen) == 500
    for c in seen:
        assert len(c) == 8 and set(c) <= set(codes.ALPHABET) and not set(c) & set("ILOU")
    assert codes.display("7KQ2MX4P") == "7KQ2-MX4P"


@pytest.mark.parametrize("typed", ["7KQ2-MX4P", "7kq2mx4p", " 7kq2 mx4p ", "7KQ2–MX4P", "7kq2_mx4p", "7KQ2.MX4P"])
def test_any_case_and_any_dash_or_space_is_the_same_code(typed):
    assert codes.normalize(typed) == "7KQ2MX4P"


def test_o_reads_as_zero_and_i_and_l_read_as_one():
    assert codes.normalize("OOOO-IIII") == "00001111"
    assert codes.normalize("ol1i-0000") == "01110000"


def test_code_typing_matches_the_shared_fixtures_the_web_is_tested_against():
    for case in FIXTURE["codes"]:
        assert (codes.normalize(case["typed"]) or "") == case["code"], case


@pytest.mark.parametrize("typed", ["", "7KQ2-MX4", "7KQ2-MX4PP", "7KQ2-MX4U", "7KQ2/MX4P", "urn:uuid:7KQ2MX4P", None,
                                  "7" * 40, "৭KQ2MX4P"])
def test_anything_else_is_not_a_code(typed):
    assert codes.normalize(typed) is None


def test_issuing_a_code_is_idempotent_and_checks_for_collisions(tmp_path):
    db = ReachDB(tmp_path / "reach.sqlite3")
    a = db.issue_code("urn:uuid:a", "1")
    assert db.issue_code("urn:uuid:a", "1") == a and db.code_for("urn:uuid:a") == a
    draws = iter([a, a, "BBBBBBBB"])                       # the first two draws collide with the code of "a"
    assert db.issue_code("urn:uuid:b", "1", new=lambda: next(draws)) == "BBBBBBBB"
    assert db.resolve("bbbb-bbbb") == "urn:uuid:b" and db.resolve(a.lower()) == "urn:uuid:a"
    with pytest.raises(CodeSpaceExhausted):
        db.issue_code("urn:uuid:c", "1", new=lambda: a)
    assert db.resolve("ZZZZZZZZ") is None and db.resolve("not a code") is None


# ---------------------------------------------------------------------------------------------- SMS text
def test_the_receipt_sms_matches_the_shared_fixtures_the_web_preview_is_tested_against():
    assert FIXTURE["templates"] == sms.TEMPLATES
    assert FIXTURE["decision_words"] == sms.DECISION_WORDS and FIXTURE["kind_words"] == sms.KIND_WORDS
    for case in FIXTURE["receipts"]:
        cred = {"credentialSubject": {"advice": case["advice"], "rule_refs": [case["rule"]]}}
        text = sms.receipt_sms(cred, case["lang"], case["code"], case["public_base"])
        assert {"text": text, **sms.sms_info(text)} == case["expected"], case
        assert text.endswith(f"/v/{codes.display(case['code'])}")
    for case in FIXTURE["raw"]:
        text = sms.build_sms(case["template"], case["parts"])
        assert {"text": text, **sms.sms_info(text)} == case["expected"], case


def test_the_segment_rules_are_the_web_previews():
    assert sms.sms_info("a" * 160) == {"units": 160, "unicode": False, "limit": 160, "segments": 1}
    assert sms.sms_info("a" * 161)["segments"] == 2 and sms.sms_info("a" * 306)["segments"] == 2
    assert sms.sms_info("a" * 307)["segments"] == 3
    assert sms.sms_info("{x}")["units"] == 5 and sms.sms_info("€")["units"] == 2
    assert sms.sms_info("ক" * 70)["segments"] == 1 and sms.sms_info("ক" * 71)["segments"] == 2
    assert sms.sms_info("ক" * 134)["segments"] == 2 and sms.sms_info("ক" * 135)["segments"] == 3
    assert sms.sms_info("\U0001F954")["units"] == 2         # outside the BMP: two UTF-16 code units


def test_the_recall_notice_says_recalled_do_not_follow_and_where_to_check():
    en = sms.recall_text("en", "R-PLB-008 v1", "2026-11-02", f"{BASE}/v/7KQ2-MX4P")
    assert en == f"KrishiLoop: RECALLED. Do not follow advice R-PLB-008 v1 from 2026-11-02. Check {BASE}/v/7KQ2-MX4P"
    assert sms.sms_info(en) == {"units": len(en), "unicode": False, "limit": 160, "segments": 1}
    bn = sms.recall_text("bn", "R-PLB-008 v1", "2026-11-02", f"{BASE}/v/7KQ2-MX4P")
    assert "বাতিল" in bn and "R-PLB-008 v1" in bn and "2026-11-02" in bn and bn.endswith("/v/7KQ2-MX4P")
    assert sms.recall_text("sw", "R", "d", "u").startswith("KrishiLoop: RECALLED")     # other languages: English
    assert "—" not in json.dumps(sms.RECALL_TEMPLATES, ensure_ascii=False)


def test_the_sandbox_sender_writes_an_outbox_and_never_the_full_number(tmp_path):
    s = SandboxSender(tmp_path / "outbox.jsonl")
    d = s.send("+8801712345678", "hello", {"kind": "test"})
    assert d.status == "sandbox" and d.detail == "sandbox: not sent"
    rows = s.read()
    assert rows[0]["to"] == mask("+8801712345678") == "+880" + "•" * 8 + "78" and rows[0]["note"] == "sandbox: not sent"
    assert "8801712345678" not in (tmp_path / "outbox.jsonl").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------------------------- Telegram transport
class FakeTransport:
    """The Bot API, faked: records every call; getUpdates answers from a queue; can be told to fail."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.updates: list[list[dict]] = []
        self.fail: Exception | None = None

    def call(self, method, params, timeout=None):
        self.calls.append((method, params))
        if self.fail and method == "sendMessage":
            raise self.fail
        if method == "getUpdates":
            return self.updates.pop(0) if self.updates else []
        if method == "getMe":
            return {"username": "krishiloop_test_bot"}
        return True

    def sent(self, chat_id=None) -> list[dict]:
        return [p for m, p in self.calls if m == "sendMessage" and (chat_id is None or p["chat_id"] == str(chat_id))]


def test_the_http_transport_never_shows_its_token(monkeypatch):
    with pytest.raises(ValueError):
        HttpTransport("not-a-token")
    t = HttpTransport(TOKEN)
    assert TOKEN not in repr(t)

    def http_error(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)
    monkeypatch.setattr("urllib.request.urlopen", http_error)
    with pytest.raises(TelegramError) as e:
        t.call("getMe", {})
    assert TOKEN not in str(e.value) and TOKEN not in e.value.safe and e.value.status == 401
    assert e.value.__cause__ is None and e.value.__suppress_context__

    def offline(req, timeout):
        raise urllib.error.URLError(f"cannot reach {req.full_url}")
    monkeypatch.setattr("urllib.request.urlopen", offline)
    with pytest.raises(TelegramError) as e:
        t.call("sendMessage", {"chat_id": "1", "text": "x"})
    assert e.value.network and TOKEN not in str(e.value)


# ---------------------------------------------------------------------------------------------- the API, end to end
def _snap() -> dict:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    days = [{"date": (date.today() + timedelta(days=i)).isoformat(), "rh_mean_pct": 95, "tmin_c": 12, "tmax_c": 20,
             "precip_mm": 1.0} for i in range(7)]
    return {"snapshot_id": "snap-reach", "field_id": "t", "mode": "live", "location": {"precision": "sample_location"},
            "created_at": now, "forecast": {"source": "open-meteo:forecast", "issued_at": now, "days": days}}


@pytest.fixture(scope="module")
def bm25_router():
    return Router(embedder=None, reranker=None, thresholds={"bm25": 0.6})


@pytest.fixture()
def api(tmp_path, monkeypatch, bm25_router):
    import services.api.main as m
    from services.engine import inbox
    monkeypatch.setattr(m, "_store", TrustStore(BASE, "did:web:krishiloop.example", "11" * 32, data_dir=tmp_path / "trust"))
    monkeypatch.setenv("KRISHILOOP_ISSUER_SEED", "11" * 32)
    monkeypatch.setenv("ADMIN_TOKEN", "test-token")
    monkeypatch.delenv("KRISHILOOP_REACH_DB", raising=False)
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("KRISHILOOP_ASK_MODELS", raising=False)
    monkeypatch.setenv("REACH_FIELD_ID", "BD-SAMPLE-01")
    monkeypatch.setenv("REACH_PROFILE_ID", "demo-farmer-d")
    monkeypatch.setattr(m, "ROOT", tmp_path)
    monkeypatch.setattr(inbox, "INBOX_DIR", tmp_path / "inbox")      # the official inbox, for the bot's questions
    monkeypatch.setattr(m, "_hits", defaultdict(deque))
    monkeypatch.setattr(m, "_ask_cache", type(m._ask_cache)())
    monkeypatch.setattr(m, "_plan_cache", {})
    monkeypatch.setattr(m.snap_mod, "build", lambda field: _snap())
    monkeypatch.setattr(ask_graph, "_router", bm25_router)
    monkeypatch.setattr(ask_graph, "_router_key", "")
    fake = FakeTransport()
    monkeypatch.setattr(m.reach, "_dbs", {})
    monkeypatch.setattr(m.reach, "telegram_transport", lambda: fake)
    return m, TestClient(m.app), fake


def _demo_plan(client, field="KE-SAMPLE-01", profile="demo-farmer-a"):
    sid = client.post("/api/demo/session").json()["session_id"]
    plan = client.post(f"/api/demo/{sid}/plan", json={"field_id": field, "profile_id": profile}).json()
    return sid, plan


def test_every_issued_receipt_gets_a_code_that_resolves_from_any_typing(api):
    m, client, _ = api
    sid, plan = _demo_plan(client)
    cid = plan["actions"][0]["receipt_credential_id"]
    code = m.reach.db().code_for(cid)
    assert code and codes.normalize(code) == code          # issued with the receipt, before anyone asked for it
    for typed in (code, codes.display(code), code.lower(), codes.display(code).lower().replace("0", "o")):
        r = client.get(f"/api/code/{typed}")
        assert r.status_code == 200 and r.json()["credential_id"] == cid, typed
        assert r.json()["verify_path"] == f"/verify/{cid.removeprefix('urn:uuid:')}"
    info = client.get(f"/api/credentials/{cid}/code").json()
    assert info["code"] == codes.display(code) and info["verify_url"] == f"{BASE}/v/{codes.display(code)}"
    cred = client.get(f"/api/credentials/{cid}").json()
    assert info["sms"]["en"]["text"] == sms.receipt_sms(cred, "en", code, BASE)
    assert info["sms"]["bn"]["unicode"] is True and info["sms"]["en"]["segments"] == 1


def test_an_unknown_code_is_a_bare_404(api):
    _, client, _ = api
    _demo_plan(client)
    for typed in ("ZZZZ-ZZZZ", "UUUU-UUUU", "abc", "7KQ2-MX4P-EXTRA"):
        r = client.get(f"/api/code/{typed}")
        assert r.status_code == 404 and r.json() == {"detail": "unknown code"}, typed
    assert client.get("/api/credentials/urn:uuid:00000000-0000-4000-8000-000000000000/code").status_code == 404


def test_answers_from_the_ask_pipeline_get_codes_too(api):
    m, client, _ = api
    sid = client.post("/api/demo/session").json()["session_id"]
    body = {"field_id": "BD-SAMPLE-01", "profile_id": "demo-farmer-d", "question": "Is standing water in my field a problem?"}
    r = client.post(f"/api/demo/{sid}/ask", json=body).json()
    assert r["status"] == "ok", r
    assert m.reach.db().code_for(r["answer"]["receipt_credential_id"])


def test_a_sandbox_sms_is_written_to_the_outbox_and_never_sent(api):
    m, client, _ = api
    sid, plan = _demo_plan(client)
    cid = plan["actions"][0]["receipt_credential_id"]
    r = client.post(f"/api/demo/{sid}/reach/sms", json={"credential_id": cid, "phone": "+254 712 345 678", "lang": "en"})
    assert r.status_code == 200 and r.json()["status"] == "sandbox" and r.json()["note"] == "sandbox: not sent"
    assert r.json()["text"] == sms.receipt_sms(client.get(f"/api/credentials/{cid}").json(), "en",
                                               m.reach.db().code_for(cid), BASE)
    rows = m.reach.outbox().read()
    assert len(rows) == 1 and rows[0]["status"] == "sandbox" and "712345678" not in json.dumps(rows)
    assert client.post(f"/api/demo/{sid}/reach/sms", json={"credential_id": cid, "phone": "12ab"}).status_code == 422
    other, _ = _demo_plan(client)        # another visitor's session cannot text this session's receipt
    assert client.post(f"/api/demo/{other}/reach/sms", json={"credential_id": cid, "phone": "+254712345678"}).status_code == 404


def test_a_demo_recall_notifies_every_holder_once_on_their_channel(api):
    m, client, fake = api
    sid, plan = _demo_plan(client)
    cid = plan["actions"][0]["receipt_credential_id"]
    rule = plan["actions"][0]["receipt"]["rule_refs"][0]
    client.post(f"/api/demo/{sid}/reach/sms", json={"credential_id": cid, "phone": "+254712345678", "lang": "bn"})
    m.reach.db().add_holder(f"demo-{sid}", cid, "telegram", "4242", "en")
    r = client.post(f"/api/demo/{sid}/recall", json={"rule_id": rule["rule_id"], "version": rule["version"]})
    n = r.json()["notified"]
    assert (n["total"], n["telegram"], n["sms_sandbox"], n["failed"], n["receipts"]) == (2, 1, 1, 0, 1), n
    code = codes.display(m.reach.db().code_for(cid))
    [push] = fake.sent("4242")
    issued = client.get(f"/api/credentials/{cid}").json()["validFrom"][:10]
    assert push["text"] == (f"KrishiLoop: RECALLED. Do not follow advice {rule['rule_id']} v{rule['version']} from {issued}. "
                            f"Check {BASE}/v/{code}")
    notice = m.reach.outbox().read()[-1]
    assert "বাতিল" in notice["text"] and notice["text"].endswith(f"/v/{code}") and notice["status"] == "sandbox"
    log = m.reach.db().notifications(f"demo-{sid}")
    assert {(x["channel"], x["status"]) for x in log} == {("telegram", "sent"), ("sms", "sandbox")}
    assert all(x["credential_id"] == cid and x["at"] for x in log)
    again = client.post(f"/api/demo/{sid}/recall", json={"rule_id": rule["rule_id"], "version": rule["version"]}).json()
    assert again["notified"]["total"] == 2 and len(fake.sent("4242")) == 1 and len(m.reach.outbox().read()) == 2


def test_only_holders_of_receipts_that_cite_the_rule_are_notified(api):
    m, client, fake = api
    sid, plan = _demo_plan(client)
    cid = plan["actions"][0]["receipt_credential_id"]
    m.reach.db().add_holder(f"demo-{sid}", cid, "telegram", "1", "en")
    other_rule = "R-PLB-001" if plan["actions"][0]["receipt"]["rule_refs"][0]["rule_id"] != "R-PLB-001" else "R-PLB-007"
    n = client.post(f"/api/demo/{sid}/recall", json={"rule_id": other_rule, "version": 1}).json()["notified"]
    assert n["total"] == 0 and fake.sent() == []


def test_a_failed_telegram_push_is_recorded_as_failed_and_never_counted_as_sent(api, monkeypatch):
    m, client, fake = api
    sid, plan = _demo_plan(client)
    cid = plan["actions"][0]["receipt_credential_id"]
    rule = plan["actions"][0]["receipt"]["rule_refs"][0]
    for chat in ("1", "2"):
        m.reach.db().add_holder(f"demo-{sid}", cid, "telegram", chat, "en")
    fake.fail = TelegramError("sendMessage", "network (URLError)", network=True)
    n = client.post(f"/api/demo/{sid}/recall", json={"rule_id": rule["rule_id"], "version": rule["version"]}).json()["notified"]
    assert (n["total"], n["telegram"], n["failed"]) == (0, 0, 2)
    assert len(fake.sent()) == 1          # after a network failure the rest are not tried one by one
    fake.fail = None                      # Telegram is back: a later recall call delivers what failed, once
    n = client.post(f"/api/demo/{sid}/recall", json={"rule_id": rule["rule_id"], "version": rule["version"]}).json()["notified"]
    assert (n["total"], n["telegram"], n["failed"]) == (2, 2, 0)
    monkeypatch.setattr(m.reach, "telegram_transport", lambda: None)       # no token on the server: failed, not sent
    assert TelegramSender(None).send("1", "x").status == "failed"


def test_the_admin_recall_notifies_holders_of_official_receipts(api):
    m, client, _ = api
    plan = client.post("/api/plan", json={"field_id": "KE-SAMPLE-01", "profile_id": "demo-farmer-a"}).json()
    cid = plan["actions"][0]["receipt_credential_id"]
    rule = plan["actions"][0]["receipt"]["rule_refs"][0]
    m.reach.db().add_holder("1", cid, "sms", "+254712345678", "en")
    body = {"rule_id": rule["rule_id"], "version": rule["version"]}
    assert client.post("/api/admin/recall", json=body).status_code == 403
    n = client.post("/api/admin/recall", json=body, headers={"X-Admin-Token": "test-token"}).json()["notified"]
    assert (n["total"], n["sms_sandbox"]) == (1, 1)


# ---------------------------------------------------------------------------------------------- the bot
def _msg(chat_id, text, uid=1, chat_type="private", lang="en"):
    return {"update_id": uid, "message": {"message_id": uid, "chat": {"id": int(chat_id), "type": chat_type},
                                          "from": {"id": int(chat_id), "language_code": lang}, "text": text}}


@pytest.fixture()
def bot(api):
    from services.reach.service import HostBackend
    m, client, fake = api
    return Bot(fake, HostBackend(m.reach), m.reach.db()), m, client, fake


def test_start_picks_a_language_and_says_what_is_kept(bot):
    b, m, _, fake = bot
    b.handle(_msg(7, "/start", lang="bn"))
    assert m.reach.db().chat("7")["lang"] == "bn"
    pick = fake.sent("7")[-1]
    assert pick["reply_markup"]["inline_keyboard"][0][0]["callback_data"] == "lang:bn"
    b.handle({"update_id": 2, "callback_query": {"id": "cq", "data": "lang:en",
                                                 "message": {"chat": {"id": 7, "type": "private"}}}})
    assert ("answerCallbackQuery", {"callback_query_id": "cq"}) in fake.calls
    assert m.reach.db().chat("7")["lang"] == "en"
    welcome = fake.sent("7")[-1]["text"]
    assert "Language: English" in welcome and "/stop" in welcome and "BD-SAMPLE-01" in welcome
    b.handle(_msg(7, "/bn"))
    assert "বাংলা" in fake.sent("7")[-1]["text"] and m.reach.db().chat("7")["lang"] == "bn"


def test_a_question_before_start_asks_for_start_and_keeps_nothing(bot):
    b, m, _, fake = bot
    b.handle(_msg(8, "Is standing water in my field a problem?"))
    assert "/start" in fake.sent("8")[-1]["text"] and m.reach.db().chat("8") is None
    assert m.reach.db().counts()["holders"] == 0


def test_group_chats_are_ignored(bot):
    b, m, _, fake = bot
    b.handle(_msg(-100, "/start", chat_type="group"))
    assert fake.sent() == [] and m.reach.db().chat("-100") is None


def test_a_question_goes_through_the_ask_pipeline_and_a_recall_reaches_the_chat(bot):
    b, m, client, fake = bot
    b.handle(_msg(9, "/en"))
    b.handle(_msg(9, "Is standing water in my field a problem?"))
    reply = fake.sent("9")[-1]["text"]
    rule = ask_graph._router.index.rules["R-BDR-006"]
    assert reply.startswith(rule["action"]["title"]["en"]) and "Rule R-BDR-006 v1." in reply
    [holder] = m.reach.db().holders("1")             # the main service (no demo session linked)
    code = codes.display(m.reach.db().code_for(holder["credential_id"]))
    assert f"Receipt {code}" in reply and reply.rstrip().endswith(f"Check: {BASE}/v/{code}") and "sandbox" not in reply
    assert holder["channel"] == "telegram" and holder["address"] == "9"
    # /verify with the code: Authentic, from the same verifier as GET /api/verify
    b.handle(_msg(9, f"/verify {code.lower().replace('-', '')}"))
    assert fake.sent("9")[-1]["text"].startswith("Authentic: issued by KrishiLoop and not changed since.")
    # the officer recalls the rule: the chat gets the notice, and /verify now says Recalled
    r = client.post("/api/admin/recall", json={"rule_id": "R-BDR-006", "version": 1}, headers={"X-Admin-Token": "test-token"})
    assert r.json()["notified"]["telegram"] == 1
    assert fake.sent("9")[-1]["text"].startswith("KrishiLoop: RECALLED. Do not follow advice R-BDR-006 v1 from ")
    b.handle(_msg(9, f"/verify {code}"))
    assert fake.sent("9")[-1]["text"].startswith("Recalled: a rule behind this advice was withdrawn. Do not follow it.")


def test_an_unanswered_question_gets_the_abstention_message_and_goes_to_the_officer(bot):
    b, m, client, fake = bot
    b.handle(_msg(10, "/en"))
    b.handle(_msg(10, "How do I apply for a farm loan?"))
    assert fake.sent("10")[-1]["text"] == "We don't have a sourced answer for this yet. Sent to your officer."
    items = client.get("/api/inbox", headers={"X-Admin-Token": "test-token"}).json()["items"]
    assert [i["question"] for i in items] == ["How do I apply for a farm loan?"]
    assert m.reach.db().holders("1") == []
    b.handle(_msg(10, "/bn"))
    b.handle(_msg(10, "ঋণের জন্য কীভাবে আবেদন করব?"))
    assert "কর্মকর্তার কাছে পাঠানো হয়েছে" in fake.sent("10")[-1]["text"]


def test_verify_answers_cannot_verify_for_unknown_or_malformed_codes(bot):
    b, _, _, fake = bot
    b.handle(_msg(11, "/en"))
    b.handle(_msg(11, "/verify ZZZZ-ZZZZ"))
    assert fake.sent("11")[-1]["text"] == "Cannot verify: no receipt has the code ZZZZ-ZZZZ."
    b.handle(_msg(11, "/verify hello"))
    assert fake.sent("11")[-1]["text"].startswith("Send /verify and the code on your receipt")


def test_stop_deletes_the_chats_data(bot):
    b, m, _, fake = bot
    b.handle(_msg(12, "/en"))
    b.handle(_msg(12, "Is standing water in my field a problem?"))
    assert m.reach.db().holders("1") and m.reach.db().chat("12")
    b.handle(_msg(12, "/stop"))
    assert m.reach.db().chat("12") is None and m.reach.db().holders("1") == []
    assert fake.sent("12")[-1]["text"].startswith("Deleted.")
    notes = [n for n in m.reach.db().notifications("1")]
    assert all("12" != str(n.get("address")) for n in notes)        # the log never kept the address


def test_a_deep_link_ties_the_chat_to_a_demo_session_and_its_recalls(bot):
    b, m, client, fake = bot
    sid = client.post("/api/demo/session").json()["session_id"]
    b.handle(_msg(13, f"/start {sid}"))
    assert m.reach.db().chat("13")["sid"] == sid and "linked" in fake.sent("13")[0]["text"]
    b.handle(_msg(13, "/en"))
    b.handle(_msg(13, "Is standing water in my field a problem?"))
    assert fake.sent("13")[-1]["text"].endswith("(demo sandbox)")
    assert m.reach.db().holders(f"demo-{sid}") and not m.reach.db().holders("1")
    n = client.post(f"/api/demo/{sid}/recall", json={"rule_id": "R-BDR-006", "version": 1}).json()["notified"]
    assert n["telegram"] == 1 and "RECALLED" in fake.sent("13")[-1]["text"]
    b.handle(_msg(14, "/start 0123456789abcdef"))         # an unknown session: said, and not linked
    assert m.reach.db().chat("14")["sid"] is None and "not found" in fake.sent("14")[0]["text"]


def test_polling_advances_the_offset_and_survives_a_bad_update(bot):
    b, m, _, fake = bot
    fake.updates = [[_msg(15, "/en", uid=100), {"update_id": 101, "message": {"chat": {"id": 15, "type": "private"}}},
                     {"update_id": 102, "message": None}, _msg(15, "/help", uid=103)]]
    assert b.poll_once(timeout=0) == 4 and b.offset == 104
    assert "/verify CODE" in fake.sent("15")[-1]["text"]
    b.poll_once(timeout=0)
    assert ("getUpdates", {"timeout": 0, "allowed_updates": ["message", "callback_query"], "offset": 104}) in fake.calls
    assert not any(m_ == "setWebhook" for m_, _ in fake.calls)          # long polling only


def test_run_stops_on_request_and_needs_a_token_to_start(api, monkeypatch):
    m, _, fake = api
    from services.reach.service import HostBackend
    stop = threading.Event()
    stop.set()
    Bot(fake, HostBackend(m.reach), m.reach.db()).run(stop)
    assert fake.calls == [("getMe", {})]
    monkeypatch.setattr(m.reach, "telegram_transport", lambda: None)
    assert m.reach.start_telegram() is False                # no TELEGRAM_BOT_TOKEN: the bot does not start
    monkeypatch.setenv("KRISHILOOP_TELEGRAM", "off")
    assert m.reach.start_telegram() is False
    assert m.app.url_path_for("reach_health") and TestClient(m.app).get("/api/reach/health").json()["sms"] == "sandbox: not sent"
