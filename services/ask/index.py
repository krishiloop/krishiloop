"""Ask index: what retrieval searches. Rebuilt from the rule registry and the corpus manifest at start-up; never saved.

Units:
- one per rule (every pack): titles in every language, the verbatim source quotes, the basis note, and a header
  naming the rule's pack, crop, kind, stages (with the lexicon's stage words in every language) and the facts it uses;
- corpus chunks, only from documents whose `licence_status` allows indexing (cleared or permitted) and whose text is
  committed under corpus/ (today: DOC-CIP-001). corpus_private/ is never read: the BRRI sheets are cited, not
  indexed, so for them only the short quotes already inside the rules are searchable.

Chunking is section-aware and semantic: each page is split at the manual's section headings (a section carries on
across consecutive pages), and a section longer than MAX_WORDS is split recursively at its least similar pair of
adjacent sentences (embedding cosine when the embedder is installed, word overlap otherwise). Every chunk gets a
contextual header (document, section, page, pack and crop) prepended before indexing, in the spirit of Anthropic's
contextual retrieval; the header is built from metadata, not written by a language model.

A chunk maps to the rules that cite its document and page: weight 1.0 when the rule's quote is inside the chunk,
PAGE_ONLY_WEIGHT when the rule only cites the same page.
"""
from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from services.ask.lexical import BM25, Lexicon
from services.engine.rules import REGISTRY, load_pack, manifest

ROOT = Path(__file__).resolve().parents[2]
INDEXABLE = {"cleared", "permitted"}
MAX_WORDS, MIN_WORDS = 120, 30
PAGE_ONLY_WEIGHT = 0.5
CONTINUED = "(continued from an earlier page)"
_HEADING_TAIL = {"of", "and", "the", "to", "with", "for", "in", "by", "or", "a", "an", "as", "at", "on", "from"}


@dataclass
class Unit:
    uid: str
    kind: str                     # "rule" | "chunk"
    packs: tuple[str, ...]
    header: str
    body: str
    maps: dict[str, float]        # rule_id -> weight
    meta: dict = field(default_factory=dict)

    @property
    def text(self) -> str:
        return f"{self.header}\n{self.body}"


def norm_quote(text: str) -> str:
    """Same normalisation as tools/check_quotes.py, so a rule's quote is found inside a chunk exactly when it is
    found on its page there."""
    text = unicodedata.normalize("NFC", text).replace("­", "")
    text = re.sub(r"\s+", " ", text)
    return re.sub(r"(\w)- (\w)", r"\1\2", text).strip()


def _conditions(cond: dict):
    if "all" in cond or "any" in cond:
        for c in cond.get("all", []) + cond.get("any", []):
            yield from _conditions(c)
    elif cond:
        yield cond


def stages_of(rule: dict) -> list[str]:
    out = []
    for c in _conditions(rule.get("when") or {}):
        if c["fact"] == "stage":
            out += c["value"] if isinstance(c["value"], list) else [c["value"]]
    return out


def rule_unit(rule: dict, lex: Lexicon) -> Unit:
    a = rule["action"]
    stage_words: list[str] = []
    for s in stages_of(rule):
        stage_words += [w for w in [s.replace("_", " ")] + lex.stage_words.get(s, []) if w not in stage_words]
    facts = sorted({c["fact"] for c in _conditions(rule.get("when") or {})} - {"stage"})
    kind = a["kind"].replace("_", " ") + (f" ({a['decision'].replace('_', ' ')})" if a.get("decision") else "")
    header = " | ".join(x for x in (
        f"Rule {rule['rule_id']} v{rule['version']}", rule["pack_id"], f"crop: {rule.get('crop', '')}", kind,
        f"stages: {', '.join(stage_words)}" if stage_words else "",
        f"uses: {', '.join(f.replace('_', ' ') for f in facts)}" if facts else "") if x)
    lines = [a["title"][lang] for lang in sorted(a["title"])] + [s["quote"] for s in rule.get("sources", [])]
    if rule.get("basis_note"):
        lines.append(rule["basis_note"])
    return Unit(f"rule:{rule['rule_id']}", "rule", (rule["pack_id"],), header, "\n".join(lines), {rule["rule_id"]: 1.0},
                {"rule_id": rule["rule_id"], "version": rule["version"]})


