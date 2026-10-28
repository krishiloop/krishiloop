"""Earned-trust simulation, protocol 2 (designed AFTER protocol 1, earned_trust_sim.py, showed its training-free cache
classifier grows overconfident: sure on ~90% of photos at 50-70% precision, so the gate never opened in 23 of 24 runs).

Same areas, streams (one photo per duplicate group, 3 random orders), officer stand-in and gate rule as protocol 1.
Changed, and fixed before running:
- Classifier: a linear probe anchored to the zero-shot text classifier (CLAP-style, Silva-Rodriguez et al., CVPR 2024):
  W = 100 * (T + D), minimising class-balanced cross-entropy on the area's confirmed photos + (lam / 2) * ||D||^2.
  With no confirmations it is exactly zero-shot. Refit after each of the first 20 confirmations, then every 10th.
- Confidence: temperature fitted on the area's own prequential record (the last 200 predictions made before their
  labels were known), refreshed at every refit. Nothing from the held-out answers is used before they arrive.
- lam in {0.03, 0.3, 3}: all three are reported; 0.3 was declared the headline value before running.
Also reported: the officer suggestion (top-1 / top-2 right) by stage, i.e. the triage value while the gate is closed.
Robustness option --strict TAU (added after the first lambda finished): before streaming, photos whose DINOv2-B
cosine similarity is >= TAU are clustered within each area and only one per cluster is kept, so a later photo of the
same leaf cannot ride on an earlier verdict.
Option --curves: also write area_trust_replay.json (seed 0 only): after every officer verdict, the evidence the gate
sees (lower bound, gate state, automatic answers so far and how many were right), for the demo's area-trust panel.
Usage: python earned_trust_sim_v2.py <dir with meta.json + emb_*.npz> [backbone ...] [--strict 0.95] [--lams 0.3] [--curves]
"""
import json
import math
import sys

import numpy as np
from scipy.optimize import minimize

ARGS = sys.argv[1:]
STRICT = float(ARGS[ARGS.index("--strict") + 1]) if "--strict" in ARGS else None
LAMS_ARG = [float(v) for v in ARGS[ARGS.index("--lams") + 1].split(",")] if "--lams" in ARGS else None
CURVES = "--curves" in ARGS
ARGS = [a for i, a in enumerate(ARGS) if a not in ("--strict", "--lams", "--curves")
        and (i == 0 or ARGS[i - 1] not in ("--strict", "--lams"))]
A = ARGS[0]
BACKBONES = ARGS[1:] or ["bioclip2", "siglip2_b"]
SURE, WINDOW, MIN_N, OPEN_LB, CLOSE_LB, AUDIT, MAX_STREAM = 0.85, 50, 30, 0.85, 0.80, 0.10, 2000
LAMS, HEADLINE = (0.03, 0.3, 3.0), 0.3
if LAMS_ARG:
    LAMS = tuple(LAMS_ARG)
STAGES = [(0, 50), (50, 200), (200, 500), (500, 2000)]

meta = json.load(open(f"{A}/meta.json"))
CORE = meta["core"]; C = len(CORE)
DOM = np.array([r[0] for r in meta["rows"]])
LAB = np.array([CORE.index(r[1]) for r in meta["rows"]])
GRP = np.array([r[2] for r in meta["rows"]])
ALL = np.arange(len(DOM))
CLUSTER = GRP.copy()   # the stream keeps one photo per cluster: pHash groups, or near-copy clusters with --strict


def near_copy_clusters(tau):
    F = np.load(f"{A}/emb_dinov2_b.npz")["X"].astype(np.float32)
    F /= np.linalg.norm(F, axis=1, keepdims=True) + 1e-8
    parent = np.arange(len(F))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for d in sorted(set(DOM)):
        idx = ALL[DOM == d]
        for s0 in range(0, len(idx), 1024):
            S = F[idx[s0:s0 + 1024]] @ F[idx].T
            for a, b in zip(*np.nonzero(S >= tau)):
                i, j = idx[s0 + a], idx[b]
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[ri] = rj
    order = np.argsort(GRP, kind="stable")          # keep pHash groups together too
    starts = np.r_[0, np.nonzero(np.diff(GRP[order]))[0] + 1]
    for st, en in zip(starts, np.r_[starts[1:], len(order)]):
        members = order[st:en]
        for m in members[1:]:
            ri, rj = find(members[0]), find(m)
            if ri != rj:
                parent[ri] = rj
    return np.array([find(i) for i in ALL])


if STRICT:
    CLUSTER = near_copy_clusters(STRICT)


def l2n(X):
    return X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-8)


def wilson_lb(k, n, z=1.96):
    if n == 0:
        return 0.0
    p = k / n
    return (p + z * z / (2 * n) - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n)


def log_softmax(Z):
    Z = Z - Z.max(1, keepdims=True)
    return Z - np.log(np.exp(Z).sum(1, keepdims=True))


def fit_probe(X, y, T, lam, D0):
    """min class-balanced CE(100 * X (T + D)^T) + lam/2 ||D||^2 over D (C x d)."""
    counts = np.bincount(y, minlength=C).astype(float)
    w = 1.0 / (counts[y] * (counts > 0).sum())          # each seen class carries equal total weight
    Y = np.eye(C)[y]

    def f(flat):
        D = flat.reshape(T.shape)
        Z = 100.0 * X @ (T + D).T
        lp = log_softmax(Z)
        loss = -(w * (Y * lp).sum(1)).sum() + 0.5 * lam * (D * D).sum()
        G = 100.0 * ((np.exp(lp) - Y) * w[:, None]).T @ X + lam * D
        return loss, G.ravel()
    r = minimize(f, D0.ravel(), jac=True, method="L-BFGS-B", options={"maxiter": 200})
    return r.x.reshape(T.shape)


