"""Bangla text normaliser and error rates for the voice evaluation.

The same normaliser is applied to references and hypotheses before scoring. It is deliberately small and
documented, so other people can reproduce the numbers:

1. Unicode NFC. This also unifies the nukta letters: U+09DC/U+09DD/U+09DF (ড় ঢ় য়) are composition
   exclusions, so NFC turns both the precomposed and the base+nukta spellings into base+nukta.
2. The old khanda-ta spelling (ত + hasanta + ZWJ) becomes ৎ (U+09CE).
3. Zero-width and invisible characters are removed: ZWSP, ZWNJ, ZWJ, word joiner, BOM, soft hyphen.
4. Bangla digits ০-৯ become ASCII 0-9, so "২০" and "20" match. Number words ("দুই") are NOT turned into
   digits; a model that writes "২" where the reference says "দুই" is still counted wrong (caveat in REPORT.md).
5. Latin letters are lower-cased (code-mixed English words).
6. Every punctuation, symbol and separator character becomes a space: the danda । and double danda ॥,
   U+09F7 (often typed as a danda), the pipe |, quotes, dashes, brackets, commas, ?, ! and so on.
7. Whitespace is collapsed and NFC is applied again (removing ZWNJ can create new composable pairs).

WER = word edits / reference words. CER = character edits / reference characters, counted on Unicode code
points of the normalised text including the single spaces between words. Both are corpus-level (summed
edits over summed reference length), the usual convention.
"""
from __future__ import annotations

import re
import unicodedata

_ZERO_WIDTH = dict.fromkeys(map(ord, "​‌‍⁠﻿­"), None)
_BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
_FORCE_SPACE = set("।॥৷|")
_WS = re.compile(r"\s+")


def normalize_bn(text: str) -> str:
    t = unicodedata.normalize("NFC", text or "")
    t = t.replace("ত্‍", "ৎ")
    t = t.translate(_ZERO_WIDTH)
    t = t.translate(_BN_DIGITS)
    t = t.lower()
    out = []
    for ch in t:
        cat = unicodedata.category(ch)
        if ch in _FORCE_SPACE or cat[0] in "PSZ" or cat in ("Cc", "Cf"):
            out.append(" ")
        else:
            out.append(ch)
    t = _WS.sub(" ", "".join(out)).strip()
    return unicodedata.normalize("NFC", t)


def _lev(a, b) -> int:
    """Levenshtein distance between two sequences (strings or lists of words)."""
    try:
        from rapidfuzz.distance import Levenshtein
        return int(Levenshtein.distance(a, b))
    except ImportError:  # pragma: no cover - pure-Python fallback
        if len(a) < len(b):
            a, b = b, a
        prev = list(range(len(b) + 1))
        for i, ca in enumerate(a, 1):
            cur = [i]
            for j, cb in enumerate(b, 1):
                cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
            prev = cur
        return prev[-1]


def utterance_errors(ref: str, hyp: str, normalise: bool = True) -> dict:
    r = normalize_bn(ref) if normalise else ref
    h = normalize_bn(hyp) if normalise else hyp
    rw, hw = r.split(), h.split()
    return {
        "ref_norm": r,
        "hyp_norm": h,
        "word_edits": _lev(rw, hw),
        "ref_words": len(rw),
        "char_edits": _lev(r, h),
        "ref_chars": len(r),
    }


def corpus_rates(rows) -> dict:
    """rows: iterable of dicts from utterance_errors. Returns corpus-level WER/CER in percent."""
    we = rw = ce = rc = n = 0
    for x in rows:
        we += x["word_edits"]
        rw += x["ref_words"]
        ce += x["char_edits"]
        rc += x["ref_chars"]
        n += 1
    return {
        "n_utts": n,
        "wer_pct": round(100.0 * we / max(rw, 1), 2),
        "cer_pct": round(100.0 * ce / max(rc, 1), 2),
        "ref_words": rw,
        "ref_chars": rc,
    }


if __name__ == "__main__":  # tiny self-check
    a = "জমিতে পানি জমে আছে, এতে কি সমস্যা হবে?"
    b = "জমিতে পানি জমে আছে এতে কি সমস্যা হবে"
    assert normalize_bn(a) == normalize_bn(b), (normalize_bn(a), normalize_bn(b))
    assert normalize_bn("২০২৬ সাল।") == "2026 সাল"
    assert normalize_bn("ক‌া") == normalize_bn("কা")
    assert normalize_bn("য়") == normalize_bn("য়")  # precomposed vs base+nukta
    e = utterance_errors("আমি ভাত খাই", "আমি ভাত খায়")
    assert e["word_edits"] == 1 and e["ref_words"] == 3, e
    print("bn_text self-check ok")
