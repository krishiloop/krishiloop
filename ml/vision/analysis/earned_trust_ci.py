"""Uncertainty for the earned-trust result: protocol 2 re-run over many random stream orders and audit draws.

The headline ("Savar/BD-D: the gate opened after 93 officer answers, then 86% of photos were answered automatically at
99.6% precision") is ONE stream order (seed 0) of earned_trust_sim_v2.py --strict 0.95 --lams 0.3 --curves. This script
re-runs that exact protocol for many seeds and reports 95% intervals.

Protocol fidelity (nothing is re-implemented or tuned):
- The protocol code is NOT copied: the module-level part of earned_trust_sim_v2.py (constants, meta loading, near-copy
  clustering, probe, temperature, gate and `run`) is executed from that file as it stands, cut just before its own
  main loop. Settings stay as pre-specified: lambda = 0.3 (the headline value), sure 0.85, window 50, min 30 sure
  answers, open at Wilson lower bound 0.85, close below 0.80, 10% audit after opening, at most 2000 photos per stream.
- Near-copy check exactly as the strict run: photos whose DINOv2-B cosine is >= 0.95 are clustered within each area
  (plus the pHash groups) and each stream keeps one photo per cluster (the first one in that seed's random order).
- Seeds 0, 1, 2 are the published runs; the script checks that it reproduces them field by field before reporting.
- `run(X, T, area, seed, lam)` draws everything random from np.random.RandomState(seed): the stream order (which also
  picks each cluster's representative and, where an area has more than 2000 clusters, which 2000 enter), and the 10%
  audit draws after the gate opens. Seeds 0..N-1 are therefore N independent replays of the same photos.

Variants:
- "anchored": protocol 2 as pre-specified (W = 100 (T + D), T = the class-text embeddings). Needs a text tower, so it
  exists only for BioCLIP 2 and SigLIP 2.
- "T0": the same code with T = 0 (a plain L2-regularised linear probe, no zero-shot prior). Vision-only backbones
  (DINOv2-B/L, DINOv3-B) have no text tower, so protocol 2 is undefined for them; T = 0 is the smallest change that makes
  the formula defined. It was fixed on Oct 29 BEFORE any run, it is NOT pre-registered, and it is reported as a
  comparison only (and, for BioCLIP 2 / SigLIP 2, as an ablation of the text anchor). DINOv3-B is flagged
  "licence under review" (plan: DINOv3 only after legal review).

What the intervals mean: the 2.5-97.5 percentile range of each outcome across random arrival orders of the same public
photos, i.e. the spread a deployment with this photo population could see. It does NOT include the uncertainty of the
photo population itself (another sample of farms or phones), nor officer error beyond the datasets' own label noise.
The mean's 95% CI (percentile bootstrap over runs) is reported separately and is much narrower.

Usage:
  python earned_trust_ci.py <artifacts dir> [--seeds 200] [--workers 12] [--configs bioclip2:anchored,...]
                            [--areas BD-A,BD-C,BD-D,BD-E] [--runs <jsonl>] [--out <json>] [--summarise]
Results are appended to the runs file as they finish, so a stopped job resumes where it left off.
To stop a running job cleanly, create <runs file>.STOP (delete it before resuming).
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SIM = HERE / "earned_trust_sim_v2.py"
CUT = '\nout = {"settings"'          # the first line of earned_trust_sim_v2.py's main loop
AREAS = ("BD-A", "BD-C", "BD-D", "BD-E")
AREA_NAMES = {"BD-A": "Dhan-Shomadhan (field)", "BD-C": "RiceyLeafDisease", "BD-D": "RiceLeafDisease-BD5 (Savar)",
              "BD-E": "RiceLeafDiseaseBD (Gazipur)"}
DEFAULT_CONFIGS = ["bioclip2:anchored", "siglip2_b:anchored", "dinov2_b:T0", "dinov2_l:T0", "dinov3_b:T0",
                   "bioclip2:T0", "siglip2_b:T0"]
LICENCE_FLAGS = {"dinov3_b": "licence under review (DINOv3 licence; plan: use only after legal review); comparison only"}
LAM, STRICT = 0.3, 0.95
FIELDS = ("photos", "confirmations_until_open", "officer_confirmations", "auto_answers", "auto_precision",
          "auto_share_of_all_photos", "gate_closings", "open_at_end", "suggestion_by_stage")


def load_protocol(artifacts: str, strict: float | None) -> dict:
    """Execute earned_trust_sim_v2.py up to (not including) its main loop and return its namespace."""
    src = SIM.read_text(encoding="utf-8")
    if src.count(CUT) != 1:
        raise RuntimeError("earned_trust_sim_v2.py changed: its main-loop marker was not found exactly once")
    argv = sys.argv
    sys.argv = [str(SIM), artifacts] + (["--strict", str(strict)] if strict else []) + ["--lams", str(LAM)]
    try:
        ns: dict = {"__name__": "earned_trust_sim_v2_protocol", "__file__": str(SIM)}
        exec(compile(src[:src.index(CUT)], str(SIM), "exec"), ns)
    finally:
        sys.argv = argv
    return ns


# ------------------------------------------------------------------ worker side
_NS: dict = {}
_CACHE: dict = {}


def _init(artifacts: str, cluster: list) -> None:
    # cluster arrives as plain ints, so numpy is first imported here, after the BLAS thread limits are set
    for v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
        os.environ.setdefault(v, "1")
    import numpy as np
    ns = load_protocol(artifacts, None)        # no clustering here: the parent computed it once
    ns["CLUSTER"] = np.asarray(cluster)
    _NS.update(ns)


def _features(backbone: str, variant: str):
    import numpy as np
    key = (backbone, variant)
    if key not in _CACHE:
        _CACHE.clear()                          # one backbone in memory per worker
        z = np.load(f"{_NS['A']}/emb_{backbone}.npz")
        X = _NS["l2n"](z["X"].astype(np.float64))
        if variant == "anchored":
            T = _NS["l2n"](z["T"].astype(np.float64))
        elif variant == "T0":
            T = np.zeros((_NS["C"], X.shape[1]), dtype=np.float64)
        else:
            raise ValueError(variant)
        _CACHE[key] = (X, T)
    return _CACHE[key]


def _task(t: tuple) -> dict:
    backbone, variant, area, seed = t
    X, T = _features(backbone, variant)
    t0 = time.perf_counter()
    r = _NS["run"](X, T, area, seed, LAM)
    import platform
    return {"backbone": backbone, "variant": variant, "area": area, "seed": seed, "lam": LAM, "strict": STRICT,
            "host": platform.node(), "seconds": round(time.perf_counter() - t0, 2), **{k: r[k] for k in FIELDS}}


# ------------------------------------------------------------------ statistics
def wilson(k: int, n: int, z: float = 1.96) -> list:
    if n == 0:
        return [None, None]
    p = k / n
    c = (p + z * z / (2 * n)) / (1 + z * z / n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return [round(c - h, 4), round(c + h, 4)]


def _q(values, qs=(2.5, 50, 97.5)):
    """Empirical quantiles as order statistics (no interpolation), so a censored run (+inf: the gate never opened)
    gives None ("beyond the stream") instead of an interpolated number."""
    import numpy as np
    v = np.asarray(values, dtype=float)
    out = [float(np.percentile(v, q, method="inverted_cdf")) for q in qs]
    return [None if math.isinf(x) else round(x, 4) for x in out]


def _mean_ci(values, n_boot: int = 10000, seed: int = 12345):
    import numpy as np
    v = np.asarray(values, dtype=float)
    if len(v) == 0:
        return None
    rng = np.random.default_rng(seed)
    means = v[rng.integers(0, len(v), size=(n_boot, len(v)))].mean(1)
    return {"mean": round(float(v.mean()), 4), "ci95": [round(float(np.percentile(means, 2.5)), 4),
                                                         round(float(np.percentile(means, 97.5)), 4)]}


def _rank(values, x) -> float | None:
    """Percentile rank of x among values (share strictly below plus half the ties), for the headline seed."""
    import numpy as np
    if x is None:
        return None
    v = np.asarray(values, dtype=float)
    return round(float(((v < x).sum() + 0.5 * (v == x).sum()) / len(v)), 3)


def summarise(runs: list[dict]) -> dict:
    import numpy as np
    out = {}
    groups: dict = {}
    for r in runs:
        groups.setdefault((r["backbone"], r["variant"]), {}).setdefault(r["area"], []).append(r)
    for (bb, var), areas in sorted(groups.items()):
        key = f"{bb}:{var}"
        out[key] = {"backbone": bb, "variant": var,
                    "protocol": "protocol 2 as pre-specified" if var == "anchored" else
                    "protocol 2 with T = 0 (no text anchor): NOT pre-registered, comparison only",
                    **({"flag": LICENCE_FLAGS[bb]} if bb in LICENCE_FLAGS else {}), "areas": {}}
        for area in AREAS:
            rs = sorted(areas.get(area, []), key=lambda r: r["seed"])
            if not rs:
                continue
            n = len(rs)
            opened = [r for r in rs if r["confirmations_until_open"] is not None]
            cuo = [r["confirmations_until_open"] if r["confirmations_until_open"] is not None else math.inf for r in rs]
            share = [r["auto_share_of_all_photos"] for r in rs]
            with_auto = [r for r in rs if r["auto_answers"]]
            prec = [r["auto_precision"] for r in with_auto]
            right = [round(r["auto_precision"] * r["auto_answers"]) for r in with_auto]
            lbs = [wilson(k, r["auto_answers"])[0] for k, r in zip(right, with_auto)]
            closings = [r["gate_closings"] for r in rs]
            head = next((r for r in rs if r["seed"] == 0), None)
            out[key]["areas"][area] = {
                "name": AREA_NAMES[area], "runs": n, "seeds": [rs[0]["seed"], rs[-1]["seed"]],
                "photos_per_stream": _q([r["photos"] for r in rs], (0, 50, 100)),
                "gate_opened": {"runs": len(opened), "share": round(len(opened) / n, 4), "wilson95": wilson(len(opened), n),
                                "open_at_end": sum(bool(r["open_at_end"]) for r in rs)},
                "confirmations_until_open": {
                    "p2.5_median_p97.5": _q(cuo),
                    "note": "runs where the gate never opened count as +infinity; None = beyond the stream",
                    "mean_of_opened_runs": _mean_ci([r["confirmations_until_open"] for r in opened])},
                "officer_confirmations": {"p2.5_median_p97.5": _q([r["officer_confirmations"] for r in rs])},
                "auto_share_of_all_photos": {"p2.5_median_p97.5": _q(share), "mean": _mean_ci(share)},
                "auto_precision": {
                    "runs_with_auto_answers": len(with_auto),
                    "p2.5_median_p97.5": _q(prec) if prec else None,
                    "min": round(min(prec), 4) if prec else None,
                    "mean": _mean_ci(prec),
                    "pooled": round(sum(right) / sum(r["auto_answers"] for r in with_auto), 4) if with_auto else None,
                    "median_per_run_wilson95_lower_bound": round(float(np.median(lbs)), 4) if lbs else None,
                    "auto_answers_p2.5_median_p97.5": _q([r["auto_answers"] for r in with_auto]) if with_auto else None},
                "gate_closings": {"mean": round(float(np.mean(closings)), 4), "p2.5_median_p97.5": _q(closings),
                                  "max": int(max(closings)), "runs_with_any": int(sum(c > 0 for c in closings)),
                                  "share_with_any_wilson95": wilson(int(sum(c > 0 for c in closings)), n)},
                "headline_seed0": None if head is None else {
                    "confirmations_until_open": head["confirmations_until_open"],
                    "auto_share_of_all_photos": head["auto_share_of_all_photos"], "auto_precision": head["auto_precision"],
                    "gate_closings": head["gate_closings"],
                    "percentile_rank": {"confirmations_until_open": _rank(cuo, head["confirmations_until_open"]),
                                        "auto_share_of_all_photos": _rank(share, head["auto_share_of_all_photos"]),
                                        "auto_precision": _rank(prec, head["auto_precision"]) if prec else None}},
                "seconds_per_run_median": round(float(np.median([r["seconds"] for r in rs])), 2),
            }
    return out


def reproduction_check(runs: list[dict], artifacts: str) -> dict:
    """Seeds 0-2 of bioclip2 'anchored' must equal the published strict run (earned_trust_sim_v2_strict.json)."""
    pub = json.loads(Path(artifacts, "earned_trust_sim_v2_strict.json").read_text(encoding="utf-8"))
    res = {"source": "ml/vision/artifacts/earned_trust_sim_v2_strict.json", "compared": 0, "identical": 0, "differences": []}
    mine = {(r["area"], r["seed"]): r for r in runs if r["backbone"] == "bioclip2" and r["variant"] == "anchored"}
    for area in AREAS:
        for seed, p in enumerate(pub.get("bioclip2", {}).get(f"{area} lam=0.3", [])):
            m = mine.get((area, seed))
            if m is None:
                continue
            res["compared"] += 1
            diff = {k: [p[k], m[k]] for k in FIELDS if p.get(k) != m.get(k)}
            if diff:
                res["differences"].append({"area": area, "seed": seed, "fields": diff})
            else:
                res["identical"] += 1
    return res


# ------------------------------------------------------------------ main
def main() -> None:
    args = sys.argv[1:]

    def opt(name, default):
        return args[args.index(name) + 1] if name in args else default
    artifacts = args[0]
    seeds = int(opt("--seeds", "200"))
    workers = int(opt("--workers", str(max(1, (os.cpu_count() or 2) - 2))))
    configs = opt("--configs", ",".join(DEFAULT_CONFIGS)).split(",")
    areas = opt("--areas", ",".join(AREAS)).split(",")
    runs_path = Path(opt("--runs", str(Path(artifacts) / "earned_trust_ci_runs.jsonl")))
    out_path = Path(opt("--out", str(Path(artifacts) / "earned_trust_ci.json")))

    done = []
    if runs_path.exists():   # a job stopped mid-write can leave one partial last line: it is skipped and re-run
        for line in runs_path.read_text(encoding="utf-8").splitlines():
            try:
                done.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    have = {(r["backbone"], r["variant"], r["area"], r["seed"]) for r in done}
    # config by config in the order given; within a config seed-major, so a stopped job leaves every area with
    # about the same number of seeds
    todo = [(c.split(":")[0], c.split(":")[1], a, s) for c in configs for s in range(seeds) for a in areas
            if (c.split(":")[0], c.split(":")[1], a, s) not in have]
    print(f"{len(done)} runs on file, {len(todo)} to do, {workers} workers", flush=True)

    if todo and "--summarise" not in args:
        t0 = time.time()
        ns = load_protocol(artifacts, STRICT)     # near-copy clusters, computed once, exactly as the strict run
        cluster = ns["CLUSTER"]
        print(f"near-copy clusters ready in {time.time() - t0:.0f} s", flush=True)
        import multiprocessing as mp
        with mp.get_context("spawn").Pool(workers, initializer=_init, initargs=(artifacts, [int(c) for c in cluster])) as pool, \
                open(runs_path, "a", encoding="utf-8") as f:
            stop = runs_path.with_name(runs_path.name + ".STOP")      # create it to stop cleanly (resumable)
            for i, r in enumerate(pool.imap_unordered(_task, todo, chunksize=1), 1):
                f.write(json.dumps(r) + "\n"); f.flush()
                done.append(r)
                if i % 25 == 0 or i == len(todo):
                    print(f"{i}/{len(todo)} done, {time.time() - t0:.0f} s", flush=True)
                if stop.exists():
                    print(f"stop file found after {i} runs; stopping the workers", flush=True)
                    pool.terminate()
                    break

    summary = {
        "what": "Protocol-2 earned-trust replay re-run over random stream orders and audit draws (seeds); "
                "95% intervals are the 2.5th and 97.5th percentiles across runs (order statistics, no interpolation).",
        "settings": {"lam": LAM, "strict_cosine": STRICT, "sure": 0.85, "window": 50, "min_n": 30, "open_lb": 0.85,
                     "close_lb": 0.80, "audit": 0.10, "max_stream": 2000, "seeds_per_area": seeds,
                     "protocol_code": "ml/vision/analysis/earned_trust_sim_v2.py (executed unchanged, main loop cut)"},
        "officer_stand_in": "public CC BY dataset labels stand in for officers' verdicts: not real officers, not real farms",
        "reproduction_of_published_seeds": reproduction_check(done, artifacts),
        "numerics_note": "workers run single-threaded BLAS; floating-point summation order can then differ from the "
                         "published (multi-threaded) run and flip a photo whose confidence sits exactly at the 0.85 "
                         "bar. Check on Oct 29: BD-D seed 1 differed by one photo (352 vs 351 officer answers) single-threaded "
                         "and matched the published run exactly when re-run with multi-threaded BLAS on the laptop.",
        "hosts": sorted({r.get("host", "?") for r in done}),
        "results": summarise(done),
        "runs_file": runs_path.name,
    }
    out_path.write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(f"wrote {out_path}", flush=True)


if __name__ == "__main__":
    main()
