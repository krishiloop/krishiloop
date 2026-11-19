"""AgriTriage-Lite on the server: the SAME ONNX file the farmer's phone runs, with the SAME gate, on the uploaded photo.

The student is the owner's TinyViT-11M (89 diseases, INT8 weights), distilled from a DINOv2 + CLIP + Perception Encoder
teacher (D:/poster_presentation_2026_ai_club). Research weights (trained on PlantWild, non-commercial): labelled
wherever they are used. The gate is a line-by-line port of poster/demo/index.html `gate()` (and of
apps/web/src/lib/agritriage/gate.ts, which tests/test_agritriage.py checks against the same logits):

* temperature-scaled softmax (the unknown-photo energy is computed on the raw logits);
* crop-known mode: the field's crop masks the other crops' classes, then renormalises;
* deterministic APS set at 90% coverage (q fitted on PlantWild's cal split; an area's own q once officers confirmed
  enough photos there: the poster's local recalibration);
* energy above its threshold -> refer (unknown); set of 1 -> diagnose; 2-3 -> shortlist; more -> refer.

The server never trusts a client's report: a phone's reading is stored only to measure agreement. What a receipt cites
is this module's own reading (model id, version, sha256, gate outcome, set, coverage target, labels) and the model's
signed ModelCredential, which can be recalled ("recall a model, not only a rule"). How the conformal gate and earned
area trust combine is photo-trust policy v2 (rules/policy/photo-trust.yaml, `agritriage:`); the class -> pack map is
rules/policy/agritriage-classes.yaml.

Explainability (20 Nov): the file is model_xai.onnx (tools/xai_export.py: the same weights and logits, plus outputs for
an exact class activation map and the stage-3 attention). Every reading also returns, from the SAME run, the CAM cells
and attention for its top class and a colour estimate of the leaf's spots (agritriage_xai.py); a case stores them as
`xai`. The occlusion map (`heat`) stays as the cross-check that needs extra runs.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import yaml

from services.engine.planner import trust_area
from services.engine.rules import evaluate, load_pack
from services.trust.vc import issue_credential, now_iso
from services.vision import agritriage_xai as xai_mod
from services.vision.ledger import AreaLedger, LedgerError, Policy, wilson_lower_bound

ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = ROOT / "apps" / "web" / "public" / "models" / "agritriage"   # one file for the phone and the server
CLASS_MAP_FILE = ROOT / "rules" / "policy" / "agritriage-classes.yaml"
POLICY_FILE = ROOT / "rules" / "policy" / "photo-trust.yaml"
NAME, VERSION = "agritriage-tinyvit", "1"
MODEL = f"{NAME}@{VERSION}"
WEIGHTS = "Research weights (trained on PlantWild, non-commercial)"
GRID = 7                     # occlusion map: 7 x 7 patches of 32 px on the 224 px input
FILL = 0.5                   # a masked patch is mid grey (inputs are RGB in [0, 1]; the model normalises inside)
BATCH = 7
XAI_FETCH = ["logits", "xai_cam", "xai_cam_bias", "xai_attn3_0", "xai_attn3_1"]   # one run: the answer and its views
ROUTES = ("receipt", "officer", "retake")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def wilson_upper_bound(k: int, n: int, z: float = 1.96) -> float:
    if n == 0:
        return 1.0
    p = k / n
    return (p + z * z / (2 * n) + z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n)


# ---------------------------------------------------------------- the gate (pure; ported from the demo)
def _seqsum(v) -> float:
    """Left-to-right sum, as the browser's reduce (numpy's pairwise sum can differ in the last bits)."""
    t = 0.0
    for x in v:
        t += float(x)
    return t


def gate(logits, cfg: dict, crop: str | None = None, q: float | None = None) -> dict:
    """The demo's gate, exactly. `crop` is the model's crop name (crop-known mode) or None (any crop)."""
    z = np.asarray(logits, dtype=np.float64).ravel()
    C, T = len(z), float(cfg["temperature"])
    if C != len(cfg["classes"]):
        raise ValueError("logits do not match the classes")
    m = z.max()
    energy = float(-(m + math.log(_seqsum(np.exp(z - m)))))              # unknown-photo score on the raw logits
    zt = z / T
    p = np.exp(zt - zt.max())
    if crop:
        if crop not in cfg["crops"]:
            raise ValueError(f"the model has no crop {crop!r}")
        p = np.where(np.array(cfg["crops"]) == crop, p, 0.0)
    p = p / _seqsum(p)
    order = sorted(range(C), key=lambda i: -p[i])                         # stable, like Array.prototype.sort
    if q is None:
        q = float(cfg["q_crop_known"] if crop else cfg["q_any_crop"])
    s, before = [], 0.0
    for i in order:
        if before <= q and p[i] > 0:
            s.append(i)
        before += p[i]
        if before > q:
            break
    if energy > cfg["energy_threshold"]:
        action, reason = "refer", "unknown"
    elif len(s) == 1:
        action, reason = "act", "single"
    elif len(s) <= cfg["shortlist_max"]:
        action, reason = "shortlist", "few"
    else:
        action, reason = "refer", "many"
    return {"p": p, "order": order, "set": s, "action": action, "reason": reason, "energy": energy, "q": q}


OUTCOME = {"act": "diagnose", "shortlist": "shortlist", "refer": "refer"}


def aps_score(p: np.ndarray, y: int) -> float:
    """Deterministic APS score of the true class: the probability mass ranked above it (y is in the set iff score <= q)."""
    order = sorted(range(len(p)), key=lambda i: -p[i])
    return float(sum(p[i] for i in order[:order.index(y)]))


def conformal_quantile(scores: list[float], alpha: float) -> float:
    """As in the pipeline (agritriage/triage/conformal.py): the ceil((n+1)(1-alpha))/n quantile, 'higher'."""
    n = len(scores)
    level = math.ceil((n + 1) * (1 - alpha)) / n
    if n == 0 or level > 1:
        return math.inf
    return float(np.quantile(np.asarray(scores), level, method="higher"))


# ---------------------------------------------------------------- the model
def preprocess(image: bytes, size: int = 224, resize: int = 256) -> np.ndarray:
    """Shorter side -> 256, centre crop 224, RGB in [0, 1], CHW (as in training and in the demo). Applies the camera's
    EXIF rotation, as the phone does (createImageBitmap 'from-image')."""
    from PIL import Image, ImageOps
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(image))).convert("RGB")
    k = resize / min(im.size)
    w, h = max(size, round(im.width * k)), max(size, round(im.height * k))
    im = im.resize((w, h), Image.Resampling.BILINEAR)
    left, top = (w - size) // 2, (h - size) // 2
    a = np.asarray(im.crop((left, top, left + size, top + size)), dtype=np.float32) / 255.0
    return np.ascontiguousarray(a.transpose(2, 0, 1)[None])


def occlusion_inputs(x: np.ndarray, grid: int = GRID, fill: float = FILL) -> np.ndarray:
    """grid*grid copies of x [1,3,S,S], each with one patch set to `fill` (row-major), as apps/web/src/lib/agritriage/occlusion.ts."""
    S = x.shape[-1]
    out = np.repeat(x, grid * grid, axis=0)
    for r in range(grid):
        for c in range(grid):
            y0, y1, x0, x1 = r * S // grid, (r + 1) * S // grid, c * S // grid, (c + 1) * S // grid
            out[r * grid + c, :, y0:y1, x0:x1] = fill
    return out


def occlusion_heat(base_p: float, masked_p: list[float]) -> list[float]:
    """How much hiding each patch lowers the chosen class's probability, scaled to [0, 1] (0 everywhere if none does)."""
    drop = [max(0.0, base_p - v) for v in masked_p]
    top = max(drop) if drop else 0.0
    return [round(d / top, 4) if top > 0 else 0.0 for d in drop]


