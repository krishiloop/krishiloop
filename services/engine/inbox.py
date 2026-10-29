"""Officer inbox: every abstention becomes a stored case (contracts/schemas/inbox_item.schema.json).

The farmer sees a fixed, localised message. What the validator blocked, which facts were missing and
which rule was recalled stay here, for the officer only.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INBOX_DIR = ROOT / "data" / "inbox"


def create(field_id: str, farmer: str, reason_code: str, reason: dict, details: dict, inbox_dir: Path | None = None,
           extra: dict | None = None) -> str:
    d = inbox_dir or INBOX_DIR
    d.mkdir(parents=True, exist_ok=True)
    item_id = f"inbox-{uuid.uuid4().hex[:12]}"
    item = {"item_id": item_id, "field_id": field_id, "farmer_display_name": farmer, "reason_code": reason_code,
            "reason": reason, "photo_attached": False, "status": "open",
            "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "details": details, **(extra or {})}
    tmp = d / f"{item_id}.json.tmp"
    tmp.write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, d / f"{item_id}.json")
    return item_id


def list_items(inbox_dir: Path | None = None) -> list[dict]:
    d = inbox_dir or INBOX_DIR
    if not d.exists():
        return []
    items = [json.loads(p.read_text(encoding="utf-8")) for p in d.glob("inbox-*.json")]
    items.sort(key=lambda i: i["created_at"], reverse=True)               # newest first ...
    return sorted(items, key=lambda i: i.get("priority") != "urgent")      # ... with urgent cases (unsafe intent) on top


def get_item(item_id: str, inbox_dir: Path | None = None) -> dict:
    if not item_id.startswith("inbox-") or not item_id[6:].isalnum():
        raise FileNotFoundError(item_id)
    return json.loads(((inbox_dir or INBOX_DIR) / f"{item_id}.json").read_text(encoding="utf-8"))


def resolve(item_id: str, note: str, by: str, inbox_dir: Path | None = None) -> dict:
    d = inbox_dir or INBOX_DIR
    item = get_item(item_id, d)
    item.update(status="resolved", resolution_note=note, resolved_by=by,
                resolved_at=datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"))
    tmp = d / f"{item_id}.json.tmp"
    tmp.write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, d / f"{item_id}.json")
    return item
