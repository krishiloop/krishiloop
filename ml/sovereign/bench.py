"""Sovereign-mode benchmark: the same script on the RTX 5090 lab PC (GPU) and on the laptop (CPU baseline).

Subcommands (run from the repo root):
  images  Prepare a photo set as the farmer app sends it (apps/web/src/features/farmer/photo/downscale.ts: at most
          1024 px on the long side, JPEG quality 0.85, white behind transparency).
            python ml/sovereign/bench.py images --src <folder of photos> --dst <folder> [--max 40] [--exclude a,b]
  api     HTTP benchmark of a running API (ml/sovereign/serve.py), the client on the same machine:
          - latency, one request at a time: plan (fresh store and warm store), verify, recall, ask, photo;
          - throughput at several concurrency levels (photo, ask, plan, verify);
          - a mixed "farmer-week" workload (session, plan, 2 questions, 1 photo, 1 receipt check per farmer);
          - GPU power (nvidia-smi, 200 ms) through every phase, with an idle baseline, when --gpu is given.
            python ml/sovereign/bench.py api --base http://127.0.0.1:8100 --label <name> --images <folder> --out <json> [--gpu]
  model   The photo model alone, in this process: features parity between two execution providers (--parity),
          batched throughput (photos/s) per batch size, and the full pipeline (JPEG decode + resize + batched model).
            python ml/sovereign/bench.py model --model-dir <KRISHILENS_DIR> --providers CUDAExecutionProvider,CPUExecutionProvider
                                               --images <folder> --out <json> [--parity] [--batches 1,8,16,32,64] [--gpu]

Every simulated farmer gets its own client address (X-Forwarded-For, trusted only from 127.0.0.1), so the API's
per-client limit of 20 requests a minute applies per farmer, as in the field. Questions come from
ml/ask/questions.seed.jsonl (SYNTHETIC, written by the team's coding agent). Photos are public dataset samples, used only
as timing inputs; their content does not change the work the server does.
"""
from __future__ import annotations

import argparse
import base64
import http.client
import io
import json
import os
import platform
import statistics
import subprocess
import sys
import threading
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMBOS = [("KE-SAMPLE-01", "demo-farmer-a"), ("BD-SAMPLE-01", "demo-farmer-c"), ("BD-SAMPLE-02", "demo-farmer-d"),
          ("KE-SAMPLE-01", "demo-farmer-b"), ("BD-SAMPLE-01", "demo-farmer-d"), ("BD-SAMPLE-02", "demo-farmer-c")]
PHOTO_FIELD = "BD-SAMPLE-01"


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def pct(values, q):
    v = sorted(values)
    if not v:
        return None
    k = (len(v) - 1) * q / 100
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def lat_stats(seconds: list[float]) -> dict:
    ms = [s * 1000 for s in seconds]
    if not ms:
        return {"n": 0}
    return {"n": len(ms), "p50_ms": round(pct(ms, 50), 1), "p95_ms": round(pct(ms, 95), 1), "mean_ms": round(statistics.mean(ms), 1),
            "min_ms": round(min(ms), 1), "max_ms": round(max(ms), 1)}


# ------------------------------------------------------------------ machine facts
def machine() -> dict:
    info = {"hostname": platform.node(), "os": platform.platform(), "python": sys.version.split()[0],
            "logical_cpus": os.cpu_count()}
    if sys.platform == "win32":
        try:
            import winreg
            k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            info["cpu"] = winreg.QueryValueEx(k, "ProcessorNameString")[0].strip()
        except OSError:
            info["cpu"] = platform.processor()
        try:
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong),
                            ("ullAvailPhys", ctypes.c_ulonglong), ("ullTotalPageFile", ctypes.c_ulonglong),
                            ("ullAvailPageFile", ctypes.c_ulonglong), ("ullTotalVirtual", ctypes.c_ulonglong),
                            ("ullAvailVirtual", ctypes.c_ulonglong), ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]
            m = MS(); m.dwLength = ctypes.sizeof(MS)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            info["ram_gb"] = round(m.ullTotalPhys / 2**30, 1)
            info["ram_load_pct_at_start"] = m.dwMemoryLoad
        except Exception:
            pass
    else:
        info["cpu"] = platform.processor()
    for mod in ("onnxruntime", "numpy", "PIL"):
        try:
            info[f"{mod}_version"] = __import__(mod).__version__
        except Exception:
            pass
    info["gpu"] = gpu_facts()
    return info