class AgriTriageModel:
    """The ONNX student and its config, loaded once per process (onnxruntime on CPU)."""

    def __init__(self, model_dir: Path = MODEL_DIR):
        import onnxruntime as ort
        self.cfg = json.loads((model_dir / "config.json").read_text(encoding="utf-8"))
        self.path = model_dir / self.cfg["model"]          # model_xai.onnx: the classifier plus its XAI outputs
        raw = self.path.read_bytes()
        self.sha256 = hashlib.sha256(raw).hexdigest()
        self.config_sha256 = hashlib.sha256((model_dir / "config.json").read_bytes()).hexdigest()
        so = ort.SessionOptions()
        so.add_session_config_entry("session.disable_quant_qdq", "1")    # fold the INT8 weights to float once, as the demo
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(raw, so, providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0].name
        self.xai = all(n in {o.name for o in self.session.get_outputs()} for n in XAI_FETCH)
        self.classes, self.crops = list(self.cfg["classes"]), list(self.cfg["crops"])
        self._lock = threading.Lock()

    def logits(self, x: np.ndarray) -> np.ndarray:
        with self._lock:
            return self.session.run(["logits"], {self.input: x.astype(np.float32)})[0]

    def outputs(self, x: np.ndarray) -> dict:
        """One run: the logits and, with model_xai.onnx, the CAM cells, their bias and the stage-3 attention."""
        if not getattr(self, "xai", False):
            return {"logits": self.logits(x)}
        with self._lock:
            return dict(zip(XAI_FETCH, self.session.run(XAI_FETCH, {self.input: x.astype(np.float32)})))

    def read(self, image: bytes, crop: str | None, q: float | None = None) -> tuple[dict, np.ndarray]:
        """(the reading, the gate's full probability vector)."""
        reading, p, _ = self.read_explained(image, crop, q)
        return reading, p

    def read_explained(self, image: bytes, crop: str | None, q: float | None = None) -> tuple[dict, np.ndarray, dict | None]:
        """(the reading, the probability vector, the XAI views for the top class from the SAME run, or None)."""
        x = preprocess(image, self.cfg["input_size"], self.cfg["resize"])
        t0 = time.perf_counter()
        outs = self.outputs(x)
        z = outs["logits"][0]
        ms = (time.perf_counter() - t0) * 1000
        g = gate(z, self.cfg, crop, q)
        top = [i for i in g["order"] if g["p"][i] > 0][:5]
        reading = {"model": MODEL, "sha256": self.sha256, "mode": "crop_known" if crop else "any_crop", "crop": crop,
                   "outcome": OUTCOME[g["action"]], "reason": g["reason"], "set": [self.classes[i] for i in g["set"]],
                   "coverage_target": round(1 - float(self.cfg["alpha"]), 4), "q": round(float(g["q"]), 6),
                   "energy": round(g["energy"], 4), "energy_threshold": round(float(self.cfg["energy_threshold"]), 4),
                   "temperature": round(float(self.cfg["temperature"]), 6),
                   "labels": [{"label": self.classes[i], "prob": round(float(g["p"][i]), 4)} for i in top],
                   "inference_ms": round(ms, 1), "weights": WEIGHTS}
        xai = None
        if "xai_cam" in outs:
            t1 = time.perf_counter()
            xai = {**xai_mod.explain(outs, top[0], x), "target": self.classes[top[0]]}
            xai["ms"] = round((time.perf_counter() - t1) * 1000, 1)
        return reading, g["p"], xai

    def heat(self, image: bytes, crop: str | None, target: str) -> dict:
        """Occlusion sensitivity for one class: where hiding the leaf lowers that class's probability most."""
        x = preprocess(image, self.cfg["input_size"], self.cfg["resize"])
        ci = self.classes.index(target)
        t0 = time.perf_counter()
        base = gate(self.logits(x)[0], self.cfg, crop)["p"][ci]
        xs, masked = occlusion_inputs(x), []
        for i in range(0, len(xs), BATCH):
            for z in self.logits(xs[i:i + BATCH]):
                masked.append(float(gate(z, self.cfg, crop)["p"][ci]))
        return {"method": "occlusion", "grid": GRID, "target": target, "heat": occlusion_heat(float(base), masked),
                "ms": round((time.perf_counter() - t0) * 1000, 1)}


