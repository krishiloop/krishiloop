"""Ask router screens, run on the question before any rule may answer (deterministic; no language model).

1. Unsafe intent (rules/ask/safety.yaml): banned or highly hazardous products, tank mixes, spraying close to harvest,
   raising the dose, no protective gear, unlabelled products, food or animals after spraying, children or pregnancy,
   and other handling hazards. A hit sends the case to the officer as `unsafe_intent`, marked urgent; the farmer sees
   only a fixed message.
2. Problems named (rules/ask/problems.yaml): the pests and diseases of the field's crop that the question names. A rule
   may answer only a question about a problem it targets; a problem no rule in the pack targets goes to the officer
   as `no_rule_for_problem`. A rule's targets are derived from its own texts (titles, quotes, basis note) plus the
   pack's `every_rule_targets`.

Both lists are data in English, Bangla and Swahili; this code only applies them, so a new language, crop or pack needs
no code change. Words are normalised by the router's lexicon (services/ask/lexical.py). A term matches a question word
when it IS the word or one of the word's case-ending variants (spraying -> spray, কীটনাশকের -> কীটনাশক), never the
other way round, so a short term never swallows a longer word (মাকড় does not match মাকড়সা).
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

from services.ask.lexical import Lexicon

ROOT = Path(__file__).resolve().parents[2]
SAFETY_PATH = ROOT / "rules" / "ask" / "safety.yaml"
PROBLEMS_PATH = ROOT / "rules" / "ask" / "problems.yaml"

Phrase = tuple[str, ...]


class _Words:
    """A question as normalised words, with each word's variants, and phrase look-up."""

    def __init__(self, lex: Lexicon, text: str):
        self.tokens = lex.tokens(text)
        self.vars = [set(lex.variants(t)) for t in self.tokens]

    def spans(self, phrase: Phrase) -> list[tuple[int, int]]:
        n = len(phrase)
        return [(i, i + n) for i in range(len(self.tokens) - n + 1)
                if all(phrase[j] in self.vars[i + j] for j in range(n))]


@dataclass(frozen=True)
class UnsafeHit:
    type: str
    terms: tuple[str, ...]

    def row(self) -> dict:
        return {"type": self.type, "terms": list(self.terms)}


class SafetyScreen:
    def __init__(self, data: dict, lex: Lexicon, sha256: str = ""):
        self.sha256, self.lex = sha256, lex
        self.groups = {f"@{k}": self._phrases(v) for k, v in (data.get("groups") or {}).items()}
        self.types = {name: [self._clause(c) for c in clauses] for name, clauses in (data.get("types") or {}).items()}

    def _phrases(self, terms) -> list[Phrase]:
        out: list[Phrase] = []
        for t in terms:
            if isinstance(t, str) and t.startswith("@"):
                out += self.groups[t]
            else:
                p = tuple(self.lex.tokens(str(t)))
                if p and p not in out:
                    out.append(p)
        return out

    def _item(self, item):
        if isinstance(item, dict) and "near" in item:
            a, b = (self._phrases([x] if isinstance(x, str) else x) for x in item["near"])
            return ("near", a, b, int(item.get("window", 0)))
        if isinstance(item, dict) and "classes" in item:
            return ("classes", [self._phrases([g]) for g in item["classes"]], int(item.get("min", 2)))
        return ("any", self._phrases([item] if isinstance(item, str) else item))

    def _clause(self, clause) -> list:
        return [self._item(i) for i in clause]

    @staticmethod
    def _found(words: _Words, phrases: list[Phrase]) -> list[str]:
        return [" ".join(p) for p in phrases if words.spans(p)]

    def _holds(self, words: _Words, item) -> list[str] | None:
        kind = item[0]
        if kind == "any":
            hit = self._found(words, item[1])
            return hit or None
        if kind == "classes":
            hits = [self._found(words, g) for g in item[1]]
            got = [h[0] for h in hits if h]
            return got if len(got) >= item[2] else None
        _, a, b, window = item
        for pa in a:
            for sa in words.spans(pa):
                for pb in b:
                    for sb in words.spans(pb):
                        if 0 <= sb[0] - sa[1] <= window or 0 <= sa[0] - sb[1] <= window:
                            return [" ".join(pa), " ".join(pb)]
        return None

    def check(self, question: str) -> list[UnsafeHit]:
        words = _Words(self.lex, question)
        out = []
        for name, clauses in self.types.items():
            for clause in clauses:
                terms: list[str] = []
                for item in clause:
                    got = self._holds(words, item)
                    if got is None:
                        break
                    terms += got
                else:
                    out.append(UnsafeHit(name, tuple(dict.fromkeys(terms))))
                    break
        return out


class ProblemLexicon:
    def __init__(self, data: dict, lex: Lexicon, sha256: str = ""):
        self.sha256, self.lex = sha256, lex
        self.crops: dict[str, list[tuple[Phrase, str]]] = {}
        for crop, problems in (data.get("crops") or {}).items():
            pairs = [(tuple(lex.tokens(str(t))), pid) for pid, terms in problems.items() for t in terms]
            self.crops[str(crop)] = sorted({p for p in pairs if p[0]}, key=lambda p: (-len(p[0]), p[1], p[0]))
        self.packs = {k: v or {} for k, v in (data.get("packs") or {}).items()}

    def named(self, text: str, crop: str) -> list[str]:
        """The problems of `crop` that a text names (longest phrase first; a word belongs to one phrase only)."""
        words = _Words(self.lex, text)
        used = [False] * len(words.tokens)
        found: list[str] = []
        for phrase, pid in self.crops.get(crop, []):
            for a, b in words.spans(phrase):
                if not any(used[a:b]):
                    used[a:b] = [True] * (b - a)
                    if pid not in found:
                        found.append(pid)
        return sorted(found)

    def rule_targets(self, rule: dict) -> list[str]:
        """The problems a rule is about: those its own texts name, plus its pack's `every_rule_targets`."""
        texts = list(rule["action"]["title"].values()) + [s.get("quote", "") for s in rule.get("sources", [])]
        texts.append(rule.get("basis_note") or "")
        found = set(self.packs.get(rule["pack_id"], {}).get("every_rule_targets") or [])
        for t in texts:
            found.update(self.named(t, rule.get("crop", "")))
        return sorted(found)


@lru_cache(maxsize=None)
def load_safety(lex: Lexicon, path: Path = SAFETY_PATH) -> SafetyScreen:
    raw = path.read_bytes()
    return SafetyScreen(yaml.safe_load(raw.decode("utf-8")), lex, hashlib.sha256(raw).hexdigest())


@lru_cache(maxsize=None)
def load_problems(lex: Lexicon, path: Path = PROBLEMS_PATH) -> ProblemLexicon:
    raw = path.read_bytes()
    return ProblemLexicon(yaml.safe_load(raw.decode("utf-8")), lex, hashlib.sha256(raw).hexdigest())
