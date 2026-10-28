"""Earned-trust simulation: how many officer confirmations does a new area need before photo answers can be
trusted, and how right are the automatic answers after the gate opens?

Pre-specified before running (Oct 28, 2026); no setting below was tuned on these results:
- An area = one held-out public dataset. Its photos arrive in random order (3 orders). The dataset's own label
  stands in for the officer's confirmation.
- Classifier = zero-shot text prior + cache of the area's confirmed photos (Tip-Adapter, training-free;
  alpha 1, beta 5.5 from the paper). Every prediction is made BEFORE that photo's label is known
  (prequential), so every confirmation is an honest out-of-sample test.
- "Sure" = top probability >= 0.85 (the API's gate threshold).
- Gate opens when the last 50 confirmed sure answers number >= 30 and their Wilson 95% lower bound on
  precision is >= 0.85; it closes again if that bound falls below 0.80.
- While closed, every photo goes to the officer. While open, sure answers are automatic and 10% of them are
  still sent to the officer as an audit; unsure answers always go to the officer.
- Variant "seeded": the cache also starts with up to 25 confirmed photos per disease from each OTHER area
  (does KrishiLoop's experience elsewhere help a new area?).
Usage: python earned_trust_sim.py <dir with meta.json + emb_*.npz> [backbone ...]
"""
import json
import math
import sys

import numpy as np

A = sys.argv[1]
BACKBONES = sys.argv[2:] or ["siglip2_b", "bioclip2"]
SURE, WINDOW, MIN_N, OPEN_LB, CLOSE_LB, AUDIT = 0.85, 50, 30, 0.85, 0.80, 0.10
ALPHA, BETA, MAX_STREAM = 1.0, 5.5, 2000

meta = json.load(open(f"{A}/meta.json"))
CORE = meta["core"]
DOM = np.array([r[0] for r in meta["rows"]])
LAB = np.array([CORE.index(r[1]) for r in meta["rows"]])
GRP = np.array([r[2] for r in meta["rows"]])
ALL = np.arange(len(DOM))


def l2n(X):
    return X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-8)


def wilson_lb(k, n, z=1.96):
    if n == 0:
        return 0.0
    p = k / n
    return (p + z * z / (2 * n) - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n)


def seed_cache(held, rng):
    idx = []
    for d in sorted(set(DOM) - {held, "BD-B" if held == "BD-A" else ""}):
        for c in range(len(CORE)):
            pool = ALL[(DOM == d) & (LAB == c)]
            if len(pool):
                idx += rng.choice(pool, min(25, len(pool)), replace=False).tolist()
    return np.array(idx, dtype=int)


def run(X, Tm, held, order_seed, seeded):
    rng = np.random.RandomState(order_seed)
    stream = ALL[DOM == held]
    stream = stream[rng.permutation(len(stream))]
    _, first = np.unique(GRP[stream], return_index=True)   # one photo per duplicate group: no near-copies in a stream
    stream = stream[np.sort(first)][:MAX_STREAM]
    seed = seed_cache(held, rng) if seeded else np.array([], dtype=int)
    zs = 100.0 * X[stream] @ Tm.T
    S_stream = X[stream] @ X[stream].T
    aff_seed = np.exp(-BETA * (1 - X[stream] @ X[seed].T)) @ np.eye(len(CORE))[LAB[seed]] if len(seed) else 0.0
    cached = np.zeros(len(stream), bool)   # which stream photos the officer has confirmed so far
    onehot = np.eye(len(CORE))[LAB[stream]]
    sure_ledger, gate_open, opened_at, closings = [], False, None, 0
    auto_total = auto_right = officer = 0
    for t in range(len(stream)):
        cache_term = np.exp(-BETA * (1 - S_stream[t, :t][cached[:t]])) @ onehot[:t][cached[:t]] if cached[:t].any() else 0.0
        logits = zs[t] + ALPHA * (cache_term + (aff_seed[t] if len(seed) else 0.0))
        p = np.exp(logits - logits.max()); p /= p.sum()
        pred, conf, y = int(p.argmax()), float(p.max()), int(LAB[stream[t]])
        sure = conf >= SURE
        if gate_open and sure:
            auto_total += 1; auto_right += pred == y
            confirm = rng.rand() < AUDIT
        else:
            confirm = True
        if confirm:
            officer += 1; cached[t] = True
            if sure:
                sure_ledger.append(pred == y)
                last = sure_ledger[-WINDOW:]
                lb = wilson_lb(sum(last), len(last))
                if not gate_open and len(last) >= MIN_N and lb >= OPEN_LB:
                    gate_open = True
                    opened_at = opened_at if opened_at is not None else officer
                elif gate_open and len(last) >= MIN_N and lb < CLOSE_LB:
                    gate_open = False; closings += 1
    return {"photos": len(stream), "confirmations_until_open": opened_at, "officer_confirmations": officer,
            "auto_answers": auto_total, "auto_precision": round(auto_right / auto_total, 4) if auto_total else None,
            "auto_share_of_all_photos": round(auto_total / len(stream), 4), "gate_closings": closings,
            "open_at_end": gate_open}


out = {"settings": {"sure": SURE, "window": WINDOW, "min_n": MIN_N, "open_lb": OPEN_LB, "close_lb": CLOSE_LB,
                    "audit": AUDIT, "alpha": ALPHA, "beta": BETA, "max_stream": MAX_STREAM}}
for key in BACKBONES:
    z = np.load(f"{A}/emb_{key}.npz")
    X, Tm = l2n(z["X"].astype(np.float32)), l2n(z["T"].astype(np.float32))
    out[key] = {}
    for seeded in (False, True):
        for held in ("BD-A", "BD-C", "BD-D", "BD-E"):
            runs = [run(X, Tm, held, s, seeded) for s in range(3)]
            name = f"{held}{' seeded' if seeded else ''}"
            out[key][name] = runs
            opened = [r["confirmations_until_open"] for r in runs]
            prec = [r["auto_precision"] for r in runs if r["auto_precision"] is not None]
            print(f"{key:10s} {name:14s} photos {runs[0]['photos']:5d}  opened after {opened}  "
                  f"auto share {[r['auto_share_of_all_photos'] for r in runs]}  auto precision {prec}  "
                  f"closings {[r['gate_closings'] for r in runs]}", flush=True)
json.dump(out, open(f"{A}/earned_trust_sim.json", "w"), indent=1)