_model: AgriTriageModel | None = None
_model_lock = threading.Lock()


def load_model() -> AgriTriageModel:
    global _model
    with _model_lock:
        if _model is None:
            _model = AgriTriageModel()
        return _model


# ---------------------------------------------------------------- policy and class map (data under rules/policy/)
def class_map(path: Path = CLASS_MAP_FILE) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def triage_policy(path: Path = POLICY_FILE) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))["agritriage"]


# ---------------------------------------------------------------- the model credential (recall a model, not only a rule)
def model_credential(store, model: AgriTriageModel) -> dict:
    """The model's signed ModelCredential in this store (one per model file), with a status entry so it can be recalled."""
    key = f"{MODEL}#{model.sha256[:16]}"
    with store._lock:
        if MODEL in store.state.setdefault("model_recalls", {}):
            raise LedgerError(f"model {MODEL} was recalled")
        index = store.state.setdefault("model_index", {})
        if key in index:
            return store.get(index[key])
        c = model.cfg
        cred = issue_credential("ModelCredential", {
            "model": MODEL, "name": NAME, "version": VERSION, "sha256": model.sha256, "config_sha256": model.config_sha256,
            "arch": c["arch"], "classes": len(c["classes"]), "precision": "int8 weights, float compute",
            "weights": WEIGHTS, "training_data": "PlantWild (CC BY-NC-ND 4.0, research only)",
            "gate": {"temperature": c["temperature"], "energy_threshold": c["energy_threshold"], "q_any_crop": c["q_any_crop"],
                     "q_crop_known": c["q_crop_known"], "alpha": c["alpha"], "shortlist_max": c["shortlist_max"],
                     "method": "deterministic APS"},
            "test": {"set": "PlantWild test, 3,663 photos", "int8_top1": c["onnx_test_accuracy"]["int8"]},
            "source": "D:/poster_presentation_2026_ai_club/poster/demo (AgriTriage-Lite)",
        }, store.issuer, store.status)
        index[key] = cred["id"]
        return store.put(cred)


