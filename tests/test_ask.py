"""Ask router: a question gets one sourced rule's validated text with a signed receipt, or goes to the officer.

No network and no model downloads: weather is a fixed sample forecast, and the dense and rerank stages use small
fakes with the same interface as services/ask/models.py.
"""
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from services.ask import decide as dec
from services.ask import graph as ask_graph
from services.ask.graph import Router
from services.ask.index import MAX_WORDS, PAGE_ONLY_WEIGHT, Index
from services.ask.lexical import load_lexicon
from services.engine.planner import make_plan
from services.trust.store import TrustStore

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "ml" / "ask" / "questions.seed.jsonl"
UNANSWERED = "We don't have a sourced answer for this yet. Sent to your officer."


# ---------------------------------------------------------------------------------------------- helpers and fakes
def _validator(name: str) -> Draft202012Validator:
    reg, schemas = Registry(), {}
    for p in (ROOT / "contracts" / "schemas").glob("*.schema.json"):
        s = json.loads(p.read_text(encoding="utf-8"))
        schemas[p.name] = s
        reg = reg.with_resource(s["$id"], Resource.from_contents(s))
    return Draft202012Validator(schemas[name], registry=reg)


ACTION, INBOX_ITEM = _validator("action.schema.json"), _validator("inbox_item.schema.json")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def snap(day: dict | None = None) -> dict:
    """A sample 7-day forecast (calm by default); None = no forecast at all."""
    day = {"rh_mean_pct": 55, "tmin_c": 14, "tmax_c": 24, "precip_mm": 0.0} if day is None else day
    days = [{"date": (date.today() + timedelta(days=i)).isoformat(), **day} for i in range(7)] if day else []
    return {"snapshot_id": "snap-test", "field_id": "t", "mode": "sample", "location": {"precision": "sample_location"},
            "created_at": _now(), "forecast": {"source": "test", "issued_at": _now(), "days": days}}


def potato(stage: str) -> dict:
    return {"field_id": f"T-POTATO-{stage}", "pack_id": "pack-potato-late-blight", "crop": "potato", "stage": stage,
            "country": "KE", "precision": "sample_location"}


def rice(stage: str) -> dict:
    return {"field_id": f"T-RICE-{stage}", "pack_id": "pack-bd-rice", "crop": "rice", "stage": stage, "country": "BD",
            "precision": "sample_location"}


FARMER = {"farmer_profile_id": "t-farmer", "crop_protected": False, "soil_drainage": "good"}
LOW_COUNTS = {"farmer_profile_id": "t-farmer", "bph_females_per_hill": 0, "bph_nymphs_per_hill": 1, "soil_drainage": "good"}


class FakeEmbedder:
    """Hashed bag of words (64 dims): enough to exercise the dense stage without a model."""
    name, sha256 = "fake-embedder@test", "e" * 64

    def __init__(self):
        self.lex = load_lexicon()

    def embed(self, texts, kind):
        out = np.zeros((len(texts), 64), dtype=np.float32)
        for i, t in enumerate(texts):
            for w in self.lex.content_words(t):
                for v in self.lex.variants(w):
                    out[i, int(hashlib.md5(v.encode()).hexdigest(), 16) % 64] += 1
        n = np.linalg.norm(out, axis=1, keepdims=True)
        return out / np.where(n == 0, 1, n)

    def describe(self):
        return {"name": "fake-embedder", "licence": "test only", "sha256": self.sha256}


class FakeReranker:
    """Word overlap in [0, 1]; counts its calls so tests can see the stage ran."""
    name, sha256 = "fake-reranker@test", "f" * 64

    def __init__(self):
        self.lex, self.calls = load_lexicon(), 0

    def score(self, query, passages):
        self.calls += 1
        words = [set(self.lex.variants(w)) for w in self.lex.content_words(query)]
        out = []
        for p in passages:
            s = {v for w in self.lex.content_words(p) for v in self.lex.variants(w)}
            out.append(sum(bool(w & s) for w in words) / len(words) if words else 0.0)
        return out

    def describe(self):
        return {"name": "fake-reranker", "licence": "test only", "sha256": self.sha256}


@pytest.fixture(scope="module")
def bm25_router():
    return Router(embedder=None, reranker=None, thresholds={"bm25": 0.6})   # above 0.5: a same-page link alone never qualifies


@pytest.fixture()
def store(tmp_path):
    return TrustStore("https://krishiloop.example", "did:web:krishiloop.example", "11" * 32, data_dir=tmp_path / "trust")


