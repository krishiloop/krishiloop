"""Bangla-aware normalisation, query rewriting and BM25 for the Ask router.

Language specifics (digits, case endings, stopwords, synonyms, crop words) are data in rules/ask/synonyms.yaml;
this code only applies them, so a new language or pack needs no code change.

- normalise: Unicode NFC, invisible joiners removed, each script's digits mapped to 0-9, lower case; punctuation
  (the Bangla danda too) splits words, and a word never mixes digits and letters (৮০টির -> 80 টির).
- variants: a word plus the form left by stripping each case ending that matches (ধানের -> ধান, spraying -> spray).
- query rewriting: a question becomes a list of concepts. A synonym phrase found in it (longest first) brings in
  the other members of its group (নাবি ধসা <-> late blight), so a Bangla question can match English rule text.
- BM25 (Okapi): each concept scores by its best-matching phrase, so a passage written in two languages is not
  counted twice. Coverage is the idf-weighted share of the question's concepts found in a passage; it is the
  BM25-only confidence. Crop names are left out of both, because the field's pack already fixes the crop.
"""
from __future__ import annotations

import hashlib
import math
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
LEXICON_PATH = ROOT / "rules" / "ask" / "synonyms.yaml"
SYNONYM_WEIGHT = 0.8              # a synonym's match counts a little less than the farmer's own word
MAX_EXPANSIONS_PER_CONCEPT = 3    # cross-language synonyms appended to the dense query
_INVISIBLE = dict.fromkeys(map(ord, "​‌‍⁠﻿­"), None)

Word = tuple[str, ...]            # a word as its variants
Phrase = tuple[Word, ...]


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text).translate(_INVISIBLE)


@dataclass(frozen=True)
class Language:
    name: str
    lo: int
    hi: int
    min_stem: int
    suffixes: tuple[tuple[str, str], ...]
    keep_endings: tuple[str, ...]
    undouble_after: frozenset
    undouble_except: frozenset


@dataclass
class Concept:
    """One part of a question: what the farmer wrote, and the phrases that mean the same for retrieval."""
    text: str
    members: list[Phrase]
    weights: list[float]          # 1.0 for the farmer's own words, SYNONYM_WEIGHT for a synonym
    own: Phrase                   # the farmer's own words; empty for a phrase of stopwords ("how much")
    crop: str | None = None       # set when the concept names a crop
    groups: tuple[int, ...] = ()


@dataclass
class Query:
    text: str
    tokens: list[str]
    concepts: list[Concept]
    crops: list[str]              # crops the question names
    expansions: list[str] = field(default_factory=list)
    input_intent: bool = False    # the question is about an input decision (spray or not)

    @property
    def dense_text(self) -> str:
        """The rewritten question for the embedder: as written, plus cross-language synonyms in brackets."""
        return f"{self.text} ({'; '.join(self.expansions)})" if self.expansions else self.text