def recall_model(store, reason: str = "", actor: str = "admin") -> list[str]:
    """Withdraw the model: its credential is revoked, so every receipt that cited one of its readings verifies as
    recalled, and no new receipt can cite it."""
    with store._lock:
        store.state.setdefault("model_recalls", {}).setdefault(MODEL, {"at": now_iso(), "reason": reason, "actor": actor})
        hits = [cid for key, cid in store.state.get("model_index", {}).items() if key.startswith(f"{MODEL}#")]
        for cid in hits:
            idx = int(store.get(cid)["credentialStatus"]["statusListIndex"])
            store.status.revoke(idx)
            if idx not in store.state["revoked"]:
                store.state["revoked"].append(idx)
        store._save_state()
    return hits


def model_recalled(store) -> bool:
    return MODEL in store.state.get("model_recalls", {})


# ---------------------------------------------------------------- the area ledger for conformal readings
class ConformalLedger(AreaLedger):
    """The v1 area ledger (precision gate, Wilson lower bound) where "sure" means the gate's diagnose, plus the coverage
    check: was the officer's answer inside the server's set? Both are prequential: frozen before the verdict."""

    def suggest_reading(self, case_id: str, top: str, prob: float, diagnose: bool, in_set: list[str], route: str) -> None:
        with self._lock:
            if case_id in self.cases:
                raise LedgerError("case already has a suggestion")
            self.cases[case_id] = {"suggested": top, "prob": round(float(prob), 4), "sure": bool(diagnose), "route": route,
                                   "audit": False, "set": list(in_set), "suggested_at": _now(), "verdict": None,
                                   "correct": None, "covered": None}
            self._save()

    def judge(self, case_id: str, label: str, by: str) -> dict | None:
        with self._lock:
            case = self.cases.get(case_id)
            if case is not None and case["verdict"] is None:
                case["covered"] = label in case.get("set", [])
            return super().judge(case_id, label, by)

    def coverage(self, window: int) -> dict:
        with self._lock:
            cov = [self.cases[c]["covered"] for c in self.verdicts if self.cases[c].get("covered") is not None][-window:]
            k, n = sum(cov), len(cov)
            return {"checks": n, "covered": k, "rate": round(k / n, 4) if n else None,
                    "upper_bound": round(wilson_upper_bound(k, n), 4), "lower_bound": round(wilson_lower_bound(k, n), 4)}


# ---------------------------------------------------------------- the service (one per demo sandbox)
def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", s)