def ask(router, store, tmp_path, question, field_, profile=FARMER, lang="en", weather=None, **kw):
    return router.ask(question, lang, field_, profile, store, inbox_dir=tmp_path / "inbox", snap=snap(weather), **kw)


def inbox_items(tmp_path) -> list[dict]:
    d = tmp_path / "inbox"
    return [json.loads(p.read_text(encoding="utf-8")) for p in d.glob("inbox-*.json")] if d.exists() else []


# ---------------------------------------------------------------------------------------------- normalisation
def test_bangla_normalisation_variants_and_query_rewriting():
    lex = load_lexicon()
    assert lex.tokens("৮০টির।ধানের-পাতায়") == ["80", "টির", "ধানের", "পাতায়"]       # digits, danda, hyphen
    assert "ধান" in lex.variants("ধানের") and "জমি" in lex.variants("জমিতে") and "ক্ষেত" in lex.variants("ক্ষেতে")
    assert "spray" in lex.variants("spraying") and "hill" in lex.variants("hilling") and "cut" in lex.variants("cutting")
    q = lex.analyse("আলুর নাবি ধসা রোগ হলে কী করব?")
    assert q.crops == ["potato"] and any("late blight" in e for e in q.expansions)   # Bangla -> English synonyms
    assert any("নাবি ধসা" == c.text for c in q.concepts)                              # a phrase stays one concept
    assert lex.analyse("Should I spray now?").input_intent and not lex.analyse("When should I harvest?").input_intent
    assert lex.analyse("ধান কাটার সঠিক সময় কখন?").crops == ["rice"]
    assert lex.analyse("আমার চারটি প্রশ্ন").crops == []                              # আমার is "my", not mango


# ---------------------------------------------------------------------------------------------- index
def test_index_has_every_rule_and_only_licence_cleared_committed_text(bm25_router):
    idx: Index = bm25_router.index
    rules = [u for u in idx.units if u.kind == "rule"]
    chunks = [u for u in idx.units if u.kind == "chunk"]
    assert len(rules) == len(idx.rules) >= 23
    assert {u.meta["doc_id"] for u in chunks} == {"DOC-CIP-001"}            # never the BRRI sheets (not committed)
    assert all(u.header.startswith("Potato late blight: Technical manual") and "| page " in u.header for u in chunks)
    assert all(len(u.body.split()) <= MAX_WORDS or "." not in u.body.rstrip(".") for u in chunks)
    hilling = next(u for u in chunks if u.meta["section"] == "Hilling")
    assert hilling.maps["R-PLB-005"] == 1.0                                  # its quote is inside the chunk
    assert all(w == PAGE_ONLY_WEIGHT for rid, w in hilling.maps.items() if rid != "R-PLB-005")   # same page only
    bn_rule = next(u for u in rules if u.meta["rule_id"] == "R-BDR-001")
    assert "কুশি" in bn_rule.header and "bph females per hill" in bn_rule.header   # stage words in both languages


def test_a_private_document_is_never_indexed(monkeypatch, tmp_path):
    from services.ask import index as index_mod
    private = tmp_path / "corpus_private" / "DOC-X.txt"
    private.parent.mkdir(parents=True)
    private.write_text("=== PAGE 1 ===\nSecret text that must never be indexed.\n", encoding="utf-8")
    docs = {"DOC-X-001": {"doc_id": "DOC-X-001", "title": "x", "publisher": "x", "licence_status": "cited_permission_requested",
                          "text": str(private), "packs": ["pack-bd-rice"]},
            "DOC-Y-001": {"doc_id": "DOC-Y-001", "title": "y", "publisher": "y", "licence_status": "permitted",
                          "text": str(private), "packs": ["pack-bd-rice"]}}
    monkeypatch.setattr(index_mod, "manifest", lambda: docs)
    assert index_mod.corpus_units(load_lexicon(), {}) == []                   # not cleared, or under corpus_private/


