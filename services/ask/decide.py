"""Ask decisions: the deterministic engine, not retrieval, decides what a farmer is told (Constitution Art. 1-2).

Candidates are the top rules whose retrieval confidence reaches the mode's threshold (fixed on a held-out split).
Only the best of them can answer: the most confident one and any within `prefer_margin` of it (a near tie), in which
practices and monitoring go before input decisions (IPM first) unless the question is about spraying. In that order:
- a practice / monitoring / irrigation / harvest rule is answered only if its `when` holds for this field and farmer
  (three-valued, as in the planner: a missing fact is never "no risk") and that rule version is not recalled;
- an input decision is answered only when the question asks about spraying (lexicon `input_decision_words`), and
  only by the planner's own logic (make_plan, run without minting anything), so a question gets the same single
  decision, and the same abstentions, as the weekly plan;
- if the best does not apply (its conditions are unmet or unknown), the case goes to the officer inbox as
  `question_unanswered` with a fixed farmer message; a clearly weaker match is never used instead.
An answer is the rule's validated text, checked by validate_action and signed through the planner's own _receipt and
the trust store. The receipt carries only a sha256 fingerprint of the question (receipts can be opened by anyone with
the link); the readable question, minus phone numbers and e-mail addresses, goes only to the officer inbox.
"""
from __future__ import annotations

import hashlib
import re
import tempfile
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Callable

from services.engine import inbox
from services.engine import snapshot as snap_mod
from services.engine.planner import MAX_SNAPSHOT_AGE_H, PLACEHOLDER_CRED, REASONS, _receipt, make_plan
from services.engine.rules import evaluate, pack_parameters
from services.trust.store import RuleRecalled

ROUTER_VERSION = "0.1.0"
_PHONE = re.compile(r"\+?\d(?:[\s\-.]?\d){6,}")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def redact(text: str, digits: dict[int, str]) -> str:
    """The question as written, minus phone numbers and e-mail addresses (it is stored in a receipt and the inbox)."""
    probe = text.translate(digits)                    # each script digit maps to one ASCII digit: same length
    spans = sorted(m.span() for rx in (_PHONE, _EMAIL) for m in rx.finditer(probe))
    merged: list[list[int]] = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    for a, b in reversed(merged):
        text = text[:a] + "[removed]" + text[b:]
    return text


class NoIssueStore:
    """Lets make_plan decide without minting: recall checks pass through, issuance returns a placeholder. Other store
    methods are absent on purpose, so a planner change that needs one fails loudly in the tests."""

    def __init__(self, store):
        self._store = store

    def is_recalled(self, rule_id: str, version: int) -> bool:
        return self._store.is_recalled(rule_id, version)

    def trusted_photo_model(self, model: str, area: str):
        return self._store.trusted_photo_model(model, area)

    def rule_credential(self, rule: dict) -> dict:
        if self._store.is_recalled(rule["rule_id"], rule["version"]):
            raise RuleRecalled(f"{rule['rule_id']} v{rule['version']}")
        return {"id": PLACEHOLDER_CRED}

    def receipt_credential(self, receipt: dict, valid_until: str | None = None) -> dict:
        return {"id": PLACEHOLDER_CRED}


def plan_decision(field_: dict, profile: dict, store, snap: dict, today: date) -> dict:
    """The weekly plan's own decision logic, run without minting; an abstention keeps its officer-only details."""
    with tempfile.TemporaryDirectory() as tmp:
        plan = make_plan(field_, profile, NoIssueStore(store), snap=snap, today=today, inbox_dir=Path(tmp))
        if plan["status"] == "abstained":
            ab = plan["abstention"]
            ab["details"] = inbox.get_item(ab.pop("inbox_item_id"), Path(tmp)).get("details", {})
    return plan


