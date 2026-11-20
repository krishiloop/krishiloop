"""Retrieval stages of the Ask router. Each stage ranks the RULES of the field's pack (never another pack's), pooling
its unit scores per rule: a rule's own unit counts in full, a corpus chunk with its mapping weight. Confidence counts
only direct evidence (the rule's own unit, or a chunk that holds its quote): a chunk that merely shares a page with
the rule's quote can lift the rule in the ranking, never over the threshold.

- bm25:   ranks by BM25; confidence = coverage (idf-weighted share of the question's concepts found);
- dense:  ranks by cosine similarity of multilingual-e5-small vectors (LanceDB vector search when the store is
          there, the in-memory matrix otherwise); confidence = that cosine;
- fuse:   reciprocal-rank fusion (k=60) of the active stages; confidence = mean of the stages' confidences;
- rerank: the cross-encoder reads the question with each of the top fused rules' own text; confidence = its
          sigmoid score, and the order follows it.
Retrieval only proposes; services/ask/decide.py decides.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from services.ask.index import Index, rule_passage
from services.ask.lexical import Query


@dataclass
class Hit:
    rule_id: str
    score: float      # what this stage ranks by
    conf: float       # this stage's confidence in [0, 1]
    unit: str = ""    # the unit that gave the best score

    def row(self) -> dict:
        return {"rule_id": self.rule_id, "score": round(float(self.score), 4), "confidence": round(float(self.conf), 4),
                "unit": self.unit}


def _pool(index: Index, pack_id: str, docs: list[int], scores: list[tuple[float, float]]) -> list[Hit]:
    allowed = set(index.pack_rules(pack_id))
    best: dict[str, Hit] = {rid: Hit(rid, 0.0, 0.0) for rid in allowed}
    for i, (s, c) in zip(docs, scores):
        u = index.units[i]
        for rid, w in u.maps.items():
            if rid not in allowed:
                continue
            h = best[rid]
            if s * w > h.score:
                h.score, h.unit = s * w, u.uid
            if w >= 1.0:   # confidence needs direct evidence: the rule itself, or a chunk holding its quote
                h.conf = max(h.conf, c)
    return sorted(best.values(), key=lambda h: (-h.score, -h.conf, h.rule_id))


def bm25(index: Index, q: Query, pack_id: str) -> list[Hit]:
    docs = index.by_pack.get(pack_id, [])
    return _pool(index, pack_id, docs, index.bm25.score(q, docs))


def dense(index: Index, qvec: np.ndarray, pack_id: str) -> list[Hit]:
    docs = index.by_pack.get(pack_id, [])
    store = getattr(index, "store", None)
    if docs and store is not None:      # LanceDB vector search over the pack's rows; the same cosines as the matrix below
        try:
            found = dict(store.search(qvec, pack_id))
            if set(found) == set(docs):
                cos = [found[i] for i in docs]
                return _pool(index, pack_id, docs, [(max(c, 0.0), min(max(c, 0.0), 1.0)) for c in cos])
        except Exception:
            pass                        # the store must never break an answer: use the in-memory vectors
    cos = [float(c) for c in index.vectors[docs] @ qvec.reshape(-1)] if docs else []
    return _pool(index, pack_id, docs, [(max(c, 0.0), min(max(c, 0.0), 1.0)) for c in cos])


def fuse(lists: list[list[Hit]], k: int = 60) -> list[Hit]:
    """Reciprocal-rank fusion: sum of 1/(k + rank) over the stage lists; confidence = mean stage confidence."""
    if len(lists) == 1:
        return [Hit(h.rule_id, h.score, h.conf, h.unit) for h in lists[0]]
    rrf: dict[str, float] = {}
    conf: dict[str, list[float]] = {}
    unit: dict[str, str] = {}
    for hits in lists:
        for rank, h in enumerate(hits, start=1):
            rrf[h.rule_id] = rrf.get(h.rule_id, 0.0) + 1.0 / (k + rank)
            conf.setdefault(h.rule_id, []).append(h.conf)
            unit.setdefault(h.rule_id, h.unit)
    out = [Hit(rid, s, sum(conf[rid]) / len(lists), unit[rid]) for rid, s in rrf.items()]
    return sorted(out, key=lambda h: (-h.score, -h.conf, h.rule_id))


def rerank(index: Index, reranker, question: str, lang: str, hits: list[Hit], top_n: int) -> list[Hit]:
    head = hits[:top_n]
    passages = [rule_passage(index.rules[h.rule_id], lang) for h in head]
    probs = [float(p) for p in reranker.score(question, passages)] if head else []
    ranked = sorted((Hit(h.rule_id, p, p, h.unit) for h, p in zip(head, probs)), key=lambda h: (-h.score, h.rule_id))
    return ranked + [Hit(h.rule_id, 0.0, 0.0, h.unit) for h in hits[top_n:]]   # not reranked: never above a threshold