# ---------------------------------------------------------------------------------------------- answers
def test_a_practice_answer_is_the_rule_text_with_a_signed_receipt_bound_to_the_question(bm25_router, store, tmp_path):
    r = ask(bm25_router, store, tmp_path, "When should I harvest my potatoes?", potato("maturity"))
    assert r["status"] == "ok", r
    a = r["answer"]
    rule = bm25_router.index.rules["R-PLB-007"]
    assert a["rule_id"] == "R-PLB-007" and a["via"] == "rule" and a["text"] == rule["action"]["title"]["en"]
    act = a["action"]
    assert act["title"] == rule["action"]["title"] and act["receipt"]["advice"]["phrasing_model"] is None   # rule text only
    assert list(ACTION.iter_errors(act)) == []
    rec = act["receipt"]
    assert {s["quote"] for s in rec["sources"]} == {s["quote"] for s in rule["sources"]}
    import hashlib
    fingerprint = hashlib.sha256("When should I harvest my potatoes?".encode("utf-8")).hexdigest()
    assert any(d["source"] == "farmer:question" and d["value"] == fingerprint for d in rec["data"])
    assert "harvest my potatoes" not in str(rec)          # the words never enter a receipt anyone with the link can open
    assert rec["graph_path"][-3:] == ["render", "validate", "receipt"] and "retrieve_dense:skipped" in rec["graph_path"]
    assert store.verify(a["receipt_credential_id"])["status"] == "authentic"
    assert r["pipeline"]["engine"] == "langgraph" and r["retrieval"]["stages"] == {"bm25": True, "dense": False, "rerank": False}
    assert "BM25 only" in r["retrieval"]["note"] and inbox_items(tmp_path) == []


def test_a_bangla_question_gets_the_bangla_rule_text(bm25_router, store, tmp_path):
    r = ask(bm25_router, store, tmp_path, "ধান কাটার সঠিক সময় কখন?", rice("maturity"), LOW_COUNTS, lang="bn")
    assert r["status"] == "ok" and r["answer"]["rule_id"] == "R-BDR-011"
    assert r["answer"]["text"] == bm25_router.index.rules["R-BDR-011"]["action"]["title"]["bn"] and not r["answer"]["lang_fallback"]


def test_an_input_decision_is_the_weekly_plans_own_decision_and_mints_one_receipt(bm25_router, store, tmp_path):
    creds = lambda: len(list((store.dir / "creds").glob("*.json")))   # noqa: E731
    before = creds()
    r = ask(bm25_router, store, tmp_path, "Do I need to spray for brown planthopper now?", rice("grain_fill"), LOW_COUNTS)
    assert r["status"] == "ok" and r["answer"]["via"] == "plan_decision", r
    plan = make_plan(rice("grain_fill"), LOW_COUNTS, TrustStore("https://k.example", "did:web:k.example", "11" * 32,
                     data_dir=tmp_path / "other"), snap=snap(), inbox_dir=tmp_path / "other-inbox")
    decision = next(a for a in plan["actions"] if a["kind"] == "input_decision")
    assert r["answer"]["rule_id"] == decision["receipt"]["rule_refs"][0]["rule_id"] == "R-BDR-002"
    assert r["answer"]["action"]["decision"] == "dont_spray"
    assert creds() - before == 2                       # the rule's credential and this one receipt: the plan ran dry


def test_an_input_decision_without_data_abstains_like_the_plan(bm25_router, store, tmp_path):
    r = ask(bm25_router, store, tmp_path, "Should I spray my potatoes this week?", potato("vegetative"), weather={})
    assert r["status"] == "abstained" and r["abstention"]["reason_code"] == "data_unavailable"
    [item] = inbox_items(tmp_path)
    assert item["question"] == "Should I spray my potatoes this week?" and item["details"]["unknown_rules"]
    assert list(INBOX_ITEM.iter_errors(item)) == []


# ---------------------------------------------------------------------------------------------- abstentions
@pytest.mark.parametrize("question, field_, why", [
    ("What is the market price of potatoes today?", potato("vegetative"), "no_candidate_above_threshold"),
    ("When should I harvest my potatoes?", potato("vegetative"), "conditions_unmet"),         # the rule is for maturity
    ("How do I grow tomatoes?", rice("tillering"), "other_crop"),
])
def test_no_sourced_answer_goes_to_the_officer_with_a_fixed_message(bm25_router, store, tmp_path, question, field_, why):
    r = ask(bm25_router, store, tmp_path, question, field_)
    assert r["status"] == "abstained" and "answer" not in r
    ab = r["abstention"]
    assert ab["reason_code"] == "question_unanswered" and ab["why"] == why and ab["reason"]["en"] == UNANSWERED
    [item] = inbox_items(tmp_path)
    assert item["item_id"] == ab["inbox_item_id"] and item["question"] == question and item["details"]["why"] == why
    assert list(INBOX_ITEM.iter_errors(item)) == []
    assert not list((store.dir / "creds").glob("*.json"))                  # nothing was signed


