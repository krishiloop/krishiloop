"""Area ledger: a photo model earns trust per area, from officer verdicts on suggestions it froze beforehand.

plan/EARNED_TRUST_DESIGN.md. Rules (each covered by tests/test_ledger.py):
- the suggestion is recorded before the officer answers (prequential); a verdict without one is refused, and a case
  is judged once, so every verdict is an honest out-of-sample test;
- the gate opens when the officer's verdicts on the last `window` sure suggestions number at least
  `min_sure_answers` and their Wilson 95% lower bound on precision reaches `open_lower_bound`; it closes when the
  bound falls below `close_lower_bound` (hysteresis), and the caller then revokes the area's trust credential;
- while open, sure suggestions are answered automatically, and a fixed share is still sent to the officer as an
  audit (chosen from the server-made case id, so a client cannot steer it); unsure ones always go to the officer;
- one ledger per (area, model version): a new model version starts from zero.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
POLICY_FILE = ROOT / "rules" / "policy" / "photo-trust.yaml"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def wilson_lower_bound(k: int, n: int, z: float = 1.96) -> float:
    if n == 0:
        return 0.0
    p = k / n
    return (p + z * z / (2 * n) - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n)


@dataclass(frozen=True)
class Policy:
    version: int
    sure_threshold: float
    window: int
    min_sure_answers: int
    open_lower_bound: float
    close_lower_bound: float
    audit_rate: float

    @classmethod
    def load(cls, path: Path = POLICY_FILE) -> "Policy":
        d = yaml.safe_load(path.read_text(encoding="utf-8"))
        return cls(**{k: d[k] for k in cls.__dataclass_fields__})


class LedgerError(ValueError):
    pass


class AreaLedger:
    def __init__(self, area: str, model: str, policy: Policy, path: Path | None = None):
        self.area, self.model, self.policy, self.path = area, model, policy, path
        self._lock = threading.RLock()
        self.cases: dict[str, dict] = {}      # case id -> frozen suggestion (+ verdict once judged)
        self.verdicts: list[str] = []         # case ids in the order the officer judged them
        self.gate_open = False
        self.events: list[dict] = []
        if path and path.exists():
            d = json.loads(path.read_text(encoding="utf-8"))
            if (d["area"], d["model"]) != (area, model):
                raise LedgerError("ledger file belongs to another area or model")
            self.cases, self.verdicts, self.gate_open, self.events = d["cases"], d["verdicts"], d["gate_open"], d["events"]

    # ------------------------------------------------------------------ evidence
    def _sure_window(self) -> list[bool]:
        sure = [self.cases[c]["correct"] for c in self.verdicts if self.cases[c]["sure"]]
        return sure[-self.policy.window:]

    def stats(self) -> dict:
        with self._lock:
            w = self._sure_window()
            return {"area": self.area, "model": self.model, "policy_version": self.policy.version,
                    "verdicts": len(self.verdicts), "sure_in_window": len(w), "sure_right_in_window": sum(w),
                    "precision": round(sum(w) / len(w), 4) if w else None,
                    "lower_bound": round(wilson_lower_bound(sum(w), len(w)), 4), "gate_open": self.gate_open,
                    "events": list(self.events)}

    # ------------------------------------------------------------------ flow
    def suggest(self, case_id: str, labels: list[str], probs: list[float]) -> dict:
        """Freeze the model's suggestion for a new case and say where it goes: 'auto' or 'officer'."""
        if len(labels) != len(probs) or not labels:
            raise LedgerError("labels and probabilities must match")
        with self._lock:
            if case_id in self.cases:
                raise LedgerError("case already has a suggestion")
            top = max(range(len(probs)), key=probs.__getitem__)
            sure = probs[top] >= self.policy.sure_threshold
            audit = self._audit_draw(case_id) < self.policy.audit_rate
            route = "auto" if self.gate_open and sure and not audit else "officer"
            self.cases[case_id] = {"suggested": labels[top], "prob": round(float(probs[top]), 4), "sure": sure,
                                   "route": route, "audit": self.gate_open and sure and audit,
                                   "suggested_at": _now(), "verdict": None, "correct": None}
            self._save()
            return {"case_id": case_id, "route": route, "suggested": labels[top], "sure": sure}

    def judge(self, case_id: str, label: str, by: str) -> dict | None:
        """The officer's verdict. Returns a gate event ('opened' / 'closed') when this verdict moves the gate."""
        with self._lock:
            case = self.cases.get(case_id)
            if case is None:
                raise LedgerError("no frozen suggestion for this case")
            if case["verdict"] is not None:
                raise LedgerError("case already judged")
            case.update(verdict=label, correct=case["suggested"] == label, judged_by=by, judged_at=_now())
            self.verdicts.append(case_id)
            event = self._update_gate()
            self._save()
            return event

    def _update_gate(self) -> dict | None:
        w = self._sure_window()
        if len(w) < self.policy.min_sure_answers:
            return None
        lb = wilson_lower_bound(sum(w), len(w))
        if not self.gate_open and lb >= self.policy.open_lower_bound:
            self.gate_open = True
        elif self.gate_open and lb < self.policy.close_lower_bound:
            self.gate_open = False
        else:
            return None
        event = {"event": "opened" if self.gate_open else "closed", "at": _now(), "verdicts": len(self.verdicts),
                 "sure_in_window": len(w), "precision": round(sum(w) / len(w), 4), "lower_bound": round(lb, 4),
                 "policy_version": self.policy.version}
        self.events.append(event)
        return event

    def _audit_draw(self, case_id: str) -> float:
        return int(hashlib.sha256(f"audit:{self.area}:{case_id}".encode()).hexdigest()[:8], 16) / 0x100000000

    def _save(self) -> None:
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"area": self.area, "model": self.model, "policy": asdict(self.policy),
                                   "cases": self.cases, "verdicts": self.verdicts, "gate_open": self.gate_open,
                                   "events": self.events}, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self.path)
