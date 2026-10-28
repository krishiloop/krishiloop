"""Exploratory, post-hoc (decided after seeing v2): zero-shot text prior + k labelled target shots (Tip-Adapter,
training-free, paper defaults alpha=1, beta=5.5, fixed before running). Same shot sampling as krishilens_v2_probe E3."""
import json, sys, numpy as np
from sklearn.metrics import f1_score
A = sys.argv[1]
meta = json.load(open(f"{A}/meta.json")); CORE = meta["core"]
DOM = np.array([r[0] for r in meta["rows"]]); LAB = np.array([CORE.index(r[1]) for r in meta["rows"]]); GRP = np.array([r[2] for r in meta["rows"]])
ALL = np.arange(len(DOM)); l2n = lambda X: X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-8)
mf1 = lambda y, p: float(f1_score(y, p, labels=sorted(set(y.tolist())), average="macro", zero_division=0))
out = {}
for key in ("siglip2_b", "bioclip2", "bioclip2_grey"):
    z = np.load(f"{A}/emb_{key}.npz"); X = l2n(z["X"].astype(np.float32)); Tm = l2n(z["T"]); zs = 100.0 * X @ Tm.T
    res = {}
    for held in ("BD-A", "BD-C", "BD-D", "BD-E"):
        tgt = ALL[DOM == held]; res[held] = {"zero_shot": round(mf1(LAB[tgt], zs[tgt].argmax(1)), 4)}
        for k in (1, 5, 10, 25):
            runs = []
            for draw in range(3):
                rng = np.random.RandomState(1000 * draw + k); shots = []
                for c in sorted(set(LAB[tgt].tolist())):
                    gs = sorted(set(GRP[tgt][LAB[tgt] == c].tolist())); rng.shuffle(gs)
                    for g in gs[:k]:
                        shots.append(int(rng.choice(tgt[(GRP[tgt] == g) & (LAB[tgt] == c)])))
                shots = np.array(shots); test = tgt[~np.isin(GRP[tgt], GRP[shots])]
                aff = np.exp(-5.5 * (1 - X[test] @ X[shots].T)); L = np.eye(len(CORE))[LAB[shots]]
                logits = zs[test] + 1.0 * aff @ L
                p = np.exp(logits - logits.max(1, keepdims=True)); p /= p.sum(1, keepdims=True)
                gate = p.max(1) >= 0.85; corr = p.argmax(1) == LAB[test]
                runs.append((mf1(LAB[test], logits.argmax(1)), gate.mean(), corr[gate].mean() if gate.any() else np.nan))
            r = np.array(runs)
            res[held][f"k={k}"] = [round(float(r[:, 0].mean()), 4), round(float(r[:, 0].std()), 4), round(float(r[:, 1].mean()), 3), round(float(np.nanmean(r[:, 2])), 3)]
    out[key] = res
    m = {k: round(float(np.mean([res[h][k] if k == "zero_shot" else res[h][k][0] for h in res])), 4) for k in ("zero_shot", "k=1", "k=5", "k=10", "k=25")}
    print(key, "mean over 4 held-out:", m)
    for h in res: print("   ", h, res[h])
json.dump(out, open(f"{A}/tip_adapter_exploratory.json", "w"), indent=1)
