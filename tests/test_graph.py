"""Provenance graph (Kuzu) and Graph RAG in the Ask router. No network; receipts come from the real issuing code."""
import json
from collections import defaultdict, deque
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from services.ask import graph as ask_graph
from services.ask.graph import Router
from services.graph import build_graph, recall_blast_radius, rules_citing_same_source
from services.trust.store import TrustStore

ROOT = Path(__file__).resolve().parents[1]
FARMER = {"farmer_profile_id": "t-farmer", "crop_protected": False, "soil_drainage": "good"}
POTATO = {"field_id": "T-POTATO", "pack_id": "pack-potato-late-blight", "crop": "potato", "stage": "maturity",
          "country": "KE", "precision": "sample_location"}


def _snap() -> dict:
    day = {"rh_mean_pct": 55, "tmin_c": 14, "tmax_c": 24, "precip_mm": 0.0}
    days = [{"date": (date.today() + timedelta(days=i)).isoformat(), **day} for i in range(7)]
    return {"snapshot_id": "snap-test", "field_id": "t", "mode": "sample", "location": {"precision": "sample_location"},
            "created_at": "2026-11-20T00:00:00Z", "forecast": {"source": "test", "issued_at": "2026-11-20T00:00:00Z", "days": days}}


@pytest.fixture()
def store(tmp_path):
    return TrustStore("https://krishiloop.example", "did:web:krishiloop.example", "11" * 32, data_dir=tmp_path / "trust")


@pytest.fixture(scope="module")
def router():
    return Router(embedder=None, reranker=None, thresholds={"bm25": 0.6}, graph_expand=True)


def _ask(router, store, tmp_path, q="When should I harvest my potatoes?"):
    return router.ask(q, "en", POTATO, FARMER, store, inbox_dir=tmp_path / "inbox", snap=_snap())


def test_graph_builds_from_the_registry_even_with_no_receipts(tmp_path):
    with build_graph(tmp_path / "g.kuzu", trust_dirs=[]) as g:
        assert g.stats["rules"] == 23 and g.stats["packs"] == 2 and g.stats["receipts"] == 0
        assert g.stats["sources"] >= 5 and g.stats["quotes"] >= 23
        assert g.recall_blast_radius("R-PLB-005", 1) == []
    with build_graph(tmp_path / "g.kuzu", trust_dirs=[]) as g:    # building again over the same path starts clean
        assert g.stats["rules"] == 23


def test_blast_radius_after_issuing_receipts_and_recalling(router, store, tmp_path):
    first = _ask(router, store, tmp_path)
    assert first["status"] == "ok", first
    rid, ver = first["answer"]["rule_id"], first["answer"]["rule_version"]
    cred_id = first["answer"]["receipt_credential_id"]
    other = router.ask("Should I spray now?", "en", {**POTATO, "stage": "vegetative"}, FARMER, store,
                       inbox_dir=tmp_path / "inbox", snap=_snap())
    with build_graph(trust_dirs=[store.dir]) as g:
        assert g.stats["receipts"] >= 1
        assert cred_id in recall_blast_radius(g, rid, ver)
        if other["status"] == "ok" and other["answer"]["rule_id"] != rid:   # a receipt for another rule is not touched
            assert other["answer"]["receipt_credential_id"] not in g.recall_blast_radius(rid, ver)
    hits = store.recall_rule(rid, ver, "test")
    assert hits and store.verify(cred_id)["status"] == "recalled"            # status list stays the source of truth
    with build_graph(trust_dirs=[store.dir]) as g:
        assert cred_id in g.recall_blast_radius(rid, ver)                    # the graph still names what the recall touched