class AgriTriageService:
    def __init__(self, store, data_dir: Path, model: AgriTriageModel | None = None, policy: Policy | None = None):
        self.store, self.dir = store, data_dir
        self.model = model or load_model()
        self.policy = policy or Policy.load()
        self.tp = triage_policy()
        self.map = class_map()
        self._lock = threading.RLock()
        self._ledgers: dict[str, ConformalLedger] = {}

    # ------------------------------------------------------------ storage
    def _area_dir(self, area: str) -> Path:
        return self.dir / "areas" / f"{_slug(area)}__{_slug(MODEL)}"

    def ledger(self, area: str) -> ConformalLedger:
        with self._lock:
            if area not in self._ledgers:
                self._ledgers[area] = ConformalLedger(area, MODEL, self.policy, self._area_dir(area) / "ledger.json")
            return self._ledgers[area]

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

    def _area_q(self, area: str) -> tuple[float | None, str]:
        """The area's own conformal threshold once officers confirmed enough crop-known photos here (local recalibration)."""
        p = self._area_dir(area) / "recal.json"
        if p.exists():
            d = json.loads(p.read_text(encoding="utf-8"))
            return float(d["q"]), "area_recalibrated"
        return None, "plantwild_cal"

    def _recalibrate(self, area: str) -> None:
        need = int(self.tp["recalibrate_min_checks"])
        judged = [self.case(c) for c in self.ledger(area).verdicts]
        rows = [c for c in judged if c["reading"]["mode"] == "crop_known" and c.get("p_crop")]
        if len(rows) < need:
            return
        scores = []
        for c in rows:
            p = np.asarray(c["p_crop"], dtype=np.float64)
            scores.append(aps_score(p, self.model.classes.index(c["verdict"])))
        q = conformal_quantile(scores, float(self.model.cfg["alpha"]))
        if math.isfinite(q):
            d = self._area_dir(area); d.mkdir(parents=True, exist_ok=True)
            (d / "recal.json").write_text(json.dumps({"q": q, "checks": len(rows), "at": _now(),
                                                      "plantwild_q": self.model.cfg["q_crop_known"]}), encoding="utf-8")

    # ------------------------------------------------------------ the decision
    def model_crop(self, field: dict) -> str | None:
        return (self.map.get("crops") or {}).get(field["crop"])

    def _audit(self, area: str, case_id: str) -> bool:
        draw = int(hashlib.sha256(f"audit:{area}:{case_id}".encode()).hexdigest()[:8], 16) / 0x100000000
        return draw < float(self.tp["audit_rate"])

    def decide(self, field: dict, reading: dict, area: str, case_id: str) -> tuple[str, str, dict | None]:
        """(route, reason, mapping). Policy v2: a receipt needs ALL of these; anything else goes to a person."""
        if reading["outcome"] == "shortlist":
            return "retake", "shortlist", None
        if reading["outcome"] == "refer":
            return "officer", "unknown" if reading["reason"] == "unknown" else "too_many", None
        label = reading["set"][0]
        entry = (self.map.get("classes") or {}).get(label)
        if reading["mode"] != "crop_known":
            return "officer", "crop_unknown", entry
        if not entry or entry.get("pack_id") != field["pack_id"]:
            return "officer", "no_pack", entry
        rules = {r["rule_id"]: r for r in load_pack(field["pack_id"])}
        facts = {"stage": field["stage"], "diagnosis_label": entry["diagnosis_label"]}
        firing = [rid for rid in entry.get("rules") or []
                  if rid in rules and evaluate(rules[rid], facts)[0] and not self.store.is_recalled(rid, rules[rid]["version"])]
        if not firing:
            return "officer", "no_rule", entry
        if model_recalled(self.store):
            return "officer", "model_recalled", entry
        cov = self.ledger(area).coverage(int(self.policy.window))
        if cov["checks"] >= int(self.tp["coverage_min_checks"]) and cov["upper_bound"] < float(self.tp["coverage_target"]):
            return "officer", "coverage_failed", entry
        earned = self.store.trusted_photo_model(MODEL, area)
        if not (entry.get("conformal_enough") or earned):
            return "officer", "needs_area_trust", entry
        if self._audit(area, case_id):
            return "officer", "audit", entry
        return "receipt", "ok", {**entry, "firing": firing}

    # ------------------------------------------------------------ flow
    def submit(self, field: dict, image: bytes, consent: bool, any_crop: bool = False, client: dict | None = None) -> dict:
        area = trust_area(field)
        crop = None if any_crop else self.model_crop(field)
        if not any_crop and crop is None:
            raise LedgerError(f"the photo model has no crop for {field['crop']}")
        q, q_source = self._area_q(area) if crop else (None, "plantwild_cal")
        reading, p, xai = self.model.read_explained(image, crop, q)
        reading["q_source"] = q_source
        case_id = f"pc-{uuid.uuid4().hex[:16]}"
        with self._lock:
            route, reason, entry = self.decide(field, reading, area, case_id)
            top = reading["labels"][0]
            self.ledger(area).suggest_reading(case_id, top["label"], top["prob"], reading["outcome"] == "diagnose",
                                              reading["set"], route)
            case = {"case_id": case_id, "area": area, "model": MODEL, "field_id": field["field_id"], "crop": field["crop"],
                    "stage": field["stage"], "pack_id": field["pack_id"], "created_at": _now(), "route": route,
                    "reason": reason, "reading": reading, "mapping": entry, "consent": bool(consent), "photo": None,
                    "verdict": None, "heat": None, "xai": xai, "agreement": self._agreement(reading, client),
                    "p_crop": [round(float(v), 6) for v in p] if crop else None}
            if consent and route != "receipt":   # the officer may need it; a receipted photo is never kept
                photo = self.dir / "photos" / f"{case_id}.jpg"; photo.parent.mkdir(parents=True, exist_ok=True)
                photo.write_bytes(image)
                case["photo"] = photo.name
            self._save_case(case)
        return self.public(case)

    @staticmethod
    def _agreement(reading: dict, client: dict | None) -> dict | None:
        """The phone's own reading, kept only to measure agreement with the server's; it never decides anything."""
        if not client:
            return None
        cset = [str(s) for s in (client.get("set") or [])][:10]
        ctop = str((client.get("top") or [{}])[0].get("label", "")) if client.get("top") else ""
        return {"client_outcome": str(client.get("outcome", ""))[:20], "client_set": cset, "client_top": ctop[:80],
                "client_ms": client.get("ms") if isinstance(client.get("ms"), (int, float)) else None,
                "same_outcome": client.get("outcome") == reading["outcome"], "same_set": cset == reading["set"],
                "same_top": ctop == reading["labels"][0]["label"]}

    def escalate(self, case_id: str) -> dict:
        """The farmer asks for a person (after a shortlist): the case joins the officer's queue."""
        with self._lock:
            case = self.case(case_id)
            if case["route"] == "receipt":
                raise LedgerError("this photo already has a receipt")
            case.update(route="officer", reason=case["reason"] if case["route"] == "officer" else "farmer_asked")
            self._save_case(case)
            return self.public(case)

    def judge(self, case_id: str, label: str, by: str) -> dict:
        if label not in self.model.classes:
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
            n = len(self.ledger(area).verdicts)
            need = int(self.tp["recalibrate_min_checks"])
            if n >= need and (n == need or n % int(self.tp["recalibrate_every"]) == 0):
                self._recalibrate(area)
            if event and event["event"] == "opened":
                s = self.ledger(area).stats()
                self.store.area_trust_credential({
                    "area": area, "model": MODEL, "policy_id": "photo-trust", "policy_version": self.policy.version,
                    "verdicts": s["verdicts"], "sure_in_window": s["sure_in_window"],
                    "sure_right_in_window": s["sure_right_in_window"], "precision": s["precision"],
                    "lower_bound": s["lower_bound"], "opened_at": event["at"]})
            elif event and event["event"] == "closed":
                cred = self.store.trusted_photo_model(MODEL, area)
                if cred:
                    self.store.revoke(cred)
            return {"case": self.public(case), "event": event, "area": self.area(area)}

    def photo(self, case_id: str) -> bytes:
        case = self.case(case_id)
        if not case["photo"]:
            raise LedgerError("no photo kept for this case")
        return (self.dir / "photos" / case["photo"]).read_bytes()

    def heat(self, case_id: str) -> dict:
        """The server's occlusion map on the kept photo (only with consent, only until the verdict); computed once."""
        with self._lock:
            case = self.case(case_id)
            if case.get("heat"):
                return case["heat"]
            image = self.photo(case_id)
            crop = case["reading"]["crop"]
            h = self.model.heat(image, crop, case["reading"]["labels"][0]["label"])
            case["heat"] = h
            self._save_case(case)
            return h

    def list_cases(self, limit: int = 100) -> list[dict]:
        d = self.dir / "cases"
        cases = [json.loads(p.read_text(encoding="utf-8")) for p in d.glob("pc-*.json")] if d.exists() else []
        return [self.public(c) for c in sorted(cases, key=lambda c: c["created_at"], reverse=True)[:limit]]

    def area(self, area: str) -> dict:
        s = self.ledger(area).stats()
        q, src = self._area_q(area)
        return {**s, "trust_credential_id": self.store.trusted_photo_model(MODEL, area),
                "coverage": {**self.ledger(area).coverage(int(self.policy.window)), "target": self.tp["coverage_target"],
                             "min_checks": self.tp["coverage_min_checks"]},
                "q": q if q is not None else self.model.cfg["q_crop_known"], "q_source": src}

    def model_info(self) -> dict:
        recalled = model_recalled(self.store)
        cred = None if recalled else model_credential(self.store, self.model)["id"]
        if recalled:
            ids = [cid for key, cid in self.store.state.get("model_index", {}).items() if key.startswith(f"{MODEL}#")]
            cred = ids[0] if ids else None
        return {"model": MODEL, "sha256": self.model.sha256, "credential_id": cred, "recalled": recalled, "weights": WEIGHTS,
                "classes": len(self.model.classes), "int8_top1": self.model.cfg["onnx_test_accuracy"]["int8"]}

    def diagnosis_for(self, case_id: str, field: dict) -> dict:
        """The server's own reading for a case the policy allowed a receipt for, in the Diagnosis shape the planner reads.
        The pack's own label (agritriage-classes.yaml) is what its rules test; the model's class stays in photo_reading."""
        case = self.case(case_id)
        if case["route"] != "receipt" or case["area"] != trust_area(field) or case["field_id"] != field["field_id"]:
            raise LedgerError("this photo case may not inform a plan here")
        cred = model_credential(self.store, self.model)
        r = case["reading"]
        if cred["credentialSubject"]["sha256"] != r["sha256"]:
            raise LedgerError("the model changed since this reading")
        reading = {"case_id": case_id,
                   "model_ref": {"credential_id": cred["id"], "model": MODEL, "sha256": r["sha256"]},
                   "mode": r["mode"], "crop": r["crop"], "outcome": r["outcome"], "set": r["set"],
                   "coverage_target": r["coverage_target"], "q": r["q"], "q_source": r["q_source"], "energy": r["energy"],
                   "energy_threshold": r["energy_threshold"], "temperature": r["temperature"],
                   "labels": r["labels"][:3], "class_map": "agritriage-classes@" + str(self.map.get("version")),
                   "weights": WEIGHTS}
        pack_label = case["mapping"]["diagnosis_label"]
        return {"diagnosis_id": case_id, "crop": case["crop"], "model": {"name": NAME, "version": VERSION, "sha256": r["sha256"]},
                "on_device": False, "labels": [{"label": pack_label, "prob": r["labels"][0]["prob"]}], "calibrated": True,
                "status": "ok", "inference_ms": r["inference_ms"], "created_at": case["created_at"],
                "gate_basis": "conformal", "photo_reading": reading}

    @staticmethod
    def public(case: dict) -> dict:
        """What leaves the server: never the photo bytes or the full probability vector."""
        out = {k: case.get(k) for k in ("case_id", "area", "model", "field_id", "crop", "stage", "created_at", "route", "reason",
                                         "reading", "mapping", "consent", "verdict", "agreement", "heat", "xai")}
        return {**out, "photo_available": bool(case.get("photo"))}