def field_facts(field_: dict, profile: dict, snap: dict, today: date) -> tuple[dict, bool]:
    """The planner's facts (stage, forecast-derived counts, the farmer's profile); a stale forecast counts as unknown."""
    stale = snap.get("mode") != "live" and snap_mod.age_hours(snap) > MAX_SNAPSHOT_AGE_H
    weather = snap_mod.weather_facts(snap, pack_parameters(field_["pack_id"]), today)
    if stale:
        weather = dict.fromkeys(weather)
    return {"stage": field_["stage"], **weather, **{k: v for k, v in profile.items() if k != "farmer_profile_id"}}, stale


@dataclass
class Candidate:
    rule: dict
    conf: float
    rank: int
    status: str = "not evaluated"
    missing: list[str] = field(default_factory=list)

    @property
    def kind(self) -> str:
        return self.rule["action"]["kind"]

    def row(self) -> dict:
        out = {"rule_id": self.rule["rule_id"], "version": self.rule["version"], "kind": self.kind, "rank": self.rank,
               "confidence": round(float(self.conf), 4), "status": self.status}
        return {**out, "missing": self.missing} if self.missing else out


def best_group(cands: list[Candidate], margin: float, input_intent: bool = False) -> list[Candidate]:
    """The best candidates: those within `margin` of the most confident one (a near tie). Within the group, practices
    and monitoring go before input decisions (IPM first), unless the question itself is about an input decision
    (spray or not), then the other way round; otherwise retrieval rank order."""
    if not cands:
        return []
    best = max(c.conf for c in cands)
    group = [c for c in cands if c.conf >= best - margin]
    first = (lambda c: c.kind == "input_decision") if input_intent else (lambda c: c.kind != "input_decision")
    return sorted(group, key=lambda c: (not first(c), c.rank))


def gate(query, field_: dict, tau: float | None) -> str | None:
    """Questions no candidate may answer: about another crop than the field's, or with no threshold fixed."""
    if query.crops and field_["crop"] not in query.crops:
        return "other_crop"
    if tau is None:
        return "uncalibrated"
    return None


def candidates(hits, rules: dict, tau: float, k: int) -> list[Candidate]:
    """The top-k retrieved rules whose confidence reaches the threshold, in retrieval rank order."""
    top = [Candidate(rules[h.rule_id], h.conf, n + 1) for n, h in enumerate(hits[:k])]
    return [c for c in top if c.conf >= tau]


def walk(cands: list[Candidate], facts: dict, store, decide_input: Callable[[], dict], margin: float,
         input_intent: bool = False) -> dict:
    """Answer with the best candidate that fires, considering only the best group (a near tie). A clearly weaker
    match is never used instead, because it would answer a different question. If the best does not apply: officer."""
    group = best_group(cands, margin, input_intent)
    tried: list[Candidate] = []
    for n, c in enumerate(group):
        r = c.rule
        tried.append(c)
        if c.kind == "input_decision":
            if not input_intent:   # a spray decision answers only a question about spraying ("will it rain?" is not)
                c.status = "input decision, but the question does not ask about spraying"
                continue
            c.status = "input decision: decided by the plan logic"
            plan = decide_input()
            if plan["status"] == "ok":
                act = next(a for a in plan["actions"] if a["kind"] == "input_decision")
                return {"kind": "answer", "rule_id": act["receipt"]["rule_refs"][0]["rule_id"], "via": "plan_decision",
                        "matched": r["rule_id"], "conf": c.conf, "tried": tried}
            ab = plan["abstention"]
            return {"kind": "abstain", "code": ab["reason_code"], "why": "plan_abstained", "details": ab.get("details", {}),
                    "tried": tried}
        result, missing = evaluate(r, facts)
        if result and store.is_recalled(r["rule_id"], r["version"]):
            c.status = "recalled"
            if n == 0:   # the best answer was withdrawn: say so rather than answer something else
                return {"kind": "abstain", "code": "rule_recalled", "why": "best_rule_recalled", "tried": tried}
            continue
        if result:
            c.status = "applies"
            return {"kind": "answer", "rule_id": r["rule_id"], "via": "rule", "matched": r["rule_id"], "conf": c.conf,
                    "tried": tried}
        c.status, c.missing = ("unknown", sorted(missing)) if result is None else ("does not apply here", [])
    for c in cands:                               # weaker candidates: evaluated for the officer's record only
        if c not in tried:
            c.status = "weaker match, not used"
            tried.append(c)
    if any(c.status == "recalled" for c in tried):
        return {"kind": "abstain", "code": "rule_recalled", "why": "rule_recalled", "tried": tried}
    why = "no_candidate_above_threshold" if not cands else \
        "conditions_unknown" if any(c.status == "unknown" for c in group) else \
        "decision_not_asked" if all(c.kind == "input_decision" for c in group) else "conditions_unmet"
    return {"kind": "abstain", "code": "question_unanswered", "why": why, "tried": tried}