def gpu_facts() -> dict | None:
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version,memory.total,power.limit",
                              "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=20).stdout.strip()
        name, driver, mem, plimit = [x.strip() for x in out.splitlines()[0].split(",")]
        return {"name": name, "driver": driver, "memory_total_mib": float(mem), "power_limit_w": float(plimit)}
    except Exception:
        return None


def gpu_apps() -> list[str]:
    """Processes holding a CUDA context (other users of a shared GPU show up here)."""
    try:
        out = subprocess.run(["nvidia-smi", "--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader"],
                             capture_output=True, text=True, timeout=20).stdout
        return [ln.strip() for ln in out.splitlines() if ln.strip()]
    except Exception:
        return []


class GpuSampler:
    """nvidia-smi --query-gpu=power.draw,utilization.gpu,memory.used --format=csv -lms 200, read in a thread.

    Each sample carries nvidia-smi's own timestamp (pipe buffering cannot shift it), mapped onto perf_counter."""

    def __init__(self, enabled: bool, interval_ms: int = 200):
        self.samples: list[tuple[float, float, float, float]] = []    # (perf_counter time, W, util %, MiB)
        self.proc = None
        self.offset = time.time() - time.perf_counter()
        if not enabled:
            return
        self.proc = subprocess.Popen(["nvidia-smi", "--query-gpu=timestamp,power.draw,utilization.gpu,memory.used",
                                      "--format=csv,noheader,nounits", "-lms", str(interval_ms)],
                                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        threading.Thread(target=self._read, daemon=True).start()
        time.sleep(1.5)

    def _read(self):
        for line in self.proc.stdout:
            try:
                ts, w, u, m = [x.strip() for x in line.strip().split(",")[:4]]
                t = datetime.strptime(ts, "%Y/%m/%d %H:%M:%S.%f").timestamp() - self.offset
                self.samples.append((t, float(w), float(u), float(m)))
            except ValueError:
                continue

    def stats(self, t0: float, t1: float) -> dict | None:
        if self.proc is None:
            return None
        s = [x for x in self.samples if t0 <= x[0] <= t1]
        if len(s) < 2:
            return {"samples": len(s)}
        energy = sum((b[0] - a[0]) * (a[1] + b[1]) / 2 for a, b in zip(s, s[1:]))      # joules, trapezoid
        span = s[-1][0] - s[0][0]
        return {"samples": len(s), "seconds": round(span, 2), "power_mean_w": round(energy / span, 1),
                "power_max_w": round(max(x[1] for x in s), 1), "util_mean_pct": round(statistics.mean(x[2] for x in s), 1),
                "util_max_pct": round(max(x[2] for x in s), 1), "mem_max_mib": round(max(x[3] for x in s)),
                "energy_j": round(energy, 1)}

    def stop(self):
        if self.proc is not None:
            self.proc.terminate()


def energy_per(g: dict | None, idle_w: float | None, seconds: float, count: int) -> dict | None:
    """GPU energy per item over a phase: gross (all board power) and net of the idle baseline."""
    if not g or "power_mean_w" not in g or count <= 0:
        return None
    gross_j = g["power_mean_w"] * seconds
    out = {"gross_wh_per_item": round(gross_j / count / 3600, 6), "gross_j_per_item": round(gross_j / count, 3)}
    if idle_w is not None:
        net_j = max(0.0, g["power_mean_w"] - idle_w) * seconds
        out.update(net_wh_per_item=round(net_j / count / 3600, 6), net_j_per_item=round(net_j / count, 3))
    return out


# ------------------------------------------------------------------ images
def cmd_images(a) -> None:
    from PIL import Image, ImageOps
    src, dst = Path(a.src), Path(a.dst)
    dst.mkdir(parents=True, exist_ok=True)
    exclude = [e for e in (a.exclude or "").split(",") if e]
    files = sorted(p for p in src.rglob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png")
                   and not any(e in str(p.relative_to(src)) for e in exclude) and p.stat().st_size > 20_000)
    prefer = [e for e in (a.prefer or "").split(",") if e]
    files.sort(key=lambda p: (not any(s in str(p.relative_to(src)) for s in prefer), str(p)))
    manifest = []
    for p in files[:a.max]:
        with Image.open(p) as im:
            im = ImageOps.exif_transpose(im)
            if im.mode in ("RGBA", "LA", "P"):
                im = im.convert("RGBA")
                bg = Image.new("RGB", im.size, (255, 255, 255))
                bg.paste(im, mask=im.split()[-1])
                im = bg
            im = im.convert("RGB")
            w, h = im.size
            s = min(1.0, 1024 / max(w, h))
            if s < 1:
                im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.BICUBIC)
            out = dst / f"{len(manifest):03d}.jpg"
            im.save(out, "JPEG", quality=85)
        manifest.append({"file": out.name, "source": str(p.relative_to(src)).replace("\\", "/"), "source_size": [w, h],
                         "sent_size": list(im.size), "bytes": out.stat().st_size})
    (dst / "manifest.json").write_text(json.dumps({"made": now(), "rule": "fit 1024 px, JPEG q85 (as the farmer app)",
                                                   "images": manifest}, indent=1), encoding="utf-8")
    print(f"{len(manifest)} images -> {dst}")