def rule_passage(rule: dict, lang: str) -> str:
    """What the reranker reads for a rule: the advice and its source quotes only (title in the asker's language
    first). The basis note is left out: it explains the rule rather than saying what to do, and doubles the cost."""
    title = rule["action"]["title"]
    lines = [title[lang]] if lang in title else []
    lines += [title[t] for t in sorted(title) if t != lang]
    lines += [s["quote"] for s in rule.get("sources", [])]
    return "\n".join(lines)


# ---------------------------------------------------------------------------------------------- corpus chunks
def _is_heading(line: str, prev: str) -> bool:
    words = line.split()
    return (1 <= len(words) <= 8 and len(line) <= 60 and line[0].isupper() and line[-1] not in ".,;:)-–"
            and not line.startswith("- ") and words[-1].lower() not in _HEADING_TAIL
            and (not prev or prev[-1] in ".!?:\"”"))


def sections(raw: str) -> list[dict]:
    """[{page, section, lines}] for a corpus text with '=== PAGE n ===' markers (pages are the PDF's page numbers)."""
    out, section, prev_page = [], None, None
    for num, body in re.findall(r"=== PAGE (\d+) ===\n(.*?)(?==== PAGE |\Z)", raw, re.S):
        page = int(num)
        if prev_page is None or page != prev_page + 1:
            section = None                     # pages missing in between: the section is not known
        prev_page = page
        lines = [ln.strip() for ln in body.splitlines()]
        lines = [ln for ln in lines if ln and not ln.startswith("#")]
        if lines and re.fullmatch(r"\d{1,3}", lines[0]):
            lines = lines[1:]                  # the printed page number
        cur, prev, i = {"page": page, "section": section or CONTINUED, "lines": []}, "", 0
        while i < len(lines):
            line = lines[i]
            if re.fullmatch(r"Figure \d+\.?", line):   # a figure caption runs until its "(Photo: ...)." line
                cap = []
                i += 1
                while i < len(lines):
                    cap.append(lines[i])
                    i += 1
                    if cap[-1].endswith(")."):
                        break
                cur["lines"].append("Figure: " + " ".join(cap))
                prev = "."
                continue
            if _is_heading(line, prev):
                if cur["lines"]:
                    out.append(cur)
                section = line
                cur = {"page": page, "section": line, "lines": [line]}
                prev = line
            else:
                cur["lines"].append(line)
                prev = line
            i += 1
        if cur["lines"]:
            out.append(cur)
    return out


def sentences(lines: list[str]) -> list[str]:
    """Join a section's lines (bullets stay separate), undo line-break hyphens, split into sentences."""
    pieces, buf = [], []
    for ln in lines:
        if ln.startswith("- ") and buf:
            pieces.append(" ".join(buf))
            buf = []
        buf.append(ln[2:] if ln.startswith("- ") else ln)
    if buf:
        pieces.append(" ".join(buf))
    out = []
    for p in pieces:
        p = re.sub(r"(\w)- (\w)", r"\1\2", re.sub(r"\s+", " ", p)).strip()
        parts = re.split(r"(?<=[.!?])\s+(?=[A-Z\"“(])", p)
        merged: list[str] = []
        for s in parts:   # "P. infestans", "W. Pérez": a capital initial does not end a sentence
            if merged and re.search(r"(?:^|\s)[A-Z]\.$", merged[-1]):
                merged[-1] += " " + s
            else:
                merged.append(s)
        out += [s for s in merged if s]
    return out


def _lexical_sim(lex: Lexicon):
    def sim(a: str, b: str) -> float:
        ca = Counter(v for w in lex.content_words(a) for v in lex.variants(w))
        cb = Counter(v for w in lex.content_words(b) for v in lex.variants(w))
        dot = sum(ca[t] * cb[t] for t in ca)
        na, nb = math.sqrt(sum(x * x for x in ca.values())), math.sqrt(sum(x * x for x in cb.values()))
        return dot / (na * nb) if na and nb else 0.0
    return sim


