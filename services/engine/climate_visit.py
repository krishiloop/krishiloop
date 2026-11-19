"""The "Ask an officer to visit or call" booking: the farmer's booking becomes an officer-inbox case (reason_code visit_request).

Checked here: a date in the next 14 days (today included), a time of day, visit or call, an optional phone number and
a short note. The phone number is stored MASKED only (services/reach/senders.mask): the full number is never written.
In the demo it is a sandbox case like every other; nobody is called or visited.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from pathlib import Path

from services.engine import inbox

DAYS_AHEAD = 14
SLOTS = ("morning", "afternoon", "evening")
MODES = ("visit", "call")
NOTE_MAX = 280
_PHONE = re.compile(r"^\+?[0-9]{8,15}$")
REASON = {  # what the farmer is told; Bangla machine-written, pending native-speaker review
    "en": "Your request went to your officer's inbox. The officer decides the time; this demo calls no one.",
    "bn": "আপনার অনুরোধ কর্মকর্তার ইনবক্সে গেছে। সময় কর্মকর্তা ঠিক করবেন; এই ডেমো কাউকে ফোন করে না।",
}


class VisitError(ValueError):
    pass


def check(req: dict, today: date) -> dict:
    """Validate and normalise a booking; raises VisitError with a plain reason."""
    try:
        when = date.fromisoformat(str(req.get("date", "")))
    except ValueError:
        raise VisitError("date must be YYYY-MM-DD")
    if not today <= when <= today + timedelta(days=DAYS_AHEAD):
        raise VisitError(f"date must be within the next {DAYS_AHEAD} days")
    slot, mode = req.get("slot"), req.get("mode", "visit")
    if slot not in SLOTS:
        raise VisitError(f"slot must be one of {', '.join(SLOTS)}")
    if mode not in MODES:
        raise VisitError("mode must be visit or call")
    phone = re.sub(r"[\s\-().]", "", str(req.get("phone") or ""))
    if phone and not _PHONE.match(phone):
        raise VisitError("phone must be 8 to 15 digits, optionally starting with +")
    if mode == "call" and not phone:
        raise VisitError("a call needs a phone number")
    note = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", str(req.get("note") or "")).strip()[:NOTE_MAX]
    return {"date": when.isoformat(), "slot": slot, "mode": mode, "phone": phone or None, "note": note}


def create(field_id: str, profile_id: str, req: dict, inbox_dir: Path | None, today: date | None = None,
           lang: str = "en") -> dict:
    from services.reach.senders import mask
    ok = check(req, today or date.today())
    masked = mask(ok["phone"]) if ok["phone"] else None
    details = {"kind": "visit_request", "requested_date": ok["date"], "slot": ok["slot"], "mode": ok["mode"],
               "phone_masked": masked, "lang": lang,
               "note_for_officer": "Sandbox: the number is kept masked only, so nobody can be called from this demo."}
    item_id = inbox.create(field_id, profile_id, "visit_request", dict(REASON), details, inbox_dir,
                           extra={"question": ok["note"] or None, "priority": "normal"})
    return {"item_id": item_id, "status": "open", "requested_date": ok["date"], "slot": ok["slot"], "mode": ok["mode"],
            "phone_masked": masked, "reason": dict(REASON)}