class Lexicon:
    def __init__(self, data: dict, sha256: str = ""):
        self.sha256 = sha256
        self.digits: dict[int, str] = {}
        for spec in data["languages"].values():
            for i, ch in enumerate(spec.get("digits", "")):
                self.digits[ord(ch)] = str(i)
        self.languages = [Language(name, int(spec["script"][0]), int(spec["script"][1]), int(spec.get("min_stem", 2)),
                                   tuple(sorted(((nfc(s).lower(), nfc(r).lower()) for s, r in spec.get("suffixes", [])),
                                                key=lambda x: -len(x[0]))),
                                   tuple(spec.get("keep_endings", [])), frozenset(spec.get("undouble_after", [])),
                                   frozenset(spec.get("undouble_except", [])))
                          for name, spec in data["languages"].items()]
        self._vcache: dict[str, Word] = {}
        self.stopwords = {t for spec in data["languages"].values() for w in spec.get("stopwords", []) for t in self.tokens(str(w))}
        self.groups = [ms for ms in ([m for m in (tuple(self.tokens(str(x))) for x in g) if m] for g in data.get("synonyms", []))
                       if len(ms) > 1]
        self.crops = {str(c): [m for m in (tuple(self.tokens(str(x))) for x in terms) if m]
                      for c, terms in (data.get("crops") or {}).items()}
        self.stage_words = {str(s): [str(w) for w in words] for s, words in (data.get("stages") or {}).items()}
        intent = {v for w in data.get("input_decision_words", []) for t in self.tokens(str(w)) for v in self.variants(t)}
        self.intent_groups = {gid for gid, members in enumerate(self.groups)
                              if any(set(self.variants(m[0])) & intent for m in members if len(m) == 1)}
        self._phrases: dict[str, list[tuple[tuple[str, ...], tuple[str, object]]]] = {}
        for gid, members in enumerate(self.groups):
            for m in members:
                self._add_phrase(m, ("syn", gid))
        for crop, members in self.crops.items():
            for m in members:
                self._add_phrase(m, ("crop", crop))

    # ------------------------------------------------------------------ words
    def tokens(self, text: str) -> list[str]:
        text = nfc(text).translate(self.digits).lower()
        out, cur, cur_digit = [], [], False
        for ch in text:
            cat = unicodedata.category(ch)[0]
            if cat in "LMN":
                is_digit = cat == "N"
                if cur and cat != "M" and is_digit != cur_digit:   # 80টির -> 80, টির
                    out.append("".join(cur))
                    cur = []
                if not cur:
                    cur_digit = is_digit
                cur.append(ch)
            elif cur:
                out.append("".join(cur))
                cur = []
        if cur:
            out.append("".join(cur))
        return out

    def _language(self, word: str) -> Language | None:
        cp = ord(word[0])
        return next((lang for lang in self.languages if lang.lo <= cp <= lang.hi), None)

    def variants(self, word: str) -> Word:
        """The word, then each form left after stripping one matching ending (all of them, not only the longest:
        ক্ষেতে -> ক্ষেত needs the short ending, ধানের -> ধান the long one)."""
        hit = self._vcache.get(word)
        if hit is not None:
            return hit
        out = [word]
        lang = self._language(word) if word else None
        if lang and not any(word.endswith(e) for e in lang.keep_endings):
            for suffix, repl in lang.suffixes:
                if suffix and word.endswith(suffix):
                    stem = word[: len(word) - len(suffix)] + repl
                    if suffix in lang.undouble_after and len(stem) >= 2 and stem[-1] == stem[-2] \
                            and stem[-1] not in lang.undouble_except:
                        stem = stem[:-1]          # cutting -> cut
                    if len(stem) >= lang.min_stem and stem not in out:
                        out.append(stem)
        self._vcache[word] = tuple(out)
        return self._vcache[word]

    def content_words(self, text: str) -> list[str]:
        return [w for w in self.tokens(text) if w not in self.stopwords]

    # ------------------------------------------------------------------ query rewriting
    def _add_phrase(self, member: tuple[str, ...], tag: tuple[str, object]) -> None:
        for v in self.variants(member[0]):
            self._phrases.setdefault(v, []).append((member, tag))

    def _phrase_at(self, words: list[Word], i: int) -> tuple[int, list[tuple[str, object]]]:
        """Longest synonym or crop phrase starting at word i (all phrases of that length, from every group)."""
        best, tags = 0, []
        for v in words[i]:
            for member, tag in self._phrases.get(v, ()):
                n = len(member)
                if n < best or i + n > len(words) or tag in tags and n == best:
                    continue
                if all(set(self.variants(member[j])) & set(words[i + j]) for j in range(1, n)):
                    if n > best:
                        best, tags = n, [tag]
                    elif tag not in tags:
                        tags.append(tag)
        return best, tags

    def _phrase(self, member: tuple[str, ...]) -> Phrase:
        return tuple(self.variants(w) for w in member if w not in self.stopwords)

    def analyse(self, question: str) -> Query:
        toks = self.tokens(question)
        words = [self.variants(t) for t in toks]
        concepts, crops, expansions = [], [], []
        i = 0
        while i < len(toks):
            n, tags = self._phrase_at(words, i)
            if n == 0:
                if toks[i] not in self.stopwords and not toks[i].isdigit():
                    own = (words[i],)
                    concepts.append(Concept(toks[i], [own], [1.0], own))
                i += 1
                continue
            span = toks[i:i + n]
            own = tuple(words[i + j] for j in range(n) if toks[i + j] not in self.stopwords)
            members, weights = ([own], [1.0]) if own else ([], [])
            crop, gids, extra = None, [], []
            span_lang = self._language(span[0])
            for kind, ref in tags:
                group = self.crops[ref] if kind == "crop" else self.groups[ref]
                if kind == "crop":
                    crop = str(ref)
                    crops.append(crop)
                else:
                    gids.append(int(ref))
                for m in group:
                    p = self._phrase(m)
                    if p and p not in members:
                        members.append(p)
                        weights.append(SYNONYM_WEIGHT)
                        if self._language(m[0]) is not span_lang and len(extra) < MAX_EXPANSIONS_PER_CONCEPT:
                            extra.append(" ".join(m))
            expansions += [e for e in extra if e not in expansions]
            concepts.append(Concept(" ".join(span), members, weights, own, crop, tuple(gids)))
            i += n
        crops += self._crops_named(words)    # also inside a longer phrase ("আলু তোলা" names potato)
        intent = any(set(c.groups) & self.intent_groups for c in concepts)
        return Query(nfc(question).strip(), toks, concepts, sorted(set(crops)), expansions, intent)

    def _crops_named(self, words: list[Word]) -> list[str]:
        found = []
        for crop, members in self.crops.items():
            for m in members:
                mv = [set(self.variants(w)) for w in m]
                if any(all(mv[j] & set(words[i + j]) for j in range(len(m))) for i in range(len(words) - len(m) + 1)):
                    found.append(crop)
                    break
        return found