def load_images(folder: str) -> list[bytes]:
    files = sorted(Path(folder).glob("*.jpg"))
    if not files:
        raise SystemExit(f"no .jpg in {folder} (run the images subcommand first)")
    return [f.read_bytes() for f in files]


# ------------------------------------------------------------------ API client
class Api:
    def __init__(self, base: str):
        u = urllib.parse.urlparse(base)
        self.host, self.port = u.hostname, u.port or 80
        self.conn = None

    def call(self, method: str, path: str, body=None, ip: str | None = None):
        headers = {"Content-Type": "application/json"}
        if ip:
            headers["X-Forwarded-For"] = ip
        data = json.dumps(body).encode() if body is not None else None
        for attempt in range(2):
            try:
                if self.conn is None:
                    self.conn = http.client.HTTPConnection(self.host, self.port, timeout=600)
                t0 = time.perf_counter()
                self.conn.request(method, path, body=data, headers=headers)
                r = self.conn.getresponse()
                raw = r.read()
                dt = time.perf_counter() - t0
                try:
                    payload = json.loads(raw) if raw else None
                except ValueError:
                    payload = None
                return r.status, payload, dt
            except (http.client.HTTPException, OSError):
                self.conn = None
                if attempt:
                    raise


_farmer = [0]
_farmer_lock = threading.Lock()


def farmer_ip() -> str:
    with _farmer_lock:
        _farmer[0] += 1
        k = _farmer[0]
    return f"10.{(k >> 16) & 255}.{(k >> 8) & 255}.{k & 255}"


def receipts_of(plan: dict) -> list[str]:
    return [a["receipt_credential_id"] for a in (plan or {}).get("actions", []) if a.get("receipt_credential_id")]


def rules_of(plan: dict) -> list[tuple[str, int]]:
    out = []
    for a in (plan or {}).get("actions", []):
        for ref in a.get("receipt", {}).get("rule_refs", []):
            out.append((ref["rule_id"], ref["version"]))
    return out


def load_questions() -> list[dict]:
    qs = [json.loads(line) for line in (ROOT / "ml" / "ask" / "questions.seed.jsonl").read_text(encoding="utf-8").splitlines()
          if line.strip()]
    for q in qs:
        ctx = q.get("context", {})
        if ctx.get("pack_id") == "pack-potato-late-blight":
            q["_field"], q["_profile"] = "KE-SAMPLE-01", "demo-farmer-a"
        else:
            q["_field"] = "BD-SAMPLE-02" if ctx.get("stage") == "tillering" else "BD-SAMPLE-01"
            q["_profile"] = "demo-farmer-c"
    return qs


class Workload:
    """The five operations, each as one HTTP call from a fresh simulated farmer."""

    def __init__(self, base: str, images: list[bytes]):
        self.base, self.questions = base, load_questions()
        self.images_b64 = [base64.b64encode(b).decode() for b in images]
        self._q = self._i = 0
        self._lock = threading.Lock()

    def session(self, api: Api) -> str:
        st, body, _ = api.call("POST", "/api/demo/session", {}, ip=farmer_ip())
        if st != 200:
            raise RuntimeError(f"session: {st} {body}")
        return body["session_id"]

    def next_question(self) -> dict:
        with self._lock:
            q = self.questions[self._q % len(self.questions)]; self._q += 1
        return q

    def next_image(self) -> str:
        with self._lock:
            b = self.images_b64[self._i % len(self.images_b64)]; self._i += 1
        return b

    def plan(self, api, sid, combo, ip=None):
        return api.call("POST", f"/api/demo/{sid}/plan", {"field_id": combo[0], "profile_id": combo[1]}, ip=ip or farmer_ip())

    def verify(self, api, cred, ip=None):
        return api.call("GET", f"/api/verify/{cred}", ip=ip or farmer_ip())

    def recall(self, api, sid, rule, ip=None):
        return api.call("POST", f"/api/demo/{sid}/recall", {"rule_id": rule[0], "version": rule[1], "reason": "benchmark"},
                        ip=ip or farmer_ip())

    def ask(self, api, sid, q, ip=None):
        return api.call("POST", f"/api/demo/{sid}/ask", {"field_id": q["_field"], "profile_id": q["_profile"],
                                                         "question": q["question"], "lang": q.get("lang", "en")}, ip=ip or farmer_ip())

    def photo(self, api, sid, image_b64, ip=None):
        return api.call("POST", f"/api/demo/{sid}/photo", {"field_id": PHOTO_FIELD, "image_b64": image_b64, "consent": False},
                        ip=ip or farmer_ip())


