"""SMS text, server side: the receipt SMS (exactly the text of the web preview, apps/web/src/features/farmer/sms.ts) and
the recall notice.

Parity with the web preview is proven by shared fixtures (fixtures/sms_parity.json): tests/test_reach.py checks this
module against them, and apps/web/src/features/verify/reachParity.test.ts checks the web's buildSms, smsInfo and its
dictionaries (fa.sms.template, ui.decision.*, ui.kind.*) against the same file.

SMS length rules (3GPP TS 23.038), as in sms.ts: text that fits the GSM 7-bit alphabet gets 160 characters per message
(153 per part when split); anything else, Bangla included, is UCS-2 with 70 per message (67 per part), counted in UTF-16
code units. A few GSM characters (^ { } \\ [ ] ~ | €) take two slots.
"""
from __future__ import annotations

import re

GSM_BASIC = ("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿"
             "abcdefghijklmnopqrstuvwxyzäöñüà")
GSM_EXT = "^{}\\[~]|€"
# JavaScript's \s and trim() (the web collapses whitespace with /\s+/g); Python's own \s differs at the edges
_JS_SPACE_CHARS = ("\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
                   "\u2028\u2029\u202f\u205f\u3000\ufeff")
_JS_SPACE = re.compile(f"[{_JS_SPACE_CHARS}]+")
_SLOTS = re.compile(r"\{(decision|rule|code|url)\}")

# the web dictionaries' words (en.farmer.ts / bn.farmer.ts fa.sms.template; en.ui.ts / bn.ui.ts ui.decision.* ui.kind.*)
TEMPLATES = {
    "en": "KrishiLoop: {decision}. Rule {rule}. Check receipt {code}: {url}",
    "bn": "কৃষিলুপ: {decision}। নিয়ম {rule}। রসিদ যাচাই {code}: {url}",
}
DECISION_WORDS = {
    "en": {"dont_spray": "No spray needed", "recheck": "Re-check", "spray": "Act now"},
    "bn": {"dont_spray": "স্প্রে দরকার নেই", "recheck": "আবার দেখুন", "spray": "এখনই ব্যবস্থা নিন"},
}
KIND_WORDS = {
    "en": {"input_decision": "Spray decision", "monitoring": "Check", "irrigation": "Water", "harvest": "Harvest",
           "nutrient": "Fertiliser", "officer_contact": "Officer", "practice": "Good practice", "other": "Advice"},
    "bn": {"input_decision": "স্প্রের সিদ্ধান্ত", "monitoring": "নজর রাখুন", "irrigation": "সেচ", "harvest": "ফসল তোলা",
           "nutrient": "সার", "officer_contact": "অফিসার", "practice": "ভালো চর্চা", "other": "পরামর্শ"},
}
# the recall notice (server only): recalled, do not follow advice R-... from <date>, check .../v/CODE
RECALL_TEMPLATES = {
    "en": "KrishiLoop: RECALLED. Do not follow advice {rule} from {date}. Check {url}",
    "bn": "কৃষিলুপ: বাতিল। {date} তারিখের পরামর্শ {rule} মানবেন না। যাচাই: {url}",
}
LANGS = tuple(TEMPLATES)


def sms_info(text: str) -> dict:
    """units (as the network counts them), unicode, limit (160 or 70) and segments: smsInfo() in sms.ts."""
    units, unicode = 0, False
    for ch in text:
        if ch in GSM_BASIC:
            units += 1
        elif ch in GSM_EXT:
            units += 2
        else:
            unicode = True
            break
    if unicode:
        units = len(text.encode("utf-16-le")) // 2
        return {"units": units, "unicode": True, "limit": 70, "segments": 1 if units <= 70 else -(-units // 67)}
    return {"units": units, "unicode": False, "limit": 160, "segments": 1 if units <= 160 else -(-units // 153)}


def build_sms(template: str, parts: dict) -> str:
    """buildSms() in sms.ts: fill {decision} {rule} {code} {url}, collapse whitespace, trim."""
    return _JS_SPACE.sub(" ", _SLOTS.sub(lambda m: str(parts[m.group(1)]), template)).strip(_JS_SPACE_CHARS)


def pick_lang(lang: str | None) -> str:
    return lang if lang in LANGS else "en"


def verify_link(public_base: str, code: str) -> str:
    from services.reach.codes import display
    return f"{public_base.rstrip('/')}/v/{display(code)}"


def decision_word(advice: dict, lang: str) -> str:
    """The receipt's decision in words, as the web's receipt sheet says it (decision, else the kind of advice)."""
    lang = pick_lang(lang)
    if advice.get("decision"):
        return DECISION_WORDS[lang].get(advice["decision"], advice["decision"])
    kinds = KIND_WORDS[lang]
    return kinds.get(advice.get("kind") or "other", kinds["other"])


def rule_label(subject: dict) -> str:
    refs = subject.get("rule_refs") or []
    return f"{refs[0]['rule_id']} v{refs[0]['version']}" if refs else ""


def receipt_sms(credential: dict, lang: str, code: str, public_base: str) -> str:
    """The SMS for one signed receipt: decision, rule, the short code and {PUBLIC_BASE}/v/{code}."""
    from services.reach.codes import display
    subject = credential.get("credentialSubject") or {}
    lang = pick_lang(lang)
    return build_sms(TEMPLATES[lang], {"decision": decision_word(subject.get("advice") or {}, lang),
                                       "rule": rule_label(subject), "code": display(code),
                                       "url": verify_link(public_base, code)})


def recall_text(lang: str, rule: str, date: str, url: str) -> str:
    """The recall notice: recalled, do not follow advice <rule> from <date>, check <url>."""
    t = RECALL_TEMPLATES[pick_lang(lang)]
    return _JS_SPACE.sub(" ", t.format(rule=rule, date=date, url=url)).strip(_JS_SPACE_CHARS)
