"""Rebuild fixtures/sms_parity.json from services/reach/sms.py and codes.py.

Run after a deliberate wording change (sms.TEMPLATES / DECISION_WORDS / KIND_WORDS changed together with the web
dictionaries):  .venv/Scripts/python.exe -m services.reach.make_fixtures
Then both tests/test_reach.py and apps/web/src/features/verify/reachParity.test.ts must pass: the second one is what
proves the web preview gives the same text.
"""
from __future__ import annotations

import json
from pathlib import Path

from services.reach import codes as code_mod
from services.reach import sms

OUT = Path(__file__).resolve().parent / "fixtures" / "sms_parity.json"
BASE = "https://krishiloop.example"
RECEIPTS = [
    ("en", {"kind": "input_decision", "decision": "dont_spray"}, ("R-PLB-002", 1), "7KQ2MX4P"),
    ("bn", {"kind": "input_decision", "decision": "dont_spray"}, ("R-PLB-002", 1), "7KQ2MX4P"),
    ("en", {"kind": "input_decision", "decision": "spray"}, ("R-ABC-002", 1), "A1B2C3D4"),
    ("bn", {"kind": "input_decision", "decision": "recheck"}, ("R-ABC-002", 2), "ZZZZ0000"),
    ("en", {"kind": "monitoring"}, ("R-PLB-008", 1), "M4N5P6Q7"),
    ("bn", {"kind": "practice"}, ("R-ABC-006", 1), "HJKM9WXY"),
    ("en", {"kind": "harvest"}, ("R-PLB-011", 3), "0123ABCD"),
]
RAW = [   # edge cases for the fill-collapse-count rules (whitespace, slots inside values, GSM extension, Bangla, emoji)
    {"template": "  Hello {decision}\n\n{rule}  {code}:\t{url}  ",
     "parts": {"decision": "a\u00a0 b", "rule": "R-X-001 v1", "code": "ABCD-EFGH", "url": "https://x/v/ABCD-EFGH"}},
    {"template": "{decision} {decision} {unknown} {rule}", "parts": {"decision": "x{rule}", "rule": "y", "code": "", "url": ""}},
    {"template": "{decision}", "parts": {"decision": "a" * 161, "rule": "", "code": "", "url": ""}},
    {"template": "{decision}", "parts": {"decision": "{x}[y]~|^\\€" + "b" * 140, "rule": "", "code": "", "url": ""}},
    {"template": "{decision}", "parts": {"decision": "ক" * 135, "rule": "", "code": "", "url": ""}},
    {"template": "{decision}", "parts": {"decision": "Plant \U0001F954 now", "rule": "", "code": "", "url": ""}},
]
TYPED = ["7KQ2-MX4P", "7kq2mx4p", " 7kq2 mx4p ", "7KQ2–MX4P", "7kq2_mx4p", "7KQ2.MX4P", "OOOO-IIII", "ol1i-0000",
         "", "7KQ2-MX4", "7KQ2-MX4PP", "7KQ2-MX4U", "7KQ2/MX4P", "urn:uuid:7KQ2MX4P", "7" * 40, "৭KQ2MX4P"]


def build() -> dict:
    receipts = []
    for lang, advice, (rid, ver), code in RECEIPTS:
        cred = {"credentialSubject": {"advice": advice, "rule_refs": [{"rule_id": rid, "version": ver}]}}
        text = sms.receipt_sms(cred, lang, code, BASE)
        receipts.append({"lang": lang, "advice": advice, "rule": {"rule_id": rid, "version": ver}, "code": code,
                         "public_base": BASE, "expected": {"text": text, **sms.sms_info(text)}})
    raw = []
    for r in RAW:
        text = sms.build_sms(r["template"], r["parts"])
        raw.append({**r, "expected": {"text": text, **sms.sms_info(text)}})
    return {
        "note": "Shared by tests/test_reach.py (services/reach/sms.py) and apps/web/src/features/verify/reachParity.test.ts "
                "(apps/web/src/features/farmer/sms.ts and the web dictionaries). Both must produce `expected` exactly.",
        "templates": sms.TEMPLATES, "decision_words": sms.DECISION_WORDS, "kind_words": sms.KIND_WORDS,
        "receipts": receipts, "raw": raw,
        "codes": [{"typed": t, "code": code_mod.normalize(t) or ""} for t in TYPED],
    }


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(build(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