def test_unknown_conditions_are_never_treated_as_no(bm25_router, store, tmp_path):
    """The photo-blast rule needs a trusted photo diagnosis; a question cannot supply one."""
    router = Router(embedder=None, reranker=None, thresholds={"bm25": 0.5})
    r = ask(router, store, tmp_path, "My photo shows blast. What should I do about the photo?", rice("grain_fill"), LOW_COUNTS)
    assert r["status"] == "abstained" and r["abstention"]["reason_code"] == "question_unanswered"
    tried = {c["rule_id"]: c for c in r["retrieval"]["candidates"]}
    assert "R-BDR-012" not in tried or tried["R-BDR-012"]["status"] in ("unknown", "does not apply here")


def test_only_the_best_group_may_answer_and_ipm_goes_first_within_it(bm25_router, store):
    rules, facts = bm25_router.index.rules, {"stage": "vegetative", "crop_protected": False}
    no_plan = lambda: pytest.fail("the plan logic should not run")   # noqa: E731
    harvest, irrigation = rules["R-PLB-007"], rules["R-PLB-006"]
    weaker = [dec.Candidate(harvest, 0.90, 1), dec.Candidate(irrigation, 0.60, 2)]
    d = dec.walk(weaker, facts, store, no_plan, margin=0.03)
    assert d["kind"] == "abstain" and d["why"] == "conditions_unmet"      # never a clearly weaker, different answer
    assert [c.status for c in d["tried"]] == ["does not apply here", "weaker match, not used"]
    decision = rules["R-PLB-011"]
    tie = [dec.Candidate(decision, 0.80, 1), dec.Candidate(irrigation, 0.79, 2)]
    assert dec.walk(tie, facts, store, no_plan, margin=0.03)["rule_id"] == "R-PLB-006"          # IPM first in a near tie
    plan = {"status": "ok", "actions": [{"kind": "input_decision", "receipt": {"rule_refs": [{"rule_id": "R-PLB-011"}]}}]}
    d = dec.walk(tie, facts, store, lambda: plan, margin=0.03, input_intent=True)              # "should I spray?"
    assert d["via"] == "plan_decision" and d["rule_id"] == "R-PLB-011"
    alone = [dec.Candidate(decision, 0.80, 1)]                                                   # "will it rain?"
    assert dec.walk(alone, facts, store, no_plan, margin=0.03)["why"] == "decision_not_asked"


def test_a_recalled_rule_is_never_served(bm25_router, store, tmp_path):
    store.recall_rule("R-PLB-007", 1, "test")
    r = ask(bm25_router, store, tmp_path, "When should I harvest my potatoes?", potato("maturity"))
    assert r["status"] == "abstained" and r["abstention"]["reason_code"] == "rule_recalled"


def test_without_a_fixed_threshold_every_question_goes_to_the_officer(store, tmp_path):
    router = Router(embedder=None, reranker=None, thresholds={})
    assert router.mode is None and router.health()["mode"] is None
    r = ask(router, store, tmp_path, "When should I harvest my potatoes?", potato("maturity"))
    assert r["status"] == "abstained" and r["abstention"]["why"] == "uncalibrated"


def test_phone_numbers_and_emails_never_reach_a_receipt_or_the_inbox(bm25_router, store, tmp_path):
    lex = load_lexicon()
    assert dec.redact("কল করুন ০১৭১২-৩৪৫৬৭৮ বা a.b@x.org; ৪টি পোকা", lex.digits) == "কল করুন [removed] বা [removed]; ৪টি পোকা"
    r = ask(bm25_router, store, tmp_path, "When should I harvest my potatoes? 0712 345 678", potato("maturity"))
    rec = r["answer"]["action"]["receipt"]
    assert "0712" not in str(rec) and "harvest my potatoes" not in str(rec)   # only a fingerprint is signed
    assert "0712" not in r["question"]
    r = ask(bm25_router, store, tmp_path, "How do I get a farm loan? me@example.org", potato("maturity"))
    [item] = inbox_items(tmp_path)
    assert r["status"] == "abstained" and item["question"] == "How do I get a farm loan? [removed]"


# ---------------------------------------------------------------------------------------------- the graph and stages
def test_the_pipeline_is_a_compiled_langgraph_with_every_stage(bm25_router):
    from langgraph.graph.state import CompiledStateGraph
    assert isinstance(bm25_router.graph, CompiledStateGraph)
    nodes = set(bm25_router.graph.get_graph().nodes)
    assert {"normalise", "retrieve_bm25", "retrieve_dense", "fuse", "rerank", "match_rules", "decide", "render",
            "validate", "receipt", "abstain"} <= nodes