def fit_temperature(Z, y):
    temps = np.exp(np.linspace(np.log(0.25), np.log(8.0), 60))
    nll = [-log_softmax(Z / t)[np.arange(len(y)), y].mean() for t in temps]
    return float(temps[int(np.argmin(nll))])


def run(X, T, held, order_seed, lam, curve=None):
    rng = np.random.RandomState(order_seed)
    stream = ALL[DOM == held]
    stream = stream[rng.permutation(len(stream))]
    _, first = np.unique(CLUSTER[stream], return_index=True)
    stream = stream[np.sort(first)][:MAX_STREAM]
    D, temp = np.zeros_like(T), 1.0
    conf_idx, conf_y = [], []
    hist_Z, hist_y = [], []
    sure_ledger, gate_open, opened_at, closings = [], False, None, 0
    auto_total = auto_right = officer = 0
    stage = {s: [0, 0, 0] for s in STAGES}   # photos, top-1 right, top-2 right (suggestion shown to the officer)
    for t, i in enumerate(stream):
        z = 100.0 * X[i] @ (T + D).T
        p = np.exp((z - z.max()) / temp); p /= p.sum()
        order = np.argsort(-p); pred, conf, y = int(order[0]), float(p.max()), int(LAB[i])
        s = next(s for s in STAGES if s[0] <= t < s[1]); stage[s][0] += 1; stage[s][1] += pred == y; stage[s][2] += y in order[:2]
        sure = conf >= SURE
        if gate_open and sure:
            auto_total += 1; auto_right += pred == y
            confirm = rng.rand() < AUDIT
        else:
            confirm = True
        if not confirm:
            continue
        officer += 1
        if curve is not None:
            w = sure_ledger[-WINDOW:]
            curve.append([t + 1, officer, round(wilson_lb(sum(w), len(w)), 4) if len(w) >= MIN_N else None,
                          int(gate_open), auto_total, auto_right])
        conf_idx.append(i); conf_y.append(y); hist_Z.append(z); hist_y.append(y)
        if sure:
            sure_ledger.append(pred == y)
            last = sure_ledger[-WINDOW:]; lb = wilson_lb(sum(last), len(last))
            if not gate_open and len(last) >= MIN_N and lb >= OPEN_LB:
                gate_open = True; opened_at = opened_at if opened_at is not None else officer
            elif gate_open and len(last) >= MIN_N and lb < CLOSE_LB:
                gate_open = False; closings += 1
        n = len(conf_idx)
        if n <= 20 or n % 10 == 0:
            D = fit_probe(X[conf_idx], np.array(conf_y), T, lam, D)
            if len(hist_y) >= 20:
                temp = fit_temperature(np.array(hist_Z[-200:]), np.array(hist_y[-200:]))
    return {"photos": len(stream), "confirmations_until_open": opened_at, "officer_confirmations": officer,
            "auto_answers": auto_total, "auto_precision": round(auto_right / auto_total, 4) if auto_total else None,
            "auto_share_of_all_photos": round(auto_total / len(stream), 4), "gate_closings": closings,
            "open_at_end": gate_open,
            "suggestion_by_stage": {f"{a}-{b}": [v[0], round(v[1] / v[0], 3) if v[0] else None, round(v[2] / v[0], 3) if v[0] else None]
                                    for (a, b), v in stage.items()}}


out = {"settings": {"sure": SURE, "window": WINDOW, "min_n": MIN_N, "open_lb": OPEN_LB, "close_lb": CLOSE_LB,
                    "audit": AUDIT, "lams": LAMS, "headline_lam": HEADLINE, "max_stream": MAX_STREAM, "strict_cosine": STRICT}}
OUT = f"{A}/earned_trust_sim_v2{'_strict' if STRICT else ''}.json"
replay = {}
for key in BACKBONES:
    z = np.load(f"{A}/emb_{key}.npz")
    X, T = l2n(z["X"].astype(np.float64)), l2n(z["T"].astype(np.float64))
    out[key] = {}
    for lam in LAMS:
        for held in ("BD-A", "BD-C", "BD-D", "BD-E"):
            curve = [] if CURVES and lam == HEADLINE else None
            runs = [run(X, T, held, s, lam, curve if s == 0 else None) for s in range(3)]
            if curve is not None:
                step = max(1, len(curve) // 300)
                replay.setdefault(key, {})[held] = {
                    "fields": ["photos_seen", "officer_verdicts", "lower_bound_before_this_verdict", "gate_open", "auto_answers", "auto_right"],
                    "points": curve[::step] + ([curve[-1]] if (len(curve) - 1) % step else []),
                    "summary": runs[0]}
            out[key][f"{held} lam={lam}"] = runs
            prec = [r["auto_precision"] for r in runs if r["auto_precision"] is not None]
            sug = runs[0]["suggestion_by_stage"]
            print(f"{key:9s} lam={lam:<5} {held} photos {runs[0]['photos']:4d} opened after {[r['confirmations_until_open'] for r in runs]} "
                  f"auto share {[r['auto_share_of_all_photos'] for r in runs]} auto prec {prec} closings {[r['gate_closings'] for r in runs]} "
                  f"| suggestion top1/top2 by stage {[(k, v[1], v[2]) for k, v in sug.items() if v[0]]}", flush=True)
        json.dump(out, open(OUT, "w"), indent=1)
        if CURVES:
            json.dump({"note": "Replay of public CC BY rice datasets: the dataset's labels stand in for an officer's verdicts. "
                               "Not real officers, not real farms.", "settings": out["settings"], "areas": replay},
                      open(f"{A}/area_trust_replay.json", "w"))