def answer_context(ask_id: str, field_: dict, snap: dict, today: date) -> dict:
    """The receipt's `plan` block for an answer: the same week window and field hash as the weekly plan."""
    return {"plan_id": ask_id, "pack_id": field_["pack_id"], "crop": field_["crop"], "stage": field_["stage"],
            "valid_from": today.isoformat(), "valid_to": (today + timedelta(days=6)).isoformat(),
            "field_ref": hashlib.sha256(f"krishiloop-field:{field_['field_id']}".encode()).hexdigest()[:16],
            "data_mode": snap.get("mode", "live"), "data_as_of": snap["created_at"]}


def render(rule: dict, ctx: dict, snap: dict, facts: dict, today: date, question: str, asked_at: str, match: dict,
           path: list[str]) -> dict:
    """The action exactly as the planner builds it (rule text only; no phrasing model), with its receipt."""
    a = rule["action"]
    act = {"action_id": f"A-{rule['rule_id'].lower()}-{uuid.uuid4().hex[:6]}", "kind": a["kind"], "title": dict(a["title"])}
    for k in ("decision", "traffic_light"):
        if a.get(k):
            act[k] = a[k]
    receipt = _receipt(rule, snap, facts, {**act, "phrasing_model": None}, ctx, today)
    # Receipts can be opened by anyone holding the link, so they carry a fingerprint of the question, never its words:
    # the farmer (who has the text) can still show this answer was for their question.
    receipt["data"] += [
        {"source": "farmer:question", "variable": "question_sha256", "unit": "sha256 of the question as written",
         "value": hashlib.sha256(question.encode("utf-8")).hexdigest(), "observed_at": asked_at, "retrieved_at": asked_at},
        {"source": f"krishiloop:ask-router@{ROUTER_VERSION}", "variable": "question_match_confidence",
         "value": round(float(match["conf"]), 4), "unit": f"{match['mode']} (threshold {match['tau']})",
         "observed_at": asked_at, "retrieved_at": asked_at}]
    receipt["graph_path"] = list(path)
    receipt["confidence"]["basis"] += (
        " Answer to the farmer's question: the Ask router only matched the question to this rule; the rule engine "
        "checked that the rule applies to this field." if match["via"] == "rule" else
        f" Answer to the farmer's question about an input decision: the weekly plan's own logic chose this decision "
        f"for this field (the question matched {match['matched']}).")
    act["receipt"] = receipt
    return act


def issue(act: dict, rule: dict, store, today: date) -> None:
    """Mint exactly as the planner does: the rule version's credential, then the receipt (valid for the plan week)."""
    valid_until = f"{(today + timedelta(days=7)).isoformat()}T23:59:59Z"
    act["receipt"]["rule_refs"][0]["credential_id"] = store.rule_credential(rule)["id"]
    act["receipt_credential_id"] = store.receipt_credential(act["receipt"], valid_until)["id"]


def abstain(code: str, field_: dict, profile: dict, inbox_dir, question: str, details: dict, messages: dict) -> dict:
    """An officer-inbox case with the farmer's question; the farmer sees only the fixed message for the code."""
    reason = dict(messages.get(code) or {"en": REASONS[code]})
    item_id = inbox.create(field_["field_id"], profile["farmer_profile_id"], code, reason, details, inbox_dir,
                           extra={"question": question})
    return {"reason_code": code, "reason": reason, "inbox_item_id": item_id}
