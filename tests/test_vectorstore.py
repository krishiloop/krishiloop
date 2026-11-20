"""LanceDB vector store for the Ask index: same ranking as the in-memory dense search, on the real e5 index when the
model files are installed (KRISHILOOP_ASK_MODELS or D:/AI_congress/models/ask), else on a fixture with fixed vectors."""
import os
from pathlib import Path

import numpy as np
import pytest

from services.ask import retrieve, vectorstore
from services.ask.index import Index
from services.ask.lexical import load_lexicon

MODELS = Path(os.environ.get("KRISHILOOP_ASK_MODELS") or "D:/AI_congress/models/ask")


class FixedEmbedder:
    """Deterministic unit vectors (seeded by the text) so the test needs no model."""
    name = "fixed-test@1"

    def embed(self, texts, kind):
        out = []
        for t in texts:
            rng = np.random.default_rng(abs(hash_text(t)) % (2**32))
            v = rng.standard_normal(32).astype(np.float32)
            out.append(v / np.linalg.norm(v))
        return np.vstack(out)


def hash_text(t):
    import hashlib
    return int(hashlib.sha256(t.encode()).hexdigest()[:12], 16)


def _same_ranking(index, embedder, questions):
    packs = sorted(index.by_pack)
    for q in questions:
        qv = embedder.embed([q], "query")[0]
        for pack in packs:
            via_store = retrieve.dense(index, qv, pack)
            store, index.store = index.store, None          # force the in-memory path
            try:
                in_mem = retrieve.dense(index, qv, pack)
            finally:
                index.store = store
            assert len(via_store) == len(in_mem)
            for a, b in zip(via_store, in_mem):
                assert abs(a.score - b.score) < 1e-5 and abs(a.conf - b.conf) < 1e-5
            # same order, except where scores tie within float noise
            ra, rb = [h.rule_id for h in via_store], [h.rule_id for h in in_mem]
            if ra != rb:
                sa = {h.rule_id: h.score for h in via_store}
                assert all(abs(sa[x] - sa[y]) < 1e-5 for x, y in zip(ra, rb))


QUESTIONS = ["when should I spray against late blight", "potato leaves have dark spots after rain",
             "ধানে পোকা দেখা দিলে কী করব", "how to store seed potatoes", "what to do about brown planthopper"]


def test_store_is_written_and_matches_in_memory_search_on_a_fixture(tmp_path):
    emb = FixedEmbedder()
    index = Index(load_lexicon(), emb, vector_dir=tmp_path / "v")
    assert index.store is not None
    m = index.store.manifest
    assert m["rows"] == len(index.units) and m["model"] == "fixed-test@1" and m["dim"] == 32
    assert index.store.matches(index.units, "fixed-test@1") and not index.store.matches(index.units, "other")
    assert index.stats()["vector_store"]["rows"] == len(index.units)
    assert vectorstore.VectorStore.open(tmp_path / "v").manifest == m
    rows = index.store.table.to_arrow().to_pylist()
    kinds = {r["kind"] for r in rows}
    assert kinds == {"rule", "chunk"} and all(r["pack"] and r["lang"] for r in rows)
    assert any(r["doc"] == "DOC-CIP-001" and r["page"] > 0 for r in rows if r["kind"] == "chunk")
    _same_ranking(index, emb, QUESTIONS)


def test_the_store_is_off_without_a_folder_and_retrieval_falls_back(monkeypatch):
    monkeypatch.setenv(vectorstore.ENV, "")
    emb = FixedEmbedder()
    index = Index(load_lexicon(), emb)
    assert index.store is None and "in-memory" in index.stats()["vector_store"]
    pack = sorted(index.by_pack)[0]
    assert retrieve.dense(index, emb.embed(["x"], "query")[0], pack)


def test_a_broken_store_never_breaks_retrieval(tmp_path):
    emb = FixedEmbedder()
    index = Index(load_lexicon(), emb, vector_dir=tmp_path / "v")
    index.store.search = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("disk gone"))
    pack = sorted(index.by_pack)[0]
    assert retrieve.dense(index, emb.embed(["x"], "query")[0], pack)


def test_a_pack_id_cannot_inject_into_the_filter(tmp_path):
    index = Index(load_lexicon(), FixedEmbedder(), vector_dir=tmp_path / "v")
    with pytest.raises(ValueError):
        index.store.search(np.zeros(32, np.float32), "x' OR '1'='1")


@pytest.mark.skipif(not (MODELS / "embedder" / "model.onnx").exists(), reason="e5 model files not installed")
def test_real_e5_index_store_matches_in_memory(tmp_path, monkeypatch):
    from services.ask import models as text_models
    monkeypatch.setenv(text_models.ENV, str(MODELS))
    text_models._loaded.clear()
    emb = text_models.load_embedder()
    assert emb is not None
    index = Index(load_lexicon(), emb, vector_dir=tmp_path / "v")
    assert index.store.manifest["model"] == emb.name and index.store.manifest["dim"] == 384
    _same_ranking(index, emb, QUESTIONS)