def split_semantic(sents: list[str], sims: list[float]) -> list[list[str]]:
    """Split at the least similar adjacent pair until every piece fits MAX_WORDS (both halves >= MIN_WORDS if
    possible); sims[i] is the similarity of sentence i and i+1."""
    words = [len(s.split()) for s in sents]
    if sum(words) <= MAX_WORDS or len(sents) == 1:
        return [sents]
    cuts = [i for i in range(len(sents) - 1) if sum(words[:i + 1]) >= MIN_WORDS and sum(words[i + 1:]) >= MIN_WORDS]
    cuts = cuts or list(range(len(sents) - 1))
    total = sum(words)
    k = min(cuts, key=lambda i: (round(sims[i], 6), abs(sum(words[:i + 1]) - total / 2)))
    return split_semantic(sents[:k + 1], sims[:k]) + split_semantic(sents[k + 1:], sims[k + 1:])


def corpus_units(lex: Lexicon, rules: dict[str, dict], embedder=None) -> list[Unit]:
    docs = manifest()
    units = []
    for doc_id, d in sorted(docs.items()):
        path = ROOT / d["text"] if d.get("text") else None
        if d.get("licence_status") not in INDEXABLE or path is None or not path.exists() \
                or "corpus_private" in path.parts:
            continue
        packs = tuple(d.get("packs") or [])
        crops = sorted({r.get("crop", "") for r in rules.values() if r["pack_id"] in packs})
        year = f", {d['year']}" if d.get("year") else ""
        for s_no, sec in enumerate(sections(path.read_text(encoding="utf-8"))):
            sents = sentences(sec["lines"])
            if not sents:
                continue
            if embedder is not None and len(sents) > 1:
                v = embedder.embed(sents, "query")
                sims = [float(v[i] @ v[i + 1]) for i in range(len(sents) - 1)]
            else:
                sim = _lexical_sim(lex)
                sims = [sim(sents[i], sents[i + 1]) for i in range(len(sents) - 1)]
            pieces = split_semantic(sents, sims)
            for c_no, piece in enumerate(pieces):
                body = " ".join(piece)
                head = (f"{d['title']} ({d['publisher']}{year}) | section: {sec['section']}"
                        f"{f' (part {c_no + 1} of {len(pieces)})' if len(pieces) > 1 else ''} | page {sec['page']} | "
                        f"pack: {', '.join(packs)} ({', '.join(crops)})")
                text = norm_quote(body)
                maps = {}
                for r in rules.values():
                    if r["pack_id"] not in packs:
                        continue
                    cites = [s for s in r.get("sources", []) if s["doc_id"] == doc_id and str(s["page"]) == str(sec["page"])]
                    if cites:
                        maps[r["rule_id"]] = 1.0 if any(norm_quote(s["quote"]) in text for s in cites) else PAGE_ONLY_WEIGHT
                units.append(Unit(f"chunk:{doc_id}:p{sec['page']}:s{s_no}:c{c_no}", "chunk", packs, head, body, maps,
                                  {"doc_id": doc_id, "page": sec["page"], "section": sec["section"]}))
    return units


class Index:
    def __init__(self, lex: Lexicon, embedder=None):
        self.rules: dict[str, dict] = {}
        for pack in sorted(p.name for p in REGISTRY.iterdir() if p.is_dir()):
            for r in load_pack(pack):
                self.rules[r["rule_id"]] = r
        self.units = [rule_unit(r, lex) for r in self.rules.values()] + corpus_units(lex, self.rules, embedder)
        self.chunking = ("semantic: embedding similarity between adjacent sentences" if embedder is not None
                         else "semantic: word overlap between adjacent sentences (embedder not installed)")
        self.bm25 = BM25(lex, [u.text for u in self.units])
        self.vectors = embedder.embed([u.text for u in self.units], "passage") if embedder is not None else None
        self.by_pack: dict[str, list[int]] = {}
        for i, u in enumerate(self.units):
            for p in u.packs:
                self.by_pack.setdefault(p, []).append(i)
        self.registry_sha256 = hashlib.sha256("".join(sorted(r["rule_sha256"] for r in self.rules.values()))
                                              .encode()).hexdigest()

    def stats(self) -> dict:
        chunks = [u for u in self.units if u.kind == "chunk"]
        return {"rule_units": sum(u.kind == "rule" for u in self.units), "corpus_chunks": len(chunks),
                "corpus_docs": sorted({u.meta["doc_id"] for u in chunks}), "chunking": self.chunking,
                "contextual_headers": "document, section, page, pack and crop prepended to every chunk",
                "registry_sha256": self.registry_sha256}

    def pack_rules(self, pack_id: str) -> list[str]:
        return [rid for rid, r in self.rules.items() if r["pack_id"] == pack_id]
