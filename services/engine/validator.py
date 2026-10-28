"""Safety validator (Constitution Art. 1-3): every action sourced; no invented doses; no brand names.

Doses are parsed into (number, unit) pairs, in English and Bangla (Bangla digits and units, spelled-out
numbers). A dose is allowed only when the same pair appears in a cited quote. That is numeric equality,
not a substring test, so "5 g" is not grounded by a quote that says "25 g".
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
BN_SCRIPT = re.compile(r"[ঀ-৿]")
BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
WORD_NUMBERS = {"half": 0.5, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
                "nine": 9, "ten": 10, "twenty": 20, "fifty": 50, "hundred": 100,
                "আধা": 0.5, "এক": 1, "দুই": 2, "তিন": 3, "চার": 4, "পাঁচ": 5, "ছয়": 6, "সাত": 7, "আট": 8, "নয়": 9, "দশ": 10,
                "বিশ": 20, "পঞ্চাশ": 50, "একশ": 100}
UNITS = {
    "g": ["g", "gm", "gms", "gram", "grams", "gramme", "grammes", "গ্রাম"],
    "kg": ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "কেজি", "কিলোগ্রাম", "কিলো"],
    "mg": ["mg", "milligram", "milligrams", "মিলিগ্রাম"],
    "ml": ["ml", "mls", "millilitre", "millilitres", "milliliter", "milliliters", "cc", "মিলিলিটার", "মিলি", "এমএল"],
    "l": ["l", "litre", "litres", "liter", "liters", "লিটার"],
    "%": ["%", "percent", "per cent", "শতাংশ", "পার্সেন্ট"],
    "ppm": ["ppm"],
    "oz": ["oz", "ounce", "ounces"],
    "lb": ["lb", "lbs", "pound", "pounds"],
    "tbsp": ["tbsp", "tablespoon", "tablespoons"],
    "tsp": ["tsp", "teaspoon", "teaspoons"],
    "spoon": ["চামচ"],
    "cup": ["cup", "cups", "কাপ"],
    "sachet": ["sachet", "sachets", "packet", "packets", "প্যাকেট"],
    "cap": ["capful", "capfuls"],
}
_SPELLING = {s.lower(): u for u, spellings in UNITS.items() for s in spellings}
_UNIT_ALT = "|".join(re.escape(s) for s in sorted(_SPELLING, key=len, reverse=True))
_NUM_ALT = r"\d+(?:[.,]\d+)?|" + "|".join(sorted(map(re.escape, WORD_NUMBERS), key=len, reverse=True))
# Latin units must not run into more letters ("1 lap" is not "1 l"); Bangla units may take suffixes (কেজিতে)
DOSE = re.compile(rf"(?<![\w.])({_NUM_ALT})\s*-?\s*({_UNIT_ALT})(?![A-Za-z])", re.I)


def _guardrail(name: str) -> list[str]:
    p = ROOT / "rules" / "guardrails" / f"{name}.yaml"
    return [w.lower() for w in (yaml.safe_load(p.read_text(encoding="utf-8")) or {}).get("terms", [])] if p.exists() else []


def doses(text: str) -> set[tuple[float, str]]:
    """All (amount, unit) pairs in a text, in English or Bangla."""
    out = set()
    for num, unit in DOSE.findall(text.translate(BN_DIGITS)):
        n = num.lower()
        value = WORD_NUMBERS.get(n, WORD_NUMBERS.get(num))
        if value is None:
            value = float(n.replace(",", "."))
        out.add((float(value), _SPELLING[unit.lower()]))
    return out


def validate_action(action: dict) -> list[str]:
    problems = []
    receipt = action.get("receipt") or {}
    sources = receipt.get("sources") or []
    if not sources:
        problems.append("no source")
    if not receipt.get("rule_refs"):
        problems.append("no rule reference")
    grounded = set().union(*(doses(s.get("quote", "")) for s in sources)) if sources else set()
    texts = []
    for field in ("title", "detail"):
        texts += list((action.get(field) or {}).items())
    for d in action.get("do_not") or []:
        texts += list(d.items())
    brands = _guardrail("brands")
    for lang, text in texts:
        for amount, unit in sorted(doses(text) - grounded):
            problems.append(f"ungrounded dose '{amount:g} {unit}' ({lang})")
        low = text.lower()
        for b in brands:
            hit = (b in low) if BN_SCRIPT.search(b) else re.search(rf"\b{re.escape(b)}\b", low)
            if hit:
                problems.append(f"brand name '{b}' ({lang})")
        if "®" in text or "™" in text:
            problems.append(f"trademark symbol ({lang})")
        if lang == "bn" and not BN_SCRIPT.search(text):
            problems.append("bn text has no Bangla script")
    return problems