def check(status, body, what):
    if status != 200:
        raise RuntimeError(f"{what}: HTTP {status}: {str(body)[:300]}")


def phase(gpu: GpuSampler, fn):
    t0 = time.perf_counter()
    out = fn()
    t1 = time.perf_counter()
    return out, t0, t1, gpu.stats(t0, t1)


def cmd_api(a) -> None:
    images = load_images(a.images)
    wl, api = Workload(a.base, images), Api(a.base)
    gpu = GpuSampler(a.gpu)
    res = {"label": a.label, "started": now(), "base": a.base, "machine": machine(), "gpu_apps_at_start": gpu_apps() if a.gpu else None,
           "settings": {"n": a.n, "concurrency": a.concurrency, "tp_seconds": a.tp_seconds, "mix_seconds": a.mix_seconds,
                        "mix_concurrency": a.mix_concurrency, "images": len(images), "questions": len(wl.questions),
                        "questions_note": "ml/ask/questions.seed.jsonl: SYNTHETIC questions written by the team's coding agent"}}
    st, health, _ = api.call("GET", "/health"); check(st, health, "health")
    st, ask_health, _ = api.call("GET", "/api/ask/health")
    res["server"] = {"health": health, "ask_health": ask_health}
    print(f"[{a.label}] server {health}", flush=True)

    # warm-up: the photo session (and CUDA), the Ask index, the planner's caches
    sid = wl.session(api)
    for _ in range(3):
        check(*wl.photo(api, sid, wl.next_image())[:2], "photo warm-up")
        check(*wl.ask(api, sid, wl.next_question())[:2], "ask warm-up")
    for c in COMBOS[:3]:
        check(*wl.plan(api, wl.session(api), c)[:2], "plan warm-up")
    wl._q = wl._i = 0

    # idle baseline (GPU board power with this API loaded and nothing to do)
    if a.gpu:
        time.sleep(1)
        t0 = time.perf_counter(); time.sleep(a.idle_seconds); t1 = time.perf_counter()
        res["gpu_idle"] = gpu.stats(t0, t1)
        print(f"[{a.label}] GPU idle {res['gpu_idle']}", flush=True)
    idle_w = (res.get("gpu_idle") or {}).get("power_mean_w")

    # ---------------- latency: one request at a time
    lat = {}
    plans, sessions = [], []

    def run_plans():
        cold, warm, statuses = [], [], {}
        for i in range(a.n):
            sid = wl.session(api)
            st, body, dt = wl.plan(api, sid, COMBOS[i % len(COMBOS)]); check(st, body, "plan")
            cold.append(dt); statuses[body.get("status")] = statuses.get(body.get("status"), 0) + 1
            plans.append(body); sessions.append(sid)
            st, body2, dt2 = wl.plan(api, sid, COMBOS[(i + 1) % len(COMBOS)]); check(st, body2, "plan (warm)")
            warm.append(dt2); statuses[body2.get("status")] = statuses.get(body2.get("status"), 0) + 1
            plans.append(body2); sessions.append(sid)
        return cold, warm, statuses
    (cold, warm, statuses), t0, t1, g = phase(gpu, run_plans)
    lat["plan_fresh_store"] = {**lat_stats(cold), "note": "first plan in a new store: also issues the rule credentials"}
    lat["plan_warm_store"] = {**lat_stats(warm), "note": "rule credentials already issued in this store (production-like)"}
    lat["plan_statuses"] = statuses
    print(f"[{a.label}] plan fresh {lat['plan_fresh_store']} warm {lat['plan_warm_store']} {statuses}", flush=True)

    receipts = [r for p in plans for r in receipts_of(p)]
    if not receipts:
        raise RuntimeError("no receipts: every plan abstained (stale snapshot?)")

    def run_verify():
        out, bad = [], 0
        for i in range(a.n):
            st, body, dt = wl.verify(api, receipts[i % len(receipts)]); check(st, body, "verify")
            out.append(dt); bad += body.get("status") != "authentic"
        return out, bad
    (ver, bad), t0, t1, g = phase(gpu, run_verify)
    lat["verify"] = {**lat_stats(ver), "not_authentic": bad,
                     "note": "demo-session receipts: the API looks the credential up across the demo stores"}
    print(f"[{a.label}] verify {lat['verify']}", flush=True)

    official = []

    def run_verify_official():
        for c in COMBOS:     # the official store (production path): one plan per field/profile pair, then verify
            st, body, _ = api.call("POST", "/api/plan", {"field_id": c[0], "profile_id": c[1]}, ip=farmer_ip())
            check(st, body, "official plan")
            official.extend(receipts_of(body))
        out, bad = [], 0
        for i in range(a.n):
            st, body, dt = wl.verify(api, official[i % len(official)]); check(st, body, "verify (official)")
            out.append(dt); bad += body.get("status") != "authentic"
        return out, bad
    (vo, bad), t0, t1, g = phase(gpu, run_verify_official)
    lat["verify_official"] = {**lat_stats(vo), "not_authentic": bad, "receipts": len(official),
                              "note": "receipts from the official store (/api/plan): the production lookup path"}
    print(f"[{a.label}] verify official {lat['verify_official']}", flush=True)

    def run_recall():
        out, checks = [], []
        pairs = [(sid, p) for sid, p in zip(sessions[::2], plans[::2]) if rules_of(p)]
        for i in range(min(a.n, len(pairs))):
            sid, p = pairs[i]
            st, body, dt = wl.recall(api, sid, rules_of(p)[0]); check(st, body, "recall")
            out.append(dt)
            if i < 5:   # the recalled receipt must now verify as "recalled"
                checks.append(wl.verify(api, receipts_of(p)[0])[1].get("status"))
        return out, checks
    (rec, rec_checks), t0, t1, g = phase(gpu, run_recall)
    lat["recall"] = {**lat_stats(rec), "verify_after_recall": rec_checks}
    print(f"[{a.label}] recall {lat['recall']}", flush=True)

    def run_ask():
        out, outcomes = [], {}
        sid = None
        for i in range(a.n):
            if i % 10 == 0:
                sid = wl.session(api)
            st, body, dt = wl.ask(api, sid, wl.next_question()); check(st, body, "ask")
            out.append(dt)
            k = (body or {}).get("status") or (body or {}).get("outcome") or "?"
            outcomes[k] = outcomes.get(k, 0) + 1
        return out, outcomes
    (asks, outcomes), t0, t1, g = phase(gpu, run_ask)
    lat["ask"] = {**lat_stats(asks), "outcomes": outcomes}
    print(f"[{a.label}] ask {lat['ask']}", flush=True)

    def run_photo():
        out, routes = [], {}
        sid = None
        for i in range(a.n):
            if i % 10 == 0:
                sid = wl.session(api)
            st, body, dt = wl.photo(api, sid, wl.next_image()); check(st, body, "photo")
            out.append(dt); routes[body.get("route")] = routes.get(body.get("route"), 0) + 1
        return out, routes
    (ph, routes), t0, t1, g = phase(gpu, run_photo)
    lat["photo"] = {**lat_stats(ph), "routes": routes, "gpu": g,
                    "gpu_energy": energy_per(g, idle_w, t1 - t0, len(ph))}
    print(f"[{a.label}] photo {lat['photo']}", flush=True)
    res["latency_sequential"] = lat

    # ---------------- throughput at several concurrency levels
    def closed_loop(make_request, conc: int, seconds: float) -> dict:
        lats, errors, done_at = [], [], []
        stop_at = [0.0]
        lock = threading.Lock()
        barrier = threading.Barrier(conc + 1)

        def worker():
            api_w = Api(a.base)
            barrier.wait()
            while time.perf_counter() < stop_at[0]:
                try:
                    st, body, dt = make_request(api_w)
                    with lock:
                        if st == 200:
                            lats.append(dt); done_at.append(time.perf_counter())
                        else:
                            errors.append(st)
                except Exception as e:      # noqa: BLE001 - counted, not fatal
                    with lock:
                        errors.append(type(e).__name__)
        threads = [threading.Thread(target=worker, daemon=True) for _ in range(conc)]
        for t in threads:
            t.start()
        t0 = time.perf_counter(); stop_at[0] = t0 + seconds
        barrier.wait()
        for t in threads:
            t.join()
        t1 = time.perf_counter()
        n_in = sum(1 for x in done_at if x <= t0 + seconds)
        g = gpu.stats(t0, t0 + seconds)
        return {"concurrency": conc, "seconds": seconds, "completed": n_in, "per_s": round(n_in / seconds, 2),
                **{k: v for k, v in lat_stats(lats).items() if k != "n"}, "errors": len(errors),
                "error_kinds": sorted(set(map(str, errors)))[:5], "gpu": g,
                "gpu_energy": energy_per(g, idle_w, seconds, n_in), "drain_s": round(t1 - t0 - seconds, 2)}

    pool_lock = threading.Lock()

    def plan_request_factory():
        state: dict = {}     # per thread: its own store, used for the 6 field/profile pairs, then a new one

        def req(api_w):
            tid = threading.get_ident()
            if tid not in state or state[tid][1] >= len(COMBOS):
                state[tid] = [wl.session(api_w), 0]
            sid, k = state[tid]
            state[tid][1] += 1
            return wl.plan(api_w, sid, COMBOS[k])
        return req

    sessions_tp = [wl.session(api) for _ in range(20)]

    def photo_req(api_w):
        return wl.photo(api_w, sessions_tp[hash(threading.get_ident()) % len(sessions_tp)], wl.next_image())

    ask_sid = {}

    def ask_req(api_w):
        tid = threading.get_ident()
        if tid not in ask_sid or ask_sid[tid][1] >= 60:   # a new store every 60 questions keeps answers uncached
            ask_sid[tid] = [wl.session(api_w), 0]
        ask_sid[tid][1] += 1
        return wl.ask(api_w, ask_sid[tid][0], wl.next_question())

    def verify_req(api_w):
        with pool_lock:
            r = receipts[int(time.perf_counter() * 1e6) % len(receipts)]
        return wl.verify(api_w, r)

    def verify_official_req(api_w):
        with pool_lock:
            r = official[int(time.perf_counter() * 1e6) % len(official)]
        return wl.verify(api_w, r)

    tp = {}
    for name, factory in (("photo", lambda: photo_req), ("ask", lambda: ask_req), ("plan", plan_request_factory),
                          ("verify", lambda: verify_req), ("verify_official", lambda: verify_official_req)):
        if name not in a.tp_endpoints:
            continue
        tp[name] = []
        for conc in a.concurrency:
            r = closed_loop(factory(), conc, a.tp_seconds)
            tp[name].append(r)
            print(f"[{a.label}] throughput {name} c={conc}: {r['per_s']}/s p50 {r.get('p50_ms')} p95 {r.get('p95_ms')} "
                  f"err {r['errors']} gpu {(r['gpu'] or {}).get('power_mean_w')} W", flush=True)
    res["throughput"] = tp

    # ---------------- mixed farmer-week workload
    def bundle(api_w):
        ip = farmer_ip()
        t0 = time.perf_counter()
        sid = wl.session(api_w)
        st, plan, _ = wl.plan(api_w, sid, COMBOS[int(t0 * 1000) % len(COMBOS)], ip=ip)
        if st != 200:
            return st, None, 0
        for _ in range(2):
            st, _, _ = wl.ask(api_w, sid, wl.next_question(), ip=ip)
            if st != 200:
                return st, None, 0
        st, _, _ = wl.photo(api_w, sid, wl.next_image(), ip=ip)
        if st != 200:
            return st, None, 0
        r = receipts_of(plan)
        if r:
            st, _, _ = wl.verify(api_w, r[0], ip=ip)
        return st, None, time.perf_counter() - t0

    mix = []
    for conc in a.mix_concurrency:
        r = closed_loop(bundle, conc, a.mix_seconds)
        r["unit"] = "farmer-week bundles (session + plan + 2 asks + 1 photo + 1 verify)"
        mix.append(r)
        print(f"[{a.label}] mix c={conc}: {r['per_s']} bundles/s p50 {r.get('p50_ms')} ms err {r['errors']} "
              f"gpu {(r['gpu'] or {}).get('power_mean_w')} W", flush=True)
    res["mixed_farmer_week"] = mix
    res["gpu_apps_at_end"] = gpu_apps() if a.gpu else None
    res["finished"] = now()
    gpu.stop()
    Path(a.out).write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(f"[{a.label}] wrote {a.out}", flush=True)