def test_dense_and_rerank_stages_run_when_their_models_are_there(store, tmp_path):
    rr = FakeReranker()
    router = Router(embedder=FakeEmbedder(), reranker=rr, thresholds={"hybrid+rerank": 0.3, "bm25": 0.5})
    assert router.mode == "hybrid+rerank"
    h = router.health()
    assert h["stages"] == {"bm25": True, "dense": True, "rerank": True} and h["engine"] == "langgraph"
    r = ask(router, store, tmp_path, "When should I harvest my potatoes?", potato("maturity"))
    assert rr.calls == 1 and {"retrieve_dense", "fuse", "rerank"} <= set(r["pipeline"]["path"])
    assert r["status"] == "ok" and r["answer"]["rule_id"] == "R-PLB-007"
    bm25_only = ask(router, store, tmp_path, "When should I harvest my potatoes?", potato("maturity"),
                    stages=("bm25",), threshold=0.5)                          # the evaluation's ablation switch
    assert bm25_only["retrieval"]["stages"]["dense"] is False and rr.calls == 1
    with pytest.raises(ValueError):
        Router(embedder=None, reranker=None, thresholds={"bm25": 0.5}).ask(
            "x", "en", potato("maturity"), FARMER, store, snap=snap(), stages=("bm25", "dense"))


def test_a_threshold_counts_only_with_the_model_it_was_fixed_with(tmp_path):
    cfg = {"retrieval": {}, "messages": {}, "thresholds": {
        "hybrid": {"value": 0.4, "embedder_sha256": "0" * 64}, "bm25": {"value": 0.5}}}
    router = Router(embedder=FakeEmbedder(), reranker=None, config=cfg)
    assert router.mode == "bm25" and "dense: no threshold fixed for this model" in router.note()
    assert router.health()["installed"]["dense"] is True and router.health()["stages"]["dense"] is False


def test_tracing_is_off_inside_the_pipeline(monkeypatch):
    from langsmith.run_helpers import get_tracing_context
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    with ask_graph._no_tracing():
        assert get_tracing_context()["enabled"] is False


# ---------------------------------------------------------------------------------------------- API
@pytest.fixture()
def client(tmp_path, monkeypatch, bm25_router):
    import services.api.main as m
    from collections import defaultdict, deque
    monkeypatch.setattr(m, "_store", TrustStore("https://krishiloop.example", "did:web:krishiloop.example", "11" * 32,
                                                data_dir=tmp_path / "trust"))
    monkeypatch.setenv("KRISHILOOP_ISSUER_SEED", "11" * 32)
    monkeypatch.setattr(m, "ROOT", tmp_path)
    monkeypatch.setattr(m, "_hits", defaultdict(deque))
    monkeypatch.setattr(m, "_ask_cache", type(m._ask_cache)())
    monkeypatch.setattr(m.snap_mod, "build", lambda field: snap())
    monkeypatch.delenv("KRISHILOOP_ASK_MODELS", raising=False)
    monkeypatch.setattr(ask_graph, "_router", bm25_router)
    monkeypatch.setattr(ask_graph, "_router_key", "")
    return TestClient(m.app)


def test_ask_over_http_answers_with_a_verifiable_receipt_or_the_demo_inbox(client):
    sid = client.post("/api/demo/session").json()["session_id"]
    body = {"field_id": "BD-SAMPLE-01", "profile_id": "demo-farmer-d", "question": "Do I need to spray for planthopper now?"}
    r = client.post(f"/api/demo/{sid}/ask", json=body)
    assert r.status_code == 200 and r.json()["status"] == "ok", r.json()
    cid = r.json()["answer"]["receipt_credential_id"]
    v = client.get(f"/api/verify/{cid}").json()
    assert v["status"] == "authentic" and v["sandbox"] is True
    assert client.post(f"/api/demo/{sid}/ask", json=body).json()["ask_id"] == r.json()["ask_id"]   # same question, same answer
    oos = client.post(f"/api/demo/{sid}/ask", json={**body, "question": "How do I apply for a farm loan?", "lang": "en"})
    assert oos.json()["status"] == "abstained" and oos.json()["abstention"]["reason"]["en"] == UNANSWERED
    items = client.get(f"/api/demo/{sid}/inbox").json()["items"]
    assert [i["reason_code"] for i in items] == ["question_unanswered"] and items[0]["question"] == "How do I apply for a farm loan?"


