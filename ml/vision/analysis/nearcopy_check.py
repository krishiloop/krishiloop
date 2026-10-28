"""Leak check for v2 E3: are few-shot gains inflated by near-copies of the shots (burst photos pHash missed)?
Drop test photos whose DINOv2-B cosine to any shot is >= tau, then recompute the nearest-class-mean score."""
import json, sys, numpy as np
from sklearn.metrics import f1_score
A = sys.argv[1]; meta = json.load(open(f"{A}/meta.json")); CORE = meta["core"]
DOM = np.array([r[0] for r in meta["rows"]]); LAB = np.array([CORE.index(r[1]) for r in meta["rows"]]); GRP = np.array([r[2] for r in meta["rows"]])
ALL = np.arange(len(DOM)); l2n = lambda X: X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-8)
mf1 = lambda y, p: float(f1_score(y, p, labels=sorted(set(y.tolist())), average="macro", zero_division=0))
D = l2n(np.load(f"{A}/emb_dinov2_b.npz")["X"].astype(np.float32))
for key in ("dinov2_b_grey", "bioclip2"):
    X = l2n(np.load(f"{A}/emb_{key}.npz")["X"].astype(np.float32))
    for k in (10, 25):
        row = {}
        for held in ("BD-A", "BD-C", "BD-D", "BD-E"):
            tgt = ALL[DOM == held]; out = {None: [], 0.95: [], 0.90: []}; dropped = {0.95: [], 0.90: []}
            for draw in range(3):
                rng = np.random.RandomState(1000 * draw + k); shots = []
                for c in sorted(set(LAB[tgt].tolist())):
                    gs = sorted(set(GRP[tgt][LAB[tgt] == c].tolist())); rng.shuffle(gs)
                    for g in gs[:k]:
                        shots.append(int(rng.choice(tgt[(GRP[tgt] == g) & (LAB[tgt] == c)])))
                shots = np.array(shots); test = tgt[~np.isin(GRP[tgt], GRP[shots])]
                cls = sorted(set(LAB[shots].tolist()))
                protos = np.stack([l2n(X[shots][LAB[shots] == c].mean(0, keepdims=True))[0] for c in cls])
                pred = np.array(cls)[(X[test] @ protos.T).argmax(1)]
                near = (D[test] @ D[shots].T).max(1)
                for tau in out:
                    keep = np.ones(len(test), bool) if tau is None else near < tau
                    out[tau].append(mf1(LAB[test][keep], pred[keep]))
                    if tau: dropped[tau].append(1 - keep.mean())
            row[held] = {str(t): round(float(np.mean(v)), 4) for t, v in out.items()} | {f"dropped@{t}": round(float(np.mean(v)), 3) for t, v in dropped.items()}
        print(key, f"k={k}", json.dumps(row))
