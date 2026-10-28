"""Photo cases: the area's model suggests, the ledger routes, the officer judges, area trust is issued or withdrawn.

plan/EARNED_TRUST_DESIGN.md. This module never sees pixels: `featurize` turns an image into an L2-normalised vector
(services/vision/backbone.py on a server with the model installed; a fake in tests). A photo is kept only with the
farmer's consent and only when it goes to the officer. Only diagnoses built here from a server case can pass the
planner's gate (make_plan(..., diagnosis_from_server=True)); anything a client reports cannot.
"""
from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import numpy as np

from services.engine.planner import trust_area
from services.vision import probe
from services.vision.ledger import AreaLedger, LedgerError, Policy

REFIT_EVERY, REFIT_ALL_UNTIL, TEMP_HISTORY = 10, 20, 200


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", s)


class PhotoService:
    def __init__(self, store, data_dir: Path, model: str, model_sha256: str, labels: list[str], text: np.ndarray,
                 featurize: Callable[[bytes], np.ndarray], policy: Policy | None = None, lam: float = probe.DEFAULT_LAMBDA):
        self.store, self.dir, self.model, self.model_sha256, self.labels = store, data_dir, model, model_sha256, list(labels)
        self.T, self.featurize, self.policy, self.lam = probe.l2n(np.asarray(text, dtype=np.float64)), featurize, \
            policy or Policy.load(), lam
        self._lock = threading.RLock()
        self._ledgers: dict[str, AreaLedger] = {}

    # ------------------------------------------------------------------ storage
    def _area_dir(self, area: str) -> Path:
        return self.dir / "areas" / f"{_slug(area)}__{_slug(self.model)}"

    def ledger(self, area: str) -> AreaLedger:
        with self._lock:
            if area not in self._ledgers:
                self._ledgers[area] = AreaLedger(area, self.model, self.policy, self._area_dir(area) / "ledger.json")
            return self._ledgers[area]

    def _model_state(self, area: str) -> dict:
        p = self._area_dir(area) / "model.npz"
        if not p.exists():
            return {"D": np.zeros_like(self.T), "temp": 1.0}
        z = np.load(p)
        return {"D": z["D"], "temp": float(z["temp"])}

    def _save_model_state(self, area: str, D: np.ndarray, temp: float) -> None:
        d = self._area_dir(area); d.mkdir(parents=True, exist_ok=True)
        tmp = d / "model.tmp.npz"
        np.savez(tmp, D=D, temp=temp)
        os.replace(tmp, d / "model.npz")

    def _case_path(self, case_id: str) -> Path:
        if not re.fullmatch(r"pc-[0-9a-f]{16}", case_id or ""):
            raise LedgerError("unknown photo case")
        return self.dir / "cases" / f"{case_id}.json"

    def case(self, case_id: str) -> dict:
        p = self._case_path(case_id)
        if not p.exists():
            raise LedgerError("unknown photo case")
        return json.loads(p.read_text(encoding="utf-8"))

    def _save_case(self, case: dict) -> None:
        p = self._case_path(case["case_id"]); p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(case, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, p)

    # ------------------------------------------------------------------ flow
    def submit(self, field: dict, image: bytes, consent: bool) -> dict:
        """A farmer's photo: suggest, freeze the suggestion in the area's ledger, route it."""
        x = probe.l2n(np.asarray(self.featurize(image), dtype=np.float64))
        area = trust_area(field)
        with self._lock:
            st = self._model_state(area)
            z = probe.logits(x[None], self.T, st["D"])[0]
            p = probe.probabilities(z[None], st["temp"])[0]
            case_id = f"pc-{uuid.uuid4().hex[:16]}"
            routed = self.ledger(area).suggest(case_id, self.labels, p.tolist())
            order = np.argsort(-p)
            case = {"case_id": case_id, "area": area, "model": self.model, "field_id": field["field_id"], "crop": field["crop"],
                    "created_at": _now(), "route": routed["route"], "sure": routed["sure"],
                    "suggestion": [{"label": self.labels[i], "prob": round(float(p[i]), 4)} for i in order[:2]],
                    "x": x.tolist(), "logits": z.tolist(), "consent": bool(consent), "photo": None, "verdict": None}
            if consent and routed["route"] == "officer":
                photo = self.dir / "photos" / f"{case_id}.jpg"; photo.parent.mkdir(parents=True, exist_ok=True)
                photo.write_bytes(image)
                case["photo"] = photo.name
            self._save_case(case)
        return self.public(case)

    def judge(self, case_id: str, label: str, by: str) -> dict:
        """The officer's verdict: evidence for the area, a refit, and possibly a gate event (trust issued or withdrawn)."""
        if label not in self.labels:
            raise LedgerError("unknown label")
        with self._lock:
            case = self.case(case_id)
            area = case["area"]
            event = self.ledger(area).judge(case_id, label, by)
            case.update(verdict=label, judged_by=by, judged_at=_now())
            if case["photo"]:   # the officer has seen it; keep no farmer photo after the verdict
                (self.dir / "photos" / case["photo"]).unlink(missing_ok=True)
                case["photo"] = None
            self._save_case(case)
            self._refit(area)
            if event and event["event"] == "opened":
                s = self.ledger(area).stats()
                self.store.area_trust_credential({
                    "area": area, "model": self.model, "policy_id": "photo-trust", "policy_version": self.policy.version,
                    "verdicts": s["verdicts"], "sure_in_window": s["sure_in_window"],
                    "sure_right_in_window": s["sure_right_in_window"], "precision": s["precision"],
                    "lower_bound": s["lower_bound"], "opened_at": event["at"]})
            elif event and event["event"] == "closed":
                cred = self.store.trusted_photo_model(self.model, area)
                if cred:
                    self.store.revoke(cred)
            return {"case": self.public(case), "event": event, "area": self.area(area)}

    def _refit(self, area: str) -> None:
        judged = [self.case(c) for c in self.ledger(area).verdicts]
        n = len(judged)
        if not (n <= REFIT_ALL_UNTIL or n % REFIT_EVERY == 0):
            return
        X = np.array([c["x"] for c in judged]); y = np.array([self.labels.index(c["verdict"]) for c in judged])
        st = self._model_state(area)
        D = probe.fit(X, y, self.T, self.lam, st["D"])
        temp = st["temp"]
        if n >= 20:   # calibrate on logits frozen before their verdicts (prequential), most recent first
            recent = judged[-TEMP_HISTORY:]
            temp = probe.fit_temperature(np.array([c["logits"] for c in recent]),
                                         np.array([self.labels.index(c["verdict"]) for c in recent]))
        self._save_model_state(area, D, temp)

    def area(self, area: str) -> dict:
        s = self.ledger(area).stats()
        return {**s, "trust_credential_id": self.store.trusted_photo_model(self.model, area)}

    def diagnosis_for(self, case_id: str, field: dict) -> dict:
        """The server's own reading for a case answered automatically, in the Diagnosis contract's shape."""
        case = self.case(case_id)
        if case["route"] != "auto" or case["area"] != trust_area(field):
            raise LedgerError("this photo case was not answered automatically here")
        top = case["suggestion"][0]
        name, version = self.model.split("@", 1)
        return {"diagnosis_id": case_id, "crop": case["crop"],
                "model": {"name": name, "version": version, "sha256": self.model_sha256},
                "on_device": False, "labels": case["suggestion"], "calibrated": True, "status": "ok", "inference_ms": 0,
                "created_at": case["created_at"]}

    @staticmethod
    def public(case: dict) -> dict:
        """What leaves the server: never the feature vector or the photo bytes."""
        return {k: case[k] for k in ("case_id", "area", "model", "field_id", "created_at", "route", "sure", "suggestion",
                                     "consent", "verdict")}