def test_ask_over_http_checks_its_input_and_the_rate_limit(client, monkeypatch):
    import services.api.main as m
    sid = client.post("/api/demo/session").json()["session_id"]
    base = {"field_id": "KE-SAMPLE-01", "profile_id": "demo-farmer-a", "question": "When should I harvest?"}
    assert client.post(f"/api/demo/{sid}/ask", json={**base, "field_id": "XX"}).status_code == 404
    assert client.post(f"/api/demo/{sid}/ask", json={**base, "lang": "../bn"}).status_code == 422
    assert client.post(f"/api/demo/{sid}/ask", json={**base, "question": "   "}).status_code == 422
    assert client.post(f"/api/demo/{sid}/ask", json={**base, "question": "x" * 501}).status_code == 422
    assert client.post("/api/demo/0123456789abcdef/ask", json=base).status_code == 404
    monkeypatch.setattr(m, "PLAN_LIMIT_PER_MIN", 2)
    codes = [client.post(f"/api/demo/{sid}/ask", json={**base, "question": f"When should I harvest, take {i}?"}).status_code
             for i in range(3)]
    assert codes == [200, 200, 429]


def test_ask_health_reports_the_active_stages(client):
    h = client.get("/api/ask/health").json()
    assert h["engine"] == "langgraph" and h["stages"] == {"bm25": True, "dense": False, "rerank": False}
    assert h["installed"] == {"dense": False, "rerank": False} and "BM25 only" in h["note"]
    assert h["index"]["corpus_docs"] == ["DOC-CIP-001"]


def test_a_recall_clears_cached_answers(client):
    sid = client.post("/api/demo/session").json()["session_id"]
    body = {"field_id": "BD-SAMPLE-01", "profile_id": "demo-farmer-d", "question": "Is standing water in my field a problem?"}
    first = client.post(f"/api/demo/{sid}/ask", json=body).json()
    assert first["status"] == "ok" and first["answer"]["rule_id"] == "R-BDR-006", first
    assert client.post(f"/api/demo/{sid}/recall", json={"rule_id": "R-BDR-006", "version": 1}).status_code == 200
    again = client.post(f"/api/demo/{sid}/ask", json=body).json()
    assert again["status"] == "abstained" and again["abstention"]["reason_code"] == "rule_recalled"
    assert client.get(f"/api/verify/{first['answer']['receipt_credential_id']}").json()["status"] == "recalled"


