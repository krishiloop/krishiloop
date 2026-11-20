"""The Ask router, run as a LangGraph graph (this is the only code path; nothing bypasses the graph):

    normalise -> screen -> retrieve_bm25 || retrieve_dense -> fuse -> rerank -> match_rules -> decide
              -> render -> validate -> receipt -> END
       decide / validate / receipt -> abstain -> END

`screen` (services/ask/screen.py) finds unsafe intent and the pests or diseases the question names; match_rules turns
them into gates (unsafe intent first: an urgent officer case) and a problem filter on the candidates.

Every node is deterministic and no language model writes anything: a farmer gets one rule's validated text with a
signed receipt, or the case goes to the officer. A stage whose model is not installed, or whose threshold was never
fixed for that model, is skipped, and the answer and GET /api/ask/health say so.
"""
from __future__ import annotations

import contextlib
import operator
import os
import threading
import uuid
from datetime import date, datetime, timezone
from importlib import metadata
from pathlib import Path
from typing import Annotated, Any, TypedDict

import yaml
from langgraph.graph import END, START, StateGraph

from services.ask import decide as dec
from services.ask import models as text_models
from services.ask import retrieve
from services.ask import screen as scr
from services.ask.index import Index
from services.ask.lexical import load_lexicon
from services.engine import snapshot as snap_mod
from services.engine.validator import validate_action
from services.trust.store import RuleRecalled

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / "rules" / "ask" / "router.yaml"
# runtime modes, richest first; "dense" alone exists only for the evaluation's ablation
MODES = {"hybrid+rerank": ("bm25", "dense", "rerank"), "hybrid": ("bm25", "dense"), "bm25+rerank": ("bm25", "rerank"),
         "bm25": ("bm25",)}
ABLATION_MODES = {"bm25": ("bm25",), "dense": ("dense",), "hybrid": ("bm25", "dense"),
                  "bm25+rerank": ("bm25", "rerank"), "hybrid+rerank": ("bm25", "dense", "rerank")}
NEEDS = {"dense": "embedder", "rerank": "reranker"}


def mode_of(stages) -> str:
    s = set(stages)
    base = "hybrid" if {"bm25", "dense"} <= s else ("bm25" if "bm25" in s else "dense")
    return base + ("+rerank" if "rerank" in s else "")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@contextlib.contextmanager
def _no_tracing():
    """The farmer's question never leaves the server through LangSmith tracing, whatever the environment says."""
    try:
        from langsmith import tracing_context
    except ImportError:
        yield
        return
    with tracing_context(enabled=False):
        yield


class AskState(TypedDict, total=False):
    question: str
    lang: str
    field: dict
    profile: dict
    store: Any
    inbox_dir: Any
    snap: Any
    today: date
    stages: tuple
    mode: str
    tau: Any
    ask_id: str
    asked_at: str
    query: Any
    unsafe: list
    named: list
    bm25: Any
    dense: Any
    fused: list
    ranked: list
    graph_added: list
    facts: dict
    stale: bool
    gate: Any
    candidates: list
    decision: dict
    action: dict
    result: dict
    path: Annotated[list, operator.add]