def test_sibling_rules_share_a_source_page():
    with build_graph(trust_dirs=[]) as g:
        sibs = rules_citing_same_source(g, "R-PLB-001", 1)
        assert {s["rule_id"] for s in sibs} >= {"R-PLB-002", "R-PLB-003", "R-PLB-005"}
        assert all(s["source"] == "DOC-CIP-001#p27" and s["pack_id"] == "pack-potato-late-blight" for s in sibs)
        assert "R-PLB-001" not in {s["rule_id"] for s in sibs}
        assert g.rules_citing_same_source("R-NOPE-001", 1) == []


def test_graph_rag_records_the_step_and_never_changes_the_outcome(store, tmp_path):
    on = Router(embedder=None, reranker=None, thresholds={"bm25": 0.6}, graph_expand=True)
    off = Router(embedder=None, reranker=None, thresholds={"bm25": 0.6}, graph_expand=False)
    assert on.siblings and not off.siblings
    questions = ["When should I harvest my potatoes?", "How do I choose a potato variety to avoid late blight?",
                 "Should I hill up my potato plants?", "What should I do about the weather this week?"]
    added = 0
    for q in questions:
        a, b = _ask(on, store, tmp_path, q), _ask(off, store, tmp_path, q)
        assert a["status"] == b["status"]
        assert (a.get("answer") or {}).get("rule_id") == (b.get("answer") or {}).get("rule_id")
        assert "graph_expand" in a["pipeline"]["path"] and "graph_expand:skipped" in b["pipeline"]["path"]
        assert [h["rule_id"] for h in a["retrieval"]["candidates"]][:1] == [h["rule_id"] for h in b["retrieval"]["candidates"]][:1]
        for e in a["retrieval"]["graph_expansion"]:
            assert e["rule_id"] != e["from_rule_id"] and e["source"].startswith("DOC-")
        added += len(a["retrieval"]["graph_expansion"])
    assert added > 0            # siblings of a matched rule really were added as lower-scored candidates


def test_graph_rag_cannot_make_a_sibling_answer_on_its_own(router, store, tmp_path):
    r = _ask(router, store, tmp_path, "When should I harvest my potatoes?")
    top = r["retrieval"]["top_retrieved"][0]
    for e in r["retrieval"]["graph_expansion"]:
        assert e["score"] < top["score"]                                   # lent score is always below the parent's
    assert all(c["confidence"] >= 0.6 for c in r["retrieval"]["candidates"])   # candidates still clear the threshold


def test_recall_response_includes_the_graph_blast_radius(tmp_path, monkeypatch, router):
    import services.api.main as m
    monkeypatch.setattr(m, "ROOT", tmp_path)
    monkeypatch.setattr(m, "_hits", defaultdict(deque))
    monkeypatch.setattr(m, "_ask_cache", type(m._ask_cache)())
    monkeypatch.setattr(m.snap_mod, "build", lambda field: _snap())
    monkeypatch.setattr(m, "_store", TrustStore("https://krishiloop.example", "did:web:krishiloop.example", "11" * 32,
                                                data_dir=tmp_path / "trust"))
    monkeypatch.setenv("KRISHILOOP_ISSUER_SEED", "11" * 32)
    monkeypatch.delenv("KRISHILOOP_ASK_MODELS", raising=False)
    monkeypatch.setattr(ask_graph, "_router", router)
    monkeypatch.setattr(ask_graph, "_router_key", "")
    c = TestClient(m.app)
    sid = c.post("/api/demo/session").json()["session_id"]
    body = {"field_id": "BD-SAMPLE-01", "profile_id": "demo-farmer-d", "question": "Is standing water in my field a problem?"}
    first = c.post(f"/api/demo/{sid}/ask", json=body).json()
    assert first["status"] == "ok", first
    out = c.post(f"/api/demo/{sid}/recall", json={"rule_id": "R-BDR-006", "version": 1}).json()
    gb = out["graph_blast_radius"]
    assert first["answer"]["receipt_credential_id"] in gb["receipt_credential_ids"] and gb["receipts"] >= 1
    assert out["recalled_rule_credentials"]                                 # the existing status-list logic is unchanged
    json.dumps(out)