# ---------------------------------------------------------------------------------------------- the seed set is labelled
def test_every_seed_question_is_labelled_synthetic():
    items = [json.loads(line) for line in SEED.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert all(it["synthetic"] is True and "SYNTHETIC" in it["note"] for it in items)
    assert sum(it["category"] == "in_scope" for it in items) >= 55 and sum(it["category"] == "out_of_scope" for it in items) >= 15
    assert {it["lang"] for it in items} == {"bn", "en"}
    assert {it["context"]["pack_id"] for it in items} == {"pack-potato-late-blight", "pack-bd-rice"}
    report = ROOT / "ml" / "ask" / "eval_report.json"
    if report.exists():
        assert json.loads(report.read_text(encoding="utf-8"))["synthetic"] is True


# ---------------------------------------------------------------------------------------------- screens (router 0.2)
from services.ask.screen import load_problems, load_safety  # noqa: E402
from services.engine.validator import validate_action  # noqa: E402

URGENT_EN = ("Your question is about the safe use of pesticides. We don't answer these automatically: it has been sent "
             "to your officer as urgent.")


@pytest.mark.parametrize("question, lang, kind", [
    ("Can I use endosulfan on my rice?", "en", "banned_or_highly_hazardous"),
    ("Can I mix a fungicide and an insecticide in the same tank?", "en", "tank_mix"),
    ("I harvest in two days. Can I spray insecticide today?", "en", "pre_harvest_interval"),
    ("Should I use double the dose so it works faster?", "en", "raising_the_dose"),
    ("Can I spray without gloves?", "en", "no_protective_equipment"),
    ("The bottle has no label. Can I spray it?", "en", "unlabelled_product"),
    ("We sprayed the field yesterday. Can we eat the fish from it?", "en", "food_or_animals_after_spraying"),
    ("Can my children help me spray the field?", "en", "children_or_pregnancy"),
    ("Can I keep drinking water in the empty pesticide bottle?", "en", "other_handling_hazard"),
    ("দুইটা কীটনাশক একসাথে মিশিয়ে দিতে পারি?", "bn", "tank_mix"),
    ("গর্ভবতী অবস্থায় কি কীটনাশক স্প্রে করা যাবে?", "bn", "children_or_pregnancy"),
    ("Je, naweza kunyunyizia dawa bila glavu?", "sw", "no_protective_equipment"),
    # regression from the held-out v2 run (ROUTER_FIX.md): a child's illness must never reach a spray rule
    ("আমার বাচ্চার পেট ব্যথা। কী ওষুধ দিতে পারি?", "bn", "person_unwell"),
    ("My child has a stomach ache. What medicine can I give?", "en", "person_unwell"),
    ("Mtoto wangu ana maumivu ya tumbo. Nimpe dawa gani?", "sw", "person_unwell"),
])
def test_unsafe_intent_goes_to_the_officer_as_urgent_with_no_agronomy(bm25_router, store, tmp_path, question, lang, kind):
    assert kind in [h.type for h in load_safety(load_lexicon()).check(question)]
    f = rice("tillering") if lang == "bn" or "rice" in question else potato("vegetative")
    r = ask(bm25_router, store, tmp_path, question, f, LOW_COUNTS if f["crop"] == "rice" else FARMER, lang=lang)
    assert r["status"] == "abstained" and "answer" not in r
    ab = r["abstention"]
    assert ab["reason_code"] == "unsafe_intent" and ab["priority"] == "urgent" and ab["reason"]["en"] == URGENT_EN
    assert lang in ab["reason"] and "retrieve_bm25" in r["pipeline"]["path"] and "screen" in r["pipeline"]["path"]
    [item] = inbox_items(tmp_path)
    assert item["priority"] == "urgent" and item["reason_code"] == "unsafe_intent" and item["details"]["unsafe"]
    assert list(INBOX_ITEM.iter_errors(item)) == []
    assert not list((store.dir / "creds").glob("*.json"))                  # nothing was signed


def test_the_unsafe_screen_does_not_flag_ordinary_farm_questions():
    """No question of the router's seed set (in scope or out of scope, en and bn) is unsafe."""
    screen = load_safety(load_lexicon())
    items = [json.loads(line) for line in SEED.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert [it["id"] for it in items if screen.check(it["question"])] == []
    for q in ("How much mancozeb should I mix in a 20 litre sprayer?", "Insects are eating the leaves. Should I spray?",
              "Is my field well drained enough for potatoes?", "Do I need to spray for planthopper now?"):
        assert screen.check(q) == [], q


def test_problems_named_per_crop_in_three_languages():
    p = load_problems(load_lexicon())
    assert p.named("How do I control stem borer in rice?", "rice") == ["stem_borer"]
    assert p.named("কারেন্ট পোকা আর মাজরা পোকা দুটোই আছে", "rice") == ["brown_planthopper", "stem_borer"]
    assert p.named("white backed planthopper", "rice") == ["whitebacked_planthopper"]    # longest phrase wins
    assert p.named("Majani yana baa chelewa", "potato") == ["late_blight"]
    assert p.named("Vidukari wamejaa kwenye viazi", "potato") == ["aphids"]
    assert p.named("আলুতে আগাম ধসা দেখা দিয়েছে", "potato") == ["early_blight"]
    assert p.named("brown spots on the leaves and some blight", "rice") == []          # symptoms, generic words
    assert p.named("মাকড়সা দেখা যাচ্ছে", "potato") == []                                # a spider is not a mite


def test_rule_targets_are_derived_from_the_rules_own_texts(bm25_router):
    t = bm25_router.targets
    assert t["R-BDR-002"] == ["brown_planthopper"] and t["R-BDR-008"] == ["blast"] and t["R-BDR-007"] == ["blast"]
    assert t["R-BDR-003"] == ["bacterial_leaf_blight", "brown_planthopper"] and t["R-BDR-010"] == ["bacterial_leaf_blight"]
    assert t["R-BDR-011"] == []                                                     # harvest: about no problem
    assert all(t[f"R-PLB-{i:03d}"] == ["late_blight"] for i in range(1, 12))       # the pack's every_rule_targets
    assert bm25_router.health()["screens"]["problems"]["rule_targets"] == t


def test_a_problem_no_rule_covers_goes_to_the_officer(bm25_router, store, tmp_path):
    r = ask(bm25_router, store, tmp_path, "How do I control stem borer in my rice?", rice("tillering"), LOW_COUNTS)
    assert r["status"] == "abstained" and r["abstention"]["reason_code"] == "no_rule_for_problem"
    assert r["abstention"]["priority"] == "normal"
    [item] = inbox_items(tmp_path)
    assert item["details"]["problems_not_covered"] == ["stem_borer"] and list(INBOX_ITEM.iter_errors(item)) == []
    r = ask(bm25_router, store, tmp_path, "Vidukari wako kwenye viazi vyangu. Nifanye nini?", potato("vegetative"), lang="sw")
    assert r["abstention"]["reason_code"] == "no_rule_for_problem" and "sw" in r["abstention"]["reason"]


def test_a_candidate_for_another_problem_never_answers(bm25_router, store):
    rules, facts = bm25_router.index.rules, {"stage": "tillering", "bph_females_per_hill": 0, "bph_nymphs_per_hill": 1}
    no_plan = lambda: pytest.fail("the plan logic should not run")   # noqa: E731
    hopper, blast = dec.Candidate(rules["R-BDR-002"], 0.9, 1), dec.Candidate(rules["R-BDR-008"], 0.7, 2)
    d = dec.walk([hopper, blast], facts, store, no_plan, 0.03, True, ["blast"], bm25_router.targets)
    assert d["kind"] == "answer" and d["rule_id"] == "R-BDR-008"                 # the blast rule, not the spray decision
    assert {c.rule["rule_id"]: c.status for c in d["tried"]}["R-BDR-002"] == "targets another problem"
    d = dec.walk([dec.Candidate(rules["R-BDR-002"], 0.9, 1)], facts, store, no_plan, 0.03, True, ["blast"],
                 bm25_router.targets)
    assert d["kind"] == "abstain" and d["why"] == "no_candidate_for_problem"
    plan = {"status": "ok", "actions": [{"kind": "input_decision", "receipt": {"rule_refs": [{"rule_id": "R-BDR-002"}]}}]}
    bl = dec.Candidate(rules["R-BDR-003"], 0.9, 1)                   # targets leaf blight AND planthopper ...
    d = dec.walk([bl], facts, store, lambda: plan, 0.03, True, ["bacterial_leaf_blight"], bm25_router.targets)
    assert d["kind"] == "abstain" and d["why"] == "plan_decision_other_problem"   # ... but the plan chose a hopper rule


def test_the_potato_pack_has_pending_review_bangla_and_swahili_text_that_passes_the_validator(bm25_router):
    import unicodedata
    for i in range(1, 12):
        r = bm25_router.index.rules[f"R-PLB-{i:03d}"]
        title = r["action"]["title"]
        assert set(title) == {"en", "bn", "sw"} and unicodedata.normalize("NFC", title["bn"]) == title["bn"]
        assert "pending native-speaker review" in r["review"]["translations"] and r["review"]["level"] == "pending"
        act = {"title": title, "receipt": {"sources": [{"quote": s["quote"]} for s in r["sources"]], "rule_refs": [{}]}}
        assert validate_action(act) == [], r["rule_id"]


def test_answers_come_in_the_farmers_language_or_say_they_do_not(bm25_router, store, tmp_path):
    bn = ask(bm25_router, store, tmp_path, "আলু কখন তুলব?", potato("maturity"), lang="bn")
    assert bn["status"] == "ok" and bn["answer"]["rule_id"] == "R-PLB-007" and bn["answer"]["text_lang"] == "bn"
    assert not bn["answer"]["lang_fallback"] and "lang_notice" not in bn["answer"]
    sw = ask(bm25_router, store, tmp_path, "Nivune viazi vyangu lini?", potato("maturity"), lang="sw")
    assert sw["status"] == "ok" and sw["answer"]["text_lang"] == "sw" and not sw["answer"]["lang_fallback"]
    fr = ask(bm25_router, store, tmp_path, "When should I harvest my potatoes?", potato("maturity"), lang="fr")
    assert fr["answer"]["lang_fallback"] and fr["answer"]["text_lang"] == "en"
    assert fr["answer"]["lang_notice"]["en"].startswith("This advice is not yet available in your language")


def test_swahili_spray_questions_reach_the_plan_decision(bm25_router, store, tmp_path):
    r = ask(bm25_router, store, tmp_path, "Je, ninyunyizie viazi vyangu dawa ya ukungu wiki hii?", potato("vegetative"),
            lang="sw")
    assert r["status"] == "ok" and r["answer"]["via"] == "plan_decision" and r["answer"]["rule_id"] == "R-PLB-011"
    assert r["answer"]["text"] == bm25_router.index.rules["R-PLB-011"]["action"]["title"]["sw"]


def test_urgent_inbox_cases_are_listed_first(tmp_path):
    from services.engine import inbox
    a = inbox.create("F", "p", "question_unanswered", {"en": "x"}, {}, tmp_path, extra={"priority": "normal"})
    b = inbox.create("F", "p", "unsafe_intent", {"en": "y"}, {}, tmp_path, extra={"priority": "urgent"})
    c = inbox.create("F", "p", "data_stale", {"en": "z"}, {}, tmp_path)
    ids = [i["item_id"] for i in inbox.list_items(tmp_path)]
    assert ids[0] == b and set(ids) == {a, b, c}