class Router:
    def __init__(self, embedder: Any = "auto", reranker: Any = "auto", thresholds: dict | None = None,
                 config: dict | None = None, graph_expand: bool | None = None):
        self.config = config or yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))
        self.retrieval = self.config.get("retrieval") or {}
        self.messages = {k: v for k, v in (self.config.get("messages") or {}).items() if k != "review"}
        self.lex = load_lexicon()
        self.safety = scr.load_safety(self.lex)
        self.problems = scr.load_problems(self.lex)
        self.embedder = text_models.load_embedder() if embedder == "auto" else embedder
        self.reranker = text_models.load_reranker() if reranker == "auto" else reranker
        self.index = Index(self.lex, self.embedder)
        self.targets = {rid: self.problems.rule_targets(r) for rid, r in self.index.rules.items()}
        self.fitted = self.config.get("thresholds") or {}
        self.thresholds = self._usable_thresholds() if thresholds is None else dict(thresholds)
        usable = [m for m, st in MODES.items() if self._available(st) and m in self.thresholds]
        chosen = (self.config.get("selected_mode") or {}).get("mode") if thresholds is None else None
        self.mode = chosen if chosen in usable else (usable[0] if usable else None)
        self.siblings = self._sibling_map(graph_expand)   # Graph RAG: rule -> [(sibling, source page)], {} when off
        self.graph = self._build()

    # ------------------------------------------------------------------ set-up
    def _available(self, stages) -> bool:
        return all(getattr(self, NEEDS[s]) is not None for s in stages if s in NEEDS)

    def _usable_thresholds(self) -> dict[str, float]:
        """A fitted threshold counts only with the exact model files it was fixed with."""
        out = {}
        for mode, t in self.fitted.items():
            if not isinstance(t, dict) or t.get("value") is None or mode not in MODES:
                continue
            ok = all(getattr(self, NEEDS[s]) is not None and getattr(self, NEEDS[s]).sha256 == t.get(f"{NEEDS[s]}_sha256")
                     for s in MODES[mode] if s in NEEDS)
            if ok:
                out[mode] = float(t["value"])
        return out

    def _build(self):
        g = StateGraph(AskState)
        for name, fn in (("normalise", self._normalise), ("screen", self._screen), ("retrieve_bm25", self._bm25),
                         ("retrieve_dense", self._dense),
                         ("fuse", self._fuse), ("rerank", self._rerank), ("graph_expand", self._graph_expand),
                         ("match_rules", self._match),
                         ("decide", self._decide), ("render", self._render), ("validate", self._validate),
                         ("receipt", self._receipt), ("abstain", self._abstain)):
            g.add_node(name, fn)
        g.add_edge(START, "normalise")
        g.add_edge("normalise", "screen")
        g.add_edge("screen", "retrieve_bm25")
        g.add_edge("screen", "retrieve_dense")
        g.add_edge(["retrieve_bm25", "retrieve_dense"], "fuse")
        g.add_edge("fuse", "rerank")
        g.add_edge("rerank", "graph_expand")
        g.add_edge("graph_expand", "match_rules")
        g.add_edge("match_rules", "decide")
        g.add_conditional_edges("decide", lambda s: "render" if s["decision"]["kind"] == "answer" else "abstain",
                                ["render", "abstain"])
        g.add_edge("render", "validate")
        g.add_conditional_edges("validate", lambda s: "receipt" if s["decision"]["kind"] == "answer" else "abstain",
                                ["receipt", "abstain"])
        g.add_conditional_edges("receipt", lambda s: END if s.get("result") else "abstain", [END, "abstain"])
        g.add_edge("abstain", END)
        return g.compile()

    # ------------------------------------------------------------------ nodes
    def _normalise(self, s: AskState) -> dict:
        return {"query": self.lex.analyse(s["question"]), "ask_id": str(uuid.uuid4()), "asked_at": _now(),
                "path": ["normalise"]}

    def _screen(self, s: AskState) -> dict:
        """Unsafe intent and the problems named, from the question as written (the field's crop picks the list)."""
        return {"unsafe": [h.row() for h in self.safety.check(s["question"])],
                "named": self.problems.named(s["question"], s["field"]["crop"]), "path": ["screen"]}

    def pack_problems(self, pack_id: str) -> set[str]:
        return {p for rid in self.index.pack_rules(pack_id) for p in self.targets.get(rid, ())}

    def _bm25(self, s: AskState) -> dict:
        if "bm25" not in s["stages"]:
            return {"bm25": None, "path": ["retrieve_bm25:skipped"]}
        return {"bm25": retrieve.bm25(self.index, s["query"], s["field"]["pack_id"]), "path": ["retrieve_bm25"]}

    def _dense(self, s: AskState) -> dict:
        if "dense" not in s["stages"]:
            return {"dense": None, "path": ["retrieve_dense:skipped"]}
        qv = self.embedder.embed([s["query"].dense_text], "query")[0]
        return {"dense": retrieve.dense(self.index, qv, s["field"]["pack_id"]), "path": ["retrieve_dense"]}

    def _fuse(self, s: AskState) -> dict:
        lists = [x for x in (s.get("bm25"), s.get("dense")) if x is not None]
        return {"fused": retrieve.fuse(lists, int(self.retrieval.get("rrf_k", 60))) if lists else [],
                "path": ["fuse" if len(lists) > 1 else "fuse:single-stage" if lists else "fuse:skipped"]}

    def _rerank(self, s: AskState) -> dict:
        if "rerank" not in s["stages"]:
            return {"ranked": s["fused"], "path": ["rerank:skipped"]}
        ranked = retrieve.rerank(self.index, self.reranker, s["query"].text, s["lang"], s["fused"],
                                 int(self.retrieval.get("rerank_top_n", 8)))
        return {"ranked": ranked, "path": ["rerank"]}

    def _sibling_map(self, enabled: bool | None) -> dict[str, list[tuple[str, str]]]:
        """Graph RAG: which rules cite the same source page, walked once from the Kuzu provenance graph (rules only)
        and kept as a plain map so a request never touches the database. On by default; KRISHILOOP_ASK_GRAPH=0 or
        graph_expand=False turns it off. Empty if Kuzu is not installed."""
        if enabled is None:
            enabled = os.environ.get("KRISHILOOP_ASK_GRAPH", "1") != "0"
        if not enabled:
            return {}
        try:
            from services.graph import build_graph
            with build_graph(trust_dirs=[]) as g:
                return {rid: [(x["rule_id"], x["source"]) for x in g.rules_citing_same_source(rid, r["version"])
                              if x["rule_id"] in self.index.rules]
                        for rid, r in self.index.rules.items()}
        except Exception:
            return {}

    def _graph_expand(self, s: AskState) -> dict:
        """Graph RAG, as a tie-breaker only. Each of the top-k rules that reached the threshold lends half its score to the
        rules citing the same source page, so a sibling the ranking left out can enter the top-k. Confidence is never
        changed: a sibling still has to clear the threshold on its own evidence, so this cannot create an answer."""
        tau = s.get("tau")
        if not self.siblings or tau is None or not s.get("ranked"):
            return {"graph_added": [], "path": ["graph_expand:skipped"]}
        k = self.walk_settings()[0]
        ranked = [retrieve.Hit(h.rule_id, h.score, h.conf, h.unit) for h in s["ranked"]]
        by_id, added = {h.rule_id: h for h in ranked}, []
        for parent in [h for h in s["ranked"][:k] if h.conf >= tau]:
            for sib, src in self.siblings.get(parent.rule_id, ()):
                h = by_id.get(sib)
                if h is not None and parent.score * 0.5 > h.score:
                    h.score, h.unit = parent.score * 0.5, f"graph:{parent.rule_id}"
                    added.append({"rule_id": sib, "from_rule_id": parent.rule_id, "source": src,
                                  "score": round(float(h.score), 4)})
        ranked.sort(key=lambda h: (-h.score, -h.conf, h.rule_id))
        return {"ranked": ranked, "graph_added": added, "path": ["graph_expand"]}

    def _match(self, s: AskState) -> dict:
        """The field's facts (as the planner computes them), and the candidates that clear the threshold."""
        f = s["field"]
        snap = s.get("snap") or self._snapshot(f)
        facts, stale = dec.field_facts(f, s["profile"], snap, s["today"])
        q, tau = s["query"], s.get("tau")
        uncovered = sorted(set(s.get("named") or []) - self.pack_problems(f["pack_id"]))
        gate = dec.gate(q, f, tau, s.get("unsafe"), uncovered)
        cands = [] if gate else dec.candidates(s["ranked"], self.index.rules, tau, self.walk_settings()[0])
        return {"snap": snap, "facts": facts, "stale": stale, "gate": gate, "candidates": cands, "path": ["match_rules"]}

    def _decide(self, s: AskState) -> dict:
        gate = s.get("gate")
        if gate:
            details = {"unsafe": s.get("unsafe")} if gate == "unsafe_intent" else \
                {"problems_not_covered": sorted(set(s.get("named") or []) - self.pack_problems(s["field"]["pack_id"]))} \
                if gate == "no_rule_for_problem" else {}
            d = {"kind": "abstain", "code": dec.GATE_CODES.get(gate, "question_unanswered"), "why": gate, "tried": [],
                 "details": details}
        else:
            d = dec.walk(s["candidates"], s["facts"], s["store"],
                         lambda: dec.plan_decision(s["field"], s["profile"], s["store"], s["snap"], s["today"]),
                         self.walk_settings()[1], s["query"].input_intent, s.get("named") or (), self.targets)
        return {"decision": d, "path": ["decide"]}

    def _render(self, s: AskState) -> dict:
        d = s["decision"]
        rule = self.index.rules[d["rule_id"]]
        ctx = dec.answer_context(s["ask_id"], s["field"], s["snap"], s["today"])
        path = s["path"] + ["render", "validate", "receipt"]
        act = dec.render(rule, ctx, s["snap"], s["facts"], s["today"], self._question(s), s["asked_at"],
                         {"conf": d["conf"], "mode": s["mode"], "tau": s["tau"], "via": d["via"], "matched": d["matched"]},
                         path)
        return {"action": act, "path": ["render"]}

    def _validate(self, s: AskState) -> dict:
        problems = validate_action(s["action"])
        if problems:
            d = {"kind": "abstain", "code": "validator_blocked", "why": "validator_blocked", "tried": s["decision"]["tried"],
                 "details": {"rule_id": s["decision"]["rule_id"], "problems": problems}}
            return {"decision": d, "path": ["validate"]}
        return {"path": ["validate"]}

    def _receipt(self, s: AskState) -> dict:
        d, act = s["decision"], s["action"]
        rule = self.index.rules[d["rule_id"]]
        try:
            dec.issue(act, rule, s["store"], s["today"])
        except RuleRecalled as e:      # recalled between the decision and issuance
            return {"decision": {"kind": "abstain", "code": "rule_recalled", "why": "recalled_at_issuance",
                                 "tried": d["tried"], "details": {"recalled": [str(e)]}}, "path": ["receipt"]}
        title = rule["action"]["title"]
        lang = s["lang"] if s["lang"] in title else "en"
        answer = {"text": title[lang], "text_lang": lang, "lang_fallback": lang != s["lang"], "rule_id": rule["rule_id"],
                  "rule_version": rule["version"], "via": d["via"], "matched_rule_id": d["matched"],
                  "receipt_credential_id": act["receipt_credential_id"], "action": act}
        if answer["lang_fallback"]:   # say so explicitly: this rule has no text in the farmer's language yet
            notice = self.messages.get("answer_not_in_your_language") or {}
            answer["lang_notice"] = {k: notice[k] for k in (s["lang"], "en") if k in notice}
        return {"result": self._result(s, "ok", ["receipt"], answer=answer), "path": ["receipt"]}

    def _abstain(self, s: AskState) -> dict:
        d = s["decision"]
        q = s["query"]
        details = {"ask_id": s["ask_id"], "why": d["why"], "lang": s["lang"], "pack_id": s["field"]["pack_id"],
                   "snapshot_id": s["snap"].get("snapshot_id"), "data_stale": s.get("stale", False), "mode": s["mode"],
                   "threshold": s.get("tau"),
                   "crops_named": q.crops, "problems_named": s.get("named") or [], "unsafe": s.get("unsafe") or [],
                   "candidates": [c.row() for c in d.get("tried", [])],
                   "top_retrieved": [h.row() for h in s["ranked"][:3]], **(d.get("details") or {})}
        ab = dec.abstain(d["code"], s["field"], s["profile"], s.get("inbox_dir"), self._question(s), details, self.messages)
        return {"result": self._result(s, "abstained", ["abstain"], abstention={**ab, "why": d["why"]}),
                "path": ["abstain"]}

    # ------------------------------------------------------------------ helpers
    def _question(self, s: AskState) -> str:
        return dec.redact(s["question"].strip(), self.lex.digits)

    def _snapshot(self, field_: dict) -> dict:
        return snap_mod.build_or_unavailable(field_)   # no forecast and no saved one: weather rules become unknown

    def _result(self, s: AskState, status: str, last: list[str], **extra) -> dict:
        f, q = s["field"], s["query"]
        d = s.get("decision") or {}
        return {"ask_id": s["ask_id"], "status": status, "question": self._question(s), "lang": s["lang"],
                "field_id": f["field_id"], "farmer_profile_id": s["profile"]["farmer_profile_id"], "pack_id": f["pack_id"],
                "crop": f["crop"], "stage": f["stage"], **extra,
                "retrieval": {"mode": s["mode"], "threshold": s.get("tau"),
                              "stages": {st: st in s["stages"] for st in ("bm25", "dense", "rerank")},
                              "note": self.note(s["stages"]), "rewritten_query": q.dense_text, "crops_named": q.crops,
                              "problems_named": s.get("named") or [], "unsafe": s.get("unsafe") or [],
                              "candidates": [c.row() for c in d.get("tried", [])],
                              "top_retrieved": [h.row() for h in s["ranked"][:3]],
                              "graph_expansion": s.get("graph_added") or []},
                "pipeline": {"engine": "langgraph", "path": s["path"] + last},
                "data_mode": s["snap"].get("mode"), "data_as_of": s["snap"].get("created_at"), "generated_at": _now()}

    def walk_settings(self) -> tuple[int, float]:
        return int(self.retrieval.get("decide_top_k", 3)), float(self.retrieval.get("prefer_margin", 0.0))

    def note(self, stages=None) -> str:
        stages = tuple(MODES.get(self.mode, ())) if stages is None else tuple(stages)
        if not stages:
            return "No retrieval threshold has been fixed for the installed models, so every question goes to the officer."
        why = []
        for s in (x for x in ("dense", "rerank") if x not in stages):
            if getattr(self, NEEDS[s]) is None:
                why.append(f"{s}: model not installed")
            elif s in MODES.get(self.mode, ()):
                why.append(f"{s}: switched off for this request")
            elif any(s in MODES[m] for m in self.thresholds):
                why.append(f"{s}: installed, but the dev split selected a mode without it (ml/ask/eval_report.json)")
            else:
                why.append(f"{s}: no threshold fixed for this model")
        label = {"bm25": "BM25 only", "hybrid": "BM25 + dense (reciprocal-rank fusion)", "bm25+rerank": "BM25 + rerank",
                 "hybrid+rerank": "BM25 + dense (reciprocal-rank fusion) + cross-encoder rerank",
                 "dense": "dense only"}[mode_of(stages)]
        return label + (f" ({'; '.join(why)})" if why else "")

    # ------------------------------------------------------------------ public
    def ask(self, question: str, lang: str, field_: dict, profile: dict, store, inbox_dir=None, snap: dict | None = None,
            today: date | None = None, stages=None, threshold: float | None = None) -> dict:
        """Answer one question for one field and farmer. `stages`/`threshold` override the server's mode (evaluation)."""
        if stages is None:
            stages, tau = MODES.get(self.mode, ()), self.thresholds.get(self.mode) if self.mode else None
        else:
            stages = tuple(stages)
            if not self._available(stages):
                raise ValueError(f"stages {stages} need a model that is not installed")
            tau = threshold if threshold is not None else self.thresholds.get(mode_of(stages))
        state: AskState = {"question": question, "lang": lang, "field": field_, "profile": profile, "store": store,
                           "inbox_dir": inbox_dir, "snap": snap, "today": today or date.today(), "stages": tuple(stages),
                           "mode": mode_of(stages) if stages else None, "tau": tau, "path": []}
        with _no_tracing():
            return self.graph.invoke(state)["result"]

    def rank(self, question: str, lang: str, field_: dict, stages) -> list[retrieve.Hit]:
        """Retrieval only, through the same node functions as the graph (the evaluation's threshold search uses it)."""
        s: dict = {"question": question, "lang": lang, "field": field_, "stages": tuple(stages), "path": []}
        for node in (self._normalise, self._screen, self._bm25, self._dense, self._fuse, self._rerank):
            s.update({k: v for k, v in node(s).items() if k != "path"})
        return s["ranked"]

    def health(self) -> dict:
        stages = MODES.get(self.mode, ())
        fit = self.fitted.get(self.mode) if self.mode else None
        stale = bool(fit) and (fit.get("lexicon_sha256") != self.lex.sha256
                               or fit.get("registry_sha256") != self.index.registry_sha256)
        errors = text_models.load_errors()
        return {
            "engine": "langgraph", "langgraph_version": metadata.version("langgraph"), "router_version": dec.ROUTER_VERSION,
            "mode": self.mode, "stages": {s: s in stages for s in ("bm25", "dense", "rerank")},
            "installed": {"dense": self.embedder is not None, "rerank": self.reranker is not None},
            "note": self.note(),
            "threshold": {"value": self.thresholds.get(self.mode) if self.mode else None,
                          "fixed_on": (fit or {}).get("fixed_on"), "fitted_at": (fit or {}).get("fitted_at"),
                          "synthetic": True if fit else None, "stale": stale,
                          "calibrated_modes": sorted(self.thresholds)},
            "models": {"embedder": self.embedder.describe() if self.embedder is not None and hasattr(self.embedder, "describe") else None,
                       "reranker": self.reranker.describe() if self.reranker is not None and hasattr(self.reranker, "describe") else None},
            "not_loaded": {k: v for k, v in errors.items()
                           if (k == "embedder" and self.embedder is None) or (k == "reranker" and self.reranker is None)},
            "index": self.index.stats(),
            "lexicon": {"sha256": self.lex.sha256, "review": "Bangla and Swahili entries pending native-speaker review"},
            "screens": {"unsafe_intent": {"types": sorted(self.safety.types), "sha256": self.safety.sha256,
                                          "abstains_as": "unsafe_intent (urgent)"},
                        "problems": {"sha256": self.problems.sha256, "abstains_as": "no_rule_for_problem",
                                     "rule_targets": self.targets},
                        "review": "Bangla and Swahili entries pending native-speaker review"},
            "answers": "a rule's validated text with a signed receipt, or the officer inbox; no language model writes text",
        }


_lock = threading.Lock()
_router: Router | None = None
_router_key: str | None = None


def get_router() -> Router:
    """One router per process (rebuilt if KRISHILOOP_ASK_MODELS changes)."""
    global _router, _router_key
    key = os.environ.get(text_models.ENV, "")
    with _lock:
        if _router is None or _router_key != key:
            _router, _router_key = Router(), key
        return _router