# ------------------------------------------------------------------ model alone
def preprocess(bb, image: bytes):
    """The same arithmetic as services/vision/backbone.py Backbone.features (checked against it in --parity)."""
    import numpy as np
    from PIL import Image, ImageOps
    with Image.open(io.BytesIO(image)) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
    w, h = im.size
    nw, nh = (bb.size, int(bb.size * h / w)) if w <= h else (int(bb.size * w / h), bb.size)
    im = im.resize((nw, nh), Image.BICUBIC)
    left, top = int(round((nw - bb.size) / 2.0)), int(round((nh - bb.size) / 2.0))
    arr = np.asarray(im.crop((left, top, left + bb.size, top + bb.size)), dtype=np.float32) / 255.0
    return ((arr - bb.mean) / bb.std).astype(np.float32).transpose(2, 0, 1)


def cmd_model(a) -> None:
    import numpy as np
    import onnxruntime as ort
    sys.path.insert(0, str(ROOT))
    from services.vision import backbone as bbm
    images = load_images(a.images)
    d = Path(a.model_dir)
    gpu = GpuSampler(a.gpu)
    res = {"label": a.label, "started": now(), "machine": machine(), "providers_requested": a.providers,
           "gpu_apps_at_start": gpu_apps() if a.gpu else None, "images": len(images)}
    mem0 = None
    if a.gpu:
        time.sleep(1)
        t0 = time.perf_counter(); time.sleep(a.idle_seconds); t1 = time.perf_counter()
        res["gpu_idle_before_load"] = gpu.stats(t0, t1)
        mem0 = res["gpu_idle_before_load"].get("mem_max_mib")

    os.environ[bbm.PROVIDERS_ENV] = a.providers
    bb = bbm.Backbone(d)
    t0 = time.perf_counter(); sess = bb._load(); res["load_s"] = round(time.perf_counter() - t0, 1)
    res["providers_active"] = sess.get_providers()
    res["model"] = {"name": bb.model, "sha256": bb.sha256}
    print(f"[{a.label}] loaded {bb.model} in {res['load_s']} s on {res['providers_active']}", flush=True)
    inp = sess.get_inputs()[0].name
    X = np.stack([preprocess(bb, b) for b in images])

    if a.parity:
        os.environ[bbm.PROVIDERS_ENV] = "CPUExecutionProvider"
        ref = bbm.Backbone(d)
        T = np.load(d / "text.npz")["T"].astype(np.float64)
        rows = []
        for i, b in enumerate(images[:a.parity_n]):
            f_ref = ref.features(b)                      # the server's own code path, CPU
            t0 = time.perf_counter(); f_dev = bb.features(b); dt = time.perf_counter() - t0
            f_pre = sess.run(None, {inp: X[i:i + 1]})[0][0].astype(np.float64)
            cos = float(f_ref @ f_dev / (np.linalg.norm(f_ref) * np.linalg.norm(f_dev)))
            same_pre = float(f_pre @ f_dev / (np.linalg.norm(f_pre) * np.linalg.norm(f_dev)))
            rows.append({"image": i, "cosine_vs_cpu": round(cos, 7), "max_abs_diff": float(np.abs(f_ref - f_dev).max()),
                         "top1_same": int(np.argmax(f_ref @ T.T)) == int(np.argmax(f_dev @ T.T)),
                         "bench_preprocess_cosine": round(same_pre, 7), "ms": round(dt * 1000, 1)})
        cs = [r["cosine_vs_cpu"] for r in rows]
        res["parity"] = {"reference": "CPUExecutionProvider (same model file, same server preprocessing)",
                         "device": res["providers_active"][0], "n": len(rows), "cosine_min": min(cs),
                         "cosine_mean": round(statistics.mean(cs), 7), "max_abs_diff": max(r["max_abs_diff"] for r in rows),
                         "top1_agreement": sum(r["top1_same"] for r in rows), "pass_cosine_0.999": min(cs) >= 0.999,
                         "rows": rows}
        print(f"[{a.label}] parity min cosine {min(cs)} top-1 agree {res['parity']['top1_agreement']}/{len(rows)}", flush=True)
        del ref

    # batched model throughput (tensors ready; the model only)
    thr = []
    for bs in a.batches:
        batch = np.concatenate([X] * (bs // len(X) + 1))[:bs]
        for _ in range(3):
            sess.run(None, {inp: batch})
        runs, t0 = 0, time.perf_counter()
        while time.perf_counter() - t0 < a.seconds or runs < 3:
            sess.run(None, {inp: batch}); runs += 1
        t1 = time.perf_counter()
        g = gpu.stats(t0, t1)
        n = runs * bs
        row = {"batch": bs, "runs": runs, "photos": n, "seconds": round(t1 - t0, 2), "photos_per_s": round(n / (t1 - t0), 1),
               "ms_per_batch": round((t1 - t0) / runs * 1000, 2), "gpu": g,
               "gpu_energy": energy_per(g, (res.get("gpu_idle_before_load") or {}).get("power_mean_w"), t1 - t0, n)}
        if g and mem0 is not None and "mem_max_mib" in g:
            row["vram_above_idle_mib"] = round(g["mem_max_mib"] - mem0)
        thr.append(row)
        print(f"[{a.label}] model batch {bs}: {row['photos_per_s']} photos/s, {row['ms_per_batch']} ms/batch, "
              f"gpu {(g or {}).get('power_mean_w')} W mem {(g or {}).get('mem_max_mib')} MiB", flush=True)
    res["model_throughput"] = thr

    # the full pipeline: JPEG decode + resize + normalise in a thread pool, batches to the model
    from concurrent.futures import ThreadPoolExecutor
    bs = a.pipeline_batch
    with ThreadPoolExecutor(a.pipeline_threads) as ex:
        list(ex.map(lambda b: preprocess(bb, b), images[:8]))
        done, t0 = 0, time.perf_counter()
        while time.perf_counter() - t0 < a.seconds or done < bs:
            chunk = [images[(done + k) % len(images)] for k in range(bs)]
            sess.run(None, {inp: np.stack(list(ex.map(lambda b: preprocess(bb, b), chunk)))})
            done += bs
        t1 = time.perf_counter()
    g = gpu.stats(t0, t1)
    res["pipeline_throughput"] = {"batch": bs, "preprocess_threads": a.pipeline_threads, "photos": done,
                                  "seconds": round(t1 - t0, 2), "photos_per_s": round(done / (t1 - t0), 1), "gpu": g,
                                  "gpu_energy": energy_per(g, (res.get("gpu_idle_before_load") or {}).get("power_mean_w"),
                                                           t1 - t0, done),
                                  "note": "decode + resize run on CPU threads one batch at a time (no overlap with the GPU)"}
    print(f"[{a.label}] pipeline: {res['pipeline_throughput']['photos_per_s']} photos/s", flush=True)
    res["gpu_apps_at_end"] = gpu_apps() if a.gpu else None
    res["finished"] = now()
    gpu.stop()
    Path(a.out).write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(f"[{a.label}] wrote {a.out}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("images")
    p.add_argument("--src", required=True); p.add_argument("--dst", required=True)
    p.add_argument("--max", type=int, default=40); p.add_argument("--exclude", default=""); p.add_argument("--prefer", default="")
    p = sub.add_parser("api")
    p.add_argument("--base", required=True); p.add_argument("--label", required=True); p.add_argument("--images", required=True)
    p.add_argument("--out", required=True); p.add_argument("--gpu", action="store_true")
    p.add_argument("--n", type=int, default=40)
    p.add_argument("--concurrency", type=lambda s: [int(x) for x in s.split(",")], default=[1, 4, 8, 16])
    p.add_argument("--tp-endpoints", type=lambda s: s.split(","), default=["photo", "ask", "plan", "verify", "verify_official"])
    p.add_argument("--tp-seconds", type=float, default=15)
    p.add_argument("--mix-concurrency", type=lambda s: [int(x) for x in s.split(",") if x], default=[8, 16])
    p.add_argument("--mix-seconds", type=float, default=45)
    p.add_argument("--idle-seconds", type=float, default=15)
    p = sub.add_parser("model")
    p.add_argument("--model-dir", required=True); p.add_argument("--providers", required=True)
    p.add_argument("--label", default=platform.node()); p.add_argument("--images", required=True); p.add_argument("--out", required=True)
    p.add_argument("--gpu", action="store_true"); p.add_argument("--parity", action="store_true"); p.add_argument("--parity-n", type=int, default=20)
    p.add_argument("--batches", type=lambda s: [int(x) for x in s.split(",")], default=[1, 8, 16, 32, 64])
    p.add_argument("--seconds", type=float, default=8)
    p.add_argument("--pipeline-batch", type=int, default=32); p.add_argument("--pipeline-threads", type=int, default=8)
    p.add_argument("--idle-seconds", type=float, default=10)
    a = ap.parse_args()
    {"images": cmd_images, "api": cmd_api, "model": cmd_model}[a.cmd](a)


if __name__ == "__main__":
    main()