@lru_cache(maxsize=None)
def load_lexicon(path: Path = LEXICON_PATH) -> Lexicon:
    raw = path.read_bytes()
    return Lexicon(yaml.safe_load(raw.decode("utf-8")), hashlib.sha256(raw).hexdigest())


class BM25:
    """Okapi BM25 over the index units (k1=1.2, b=0.75), scored concept by concept (see the module docstring)."""

    def __init__(self, lex: Lexicon, docs: list[str], k1: float = 1.2, b: float = 0.75):
        self.lex, self.k1, self.b = lex, k1, b
        self.tf: list[Counter] = []
        self.dl: list[int] = []
        df: Counter = Counter()
        for text in docs:
            words = lex.content_words(text)
            tf = Counter(v for w in words for v in lex.variants(w))
            self.tf.append(tf)
            self.dl.append(len(words))
            df.update(tf.keys())
        self.n = len(docs)
        self.avgdl = (sum(self.dl) / self.n) if self.n else 1.0
        self.idf = {t: math.log(1 + (self.n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
        self.idf_unknown = math.log(1 + (self.n + 0.5) / 0.5)    # a word no passage has weighs the most

    def _term(self, t: str, i: int) -> float:
        f = self.tf[i].get(t)
        if not f:
            return 0.0
        return self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * self.dl[i] / self.avgdl))

    def _phrase(self, p: Phrase, i: int) -> float:
        """Mean word score, and only when every word of the phrase is in the passage."""
        scores = [max(self._term(v, i) for v in w) for w in p]
        return sum(scores) / len(scores) if scores and all(scores) else 0.0

    def _word_idf(self, w: Word) -> float:
        known = [self.idf[v] for v in w if v in self.idf]
        return max(known) if known else self.idf_unknown

    def weight(self, c: Concept) -> float:
        """How informative a concept is: the idf of the farmer's own words (unknown words weigh the most)."""
        if c.own:
            return sum(self._word_idf(w) for w in c.own) / len(c.own)
        known = [sum(self._word_idf(w) for w in m) / len(m) for m in c.members if all(any(v in self.idf for v in w) for w in m)]
        return sum(known) / len(known) if known else 1.0

    def score(self, q: Query, docs: list[int]) -> list[tuple[float, float]]:
        """(BM25, coverage) of each passage in `docs` for the question."""
        concepts = [c for c in q.concepts if not c.crop]
        weights = [self.weight(c) for c in concepts]
        total = sum(weights)
        out = []
        for i in docs:
            s = hit = 0.0
            for c, wt in zip(concepts, weights):
                best = max((w * self._phrase(m, i) for m, w in zip(c.members, c.weights)), default=0.0)
                s += best
                if best > 0:
                    hit += wt
            out.append((s, hit / total if total else 0.0))
        return out
