"""Recall fan-out: when a rule version is recalled in a store, every holder of a receipt from that store that cites it
gets a notice on their channel (a Telegram chat, or a sandbox SMS number), once.

Each notice is recorded (receipt, rule version, channel, time, status): "sent" (Telegram accepted it), "sandbox" (an SMS
written to the outbox, not sent) or "failed" (with the reason; a later recall call tries a failed one again).
"""
from __future__ import annotations

from services.reach.db import ReachDB
from services.reach.senders import Delivery, Sender
from services.reach.sms import recall_text, verify_link


def cites(credential: dict, rule_id: str, version: int) -> bool:
    refs = (credential.get("credentialSubject") or {}).get("rule_refs") or []
    return any(r.get("rule_id") == rule_id and r.get("version") == version for r in refs)


def fan_out(db: ReachDB, store, rule_id: str, version: int, public_base: str, senders: dict[str, Sender]) -> dict:
    """Notify every holder of an affected receipt in `store` (a TrustStore); returns the summary for the officer."""
    store_id, rule = store.status_id, f"{rule_id}@{version}"
    creds: dict[str, dict | None] = {}
    for h in db.holders(store_id):
        cid = h["credential_id"]
        if cid not in creds:
            try:
                creds[cid] = store.get(cid)
            except (FileNotFoundError, ValueError):
                creds[cid] = None
        cred = creds[cid]
        if not cred or not cites(cred, rule_id, version) or db.notified(store_id, cid, rule, h["id"]):
            continue
        code = db.code_for(cid) or db.issue_code(cid, store_id)
        text = recall_text(h["lang"], f"{rule_id} v{version}", str(cred.get("validFrom", ""))[:10],
                           verify_link(public_base, code))
        sender = senders.get(h["channel"])
        try:
            d = sender.send(h["address"], text, {"credential_id": cid, "rule": rule}) if sender else \
                Delivery("failed", f"no sender for channel {h['channel']}")
        except Exception as e:      # a sender must never break the recall itself
            d = Delivery("failed", type(e).__name__)
        db.record_notification(store_id, cid, rule, h["channel"], h["id"], d.status, d.detail)
    return summary(db, store_id, rule)


def summary(db: ReachDB, store_id: str, rule: str) -> dict:
    """One line per holder and receipt (its best outcome): what the officer's recall result shows."""
    best: dict[tuple, dict] = {}
    for n in db.notifications(store_id, rule):
        key = (n["credential_id"], n["holder_id"])
        if key not in best or best[key]["status"] == "failed":
            best[key] = n
    rows = list(best.values())
    tg = sum(r["channel"] == "telegram" and r["status"] == "sent" for r in rows)
    sms_sandbox = sum(r["channel"] == "sms" and r["status"] == "sandbox" for r in rows)
    sms_sent = sum(r["channel"] == "sms" and r["status"] == "sent" for r in rows)
    failed = sum(r["status"] == "failed" for r in rows)
    return {"total": tg + sms_sandbox + sms_sent, "telegram": tg, "sms_sandbox": sms_sandbox, "sms_sent": sms_sent,
            "failed": failed, "receipts": len({r["credential_id"] for r in rows if r["status"] != "failed"}),
            "note": "SMS is sandbox: written to an outbox, not sent. Telegram notices are sent only when the bot token is set."}
