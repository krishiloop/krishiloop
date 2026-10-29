"""RQ1 (shift) on frozen backbones: leave-one-domain-out macro-F1 and ECE for heads H1 and H3 (PROTOCOL_v1).

Fold for held-out domain d (crop c, source dataset s), classification within the crop (the crop is known from the
field record):
- train: kept images of crop c whose dataset is not s (every domain of the held-out dataset is excluded, so device
  or background siblings of d never train its classifier), minus any image whose near-copy cluster has a member in d;
- labels: the canonical labels of crop c seen in train (>= 2 needed); test images whose label is unseen are counted
  ('unseen_label_images') and not scored;
- source validation: 20% of the train clusters (seeded); temperature (both heads) and weight decay (H3) come from it;
- reported: target macro-F1, accuracy, ECE with 95% cluster-bootstrap intervals (1,000 resamples of near-copy
  clusters), source-validation macro-F1 and ECE, and the drop (source - target).
A domain is scored only if it has >= 100 kept images and >= 2 scored labels. Zero-shot (H1 with D = 0) is reported
alongside H1 as a reference for text models.

Usage: python -m kl_research.rq1 <bench_dir> <feat_root> <out_json> [--backbones a,b] [--boot 1000]
"""
from __future__ import annotations

import json
import os
import sys
import time

import numpy as np

from .heads import LogReg, TextAnchoredProbe, ece, macro_f1

SEED = 20261029
MIN_TEST = 100


def log(*a):
    line = " ".join([time.strftime("%H:%M:%S")] + [str(x) for x in a])
    print(line, flush=True)
    if os.environ.get("KL_LOG"):   # jobs also append to a plain log file (stdout redirection can stay empty)
        with open(os.environ["KL_LOG"], "a", encoding="utf-8") as f:
            f.write(line + "\n")


def load_features(feat_root, backbone, uids_by_ds):
    X, have = {}, {}
    for ds in uids_by_ds:
        p = os.path.join(feat_root, backbone, ds + ".npz")
        if not os.path.exists(p):
            continue
        z = np.load(p, allow_pickle=True)
        idx = {u: i for i, u in enumerate(z["uid"])}
        X[ds] = (z["X"], idx, z["ok"])
    return X


def gather(man, X):
    """Feature matrix aligned with man rows; rows without features are flagged."""
    dim = next(iter(X.values()))[0].shape[1]
    F = np.zeros((len(man), dim), dtype=np.float32)
    ok = np.zeros(len(man), dtype=bool)
    for i, (ds, u) in enumerate(zip(man.dataset.values, man.uid.values)):
        if ds in X:
            arr, idx, oks = X[ds]
            j = idx.get(u)
            if j is not None and oks[j]:
                F[i] = arr[j]
                ok[i] = True
    return F, ok


def cluster_bootstrap(y, P, clusters, B, rng):
    uc, inv = np.unique(clusters, return_inverse=True)
    members = [np.nonzero(inv == k)[0] for k in range(len(uc))]
    f1s, eces, accs = [], [], []
    for _ in range(B):
        pick = rng.integers(0, len(uc), len(uc))
        idx = np.concatenate([members[k] for k in pick])
        pred = P[idx].argmax(1)
        f1s.append(macro_f1(y[idx], pred))
        eces.append(ece(P[idx], y[idx]))
        accs.append(float((pred == y[idx]).mean()))
    q = lambda v: [float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))]
    return q(f1s), q(eces), q(accs)


def score(y, P, clusters, B, rng):
    pred = P.argmax(1)
    f1_ci, ece_ci, acc_ci = cluster_bootstrap(y, P, clusters, B, rng) if B else (None, None, None)
    return {"macro_f1": macro_f1(y, pred), "macro_f1_ci": f1_ci, "ece": ece(P, y), "ece_ci": ece_ci,
            "acc": float((pred == y).mean()), "acc_ci": acc_ci, "n": int(len(y)), "clusters": int(len(np.unique(clusters)))}


def folds(man):
    out = []
    for crop, mc in man.groupby("crop"):
        if mc.dataset.nunique() < 2:
            continue
        for dom, md in mc.groupby("domain"):
            if len(md) < MIN_TEST:
                continue
            src = md.dataset.iloc[0]
            tr = mc[(mc.dataset != src) & (~mc.cluster.isin(set(md.cluster)))]
            labels = sorted(set(tr.label))
            te = md[md.label.isin(labels)]
            if len(labels) < 2 or te.label.nunique() < 2 or len(te) < MIN_TEST:
                out.append({"crop": crop, "domain": dom, "skip": f"labels train {len(labels)}, test scored {te.label.nunique()}, n {len(te)}"})
                continue
            out.append({"crop": crop, "domain": dom, "dataset": src, "train": tr.index.values, "test": te.index.values,
                        "labels": labels, "unseen": int(len(md) - len(te)),
                        "dropped_by_cluster_guard": int(((mc.dataset != src) & mc.cluster.isin(set(md.cluster))).sum())})
    return out


def run(bench, feat_root, out_json, backbones=None, B=1000, crops=None):
    import pandas as pd
    man = pd.read_parquet(os.path.join(bench, "manifest.parquet"))
    man = man[man.keep].reset_index(drop=True)
    if crops:
        man = man[man.crop.isin(crops)].reset_index(drop=True)
    uids_by_ds = {k: None for k in man.dataset.unique()}
    backbones = backbones or sorted(d for d in os.listdir(feat_root) if os.path.isdir(os.path.join(feat_root, d)))
    results = {"protocol": "PROTOCOL_v1 RQ1, frozen backbones, heads H1/H3", "seed": SEED, "bootstrap": B,
               "min_test": MIN_TEST, "created": time.strftime("%Y-%m-%dT%H:%M:%S"), "folds": [], "skipped": [], "summary": {}}
    for bb in backbones:
        X = load_features(feat_root, bb, uids_by_ds)
        if not X:
            continue
        F, has = gather(man, X)
        text_p = os.path.join(feat_root, bb, "_text.npz")
        Tz = np.load(text_p, allow_pickle=True) if os.path.exists(text_p) else None
        tlab = list(Tz["labels"]) if Tz is not None else []
        sub = man[has]
        for fd in folds(sub):
            if "skip" in fd:
                results["skipped"].append({"backbone": bb, **fd})
                continue
            rng = np.random.default_rng(SEED)
            tr, te, labels = fd["train"], fd["test"], fd["labels"]
            lab_ix = {l: k for k, l in enumerate(labels)}
            ytr = np.array([lab_ix[l] for l in man.label.values[tr]])
            yte = np.array([lab_ix[l] for l in man.label.values[te]])
            ctr = man.cluster.values[tr]
            uc = np.unique(ctr)
            val_c = set(rng.choice(uc, max(1, int(0.2 * len(uc))), replace=False).tolist())
            isv = np.array([c in val_c for c in ctr])
            if len(set(ytr[isv])) < 2 or len(set(ytr[~isv])) < 2:
                results["skipped"].append({"backbone": bb, "crop": fd["crop"], "domain": fd["domain"], "skip": "val split lacks classes"})
                continue
            Xtr, Xv, Xte = F[tr][~isv], F[tr][isv], F[te]
            ytr_, yv = ytr[~isv], ytr[isv]
            base = {"backbone": bb, "crop": fd["crop"], "domain": fd["domain"], "dataset": fd["dataset"], "labels": labels,
                    "n_train": int(len(ytr_)), "n_val": int(len(yv)), "n_test": int(len(yte)), "unseen_label_images": fd["unseen"],
                    "dropped_by_cluster_guard": fd["dropped_by_cluster_guard"]}
            heads = {}
            t0 = time.time()
            h3 = LogReg(len(labels)).fit(Xtr, ytr_, Xv, yv)
            heads["H3"] = (h3, {"weight_decay": h3.wd, "temperature": h3.temp})
            if Tz is not None and all(l in tlab for l in labels):
                T = Tz["T"][[tlab.index(l) for l in labels]]
                zs = TextAnchoredProbe(T)
                zs.calibrate(Xv, yv)
                heads["ZS"] = (zs, {"temperature": zs.temp})
                h1 = TextAnchoredProbe(T).fit(Xtr, ytr_)
                h1.calibrate(Xv, yv)
                heads["H1"] = (h1, {"lambda": h1.lam, "temperature": h1.temp})
            for name, (h, extra) in heads.items():
                Pv, Pt = h.proba(Xv), h.proba(Xte)
                rec = dict(base, head=name, **extra)
                rec["source_val"] = {"macro_f1": macro_f1(yv, Pv.argmax(1)), "ece": ece(Pv, yv), "acc": float((Pv.argmax(1) == yv).mean())}
                rec["target"] = score(yte, Pt, man.cluster.values[te], B, np.random.default_rng(SEED))
                rec["drop_macro_f1"] = rec["source_val"]["macro_f1"] - rec["target"]["macro_f1"]
                rec["ece_increase"] = rec["target"]["ece"] - rec["source_val"]["ece"]
                results["folds"].append(rec)
            log(f"{bb} {fd['domain']}: " + ", ".join(f"{r['head']} F1 {r['target']['macro_f1']:.3f} ECE {r['target']['ece']:.3f}"
                                                   for r in results['folds'][-len(heads):]) + f" ({time.time() - t0:.0f} s)")
            json.dump(results, open(out_json, "w"), indent=1)
    results["summary"] = summarise(results["folds"], B)
    json.dump(results, open(out_json, "w"), indent=1)
    return results


def _md(x) -> str:
    return str(x).replace("|", "\\|")


def summarise(folds: list[dict], B: int = 1000) -> dict:
    """Mean over held-out domains per backbone/head, with a 95% bootstrap interval over domains."""
    out = {}
    rng = np.random.default_rng(SEED)
    for bb in sorted({r["backbone"] for r in folds}):
        for head in ("H1", "H3", "ZS"):
            rs = [r for r in folds if r["backbone"] == bb and r["head"] == head]
            if not rs:
                continue
            f1 = np.array([r["target"]["macro_f1"] for r in rs])
            ec = np.array([r["target"]["ece"] for r in rs])
            sv = np.array([r["source_val"]["macro_f1"] for r in rs])
            bs = [rng.integers(0, len(rs), len(rs)) for _ in range(B or 1)]
            ci = lambda v: [float(np.percentile([v[b].mean() for b in bs], 2.5)), float(np.percentile([v[b].mean() for b in bs], 97.5))]
            out[f"{bb}/{head}"] = {
                "domains": len(rs), "mean_target_macro_f1": float(f1.mean()), "ci_over_domains": ci(f1),
                "mean_source_val_macro_f1": float(sv.mean()), "mean_drop": float((sv - f1).mean()),
                "mean_target_ece": float(ec.mean()), "ece_ci_over_domains": ci(ec),
                "worst_domain": min(rs, key=lambda r: r["target"]["macro_f1"])["domain"], "worst_macro_f1": float(f1.min())}
    return out


def to_markdown(res: dict) -> str:
    L = ["# RQ1 (shift), frozen backbones: leave-one-domain-out", "",
         f"Generated {res['created']} by `kl_research.rq1` (seed {res['seed']}, {res['bootstrap']} cluster-bootstrap resamples). "
         "Dataset labels stand in for experts; this is a replay on public data, not a field trial.", "",
         "**How to read it.** For each held-out domain, the head is trained on the other datasets of the same crop "
         "(the crop is known from the field record) and tested on the held-out domain; every domain of the held-out "
         "dataset is excluded from training, and near-copy clusters never span train and test. 'Source-val' is the "
         "in-distribution score on 20% of the training clusters; 'Drop' = source-val minus target macro-F1. Macro-F1 is "
         "over the labels that the held-out domain shares with training; images whose label never occurs in training are "
         "counted ('Unseen-label images') and not scored. ZS = zero-shot text classifier (H1 with no training), shown as a "
         "reference. H1 needs a text tower, so image-only backbones (DINOv2, DINOv3) report H3 only.", "",
         "**Caveats.** Label sets differ between domains, so scores are not comparable across crops; several domains are "
         "seeded subsets (bandwidth caps, see DEVIATIONS.md); dataset labels are unaudited (some sets carry visible "
         "duplicates and label conflicts, removed by the de-duplication rule); the mean over domains weights every domain "
         "equally; DINOv3 is a flagged comparison only.", "",
         "## Summary (mean over held-out domains; 95% interval = bootstrap over domains)", "",
         "| Backbone / head | Domains | Source-val macro-F1 | Target macro-F1 [95% CI] | Drop | Target ECE [95% CI] | Worst domain (F1) |",
         "|---|---|---|---|---|---|---|"]
    for k, s in sorted(res["summary"].items(), key=lambda kv: -kv[1]["mean_target_macro_f1"]):
        L.append(f"| {k} | {s['domains']} | {s['mean_source_val_macro_f1']:.3f} | {s['mean_target_macro_f1']:.3f} "
                 f"[{s['ci_over_domains'][0]:.3f}, {s['ci_over_domains'][1]:.3f}] | {s['mean_drop']:.3f} | {s['mean_target_ece']:.3f} "
                 f"[{s['ece_ci_over_domains'][0]:.3f}, {s['ece_ci_over_domains'][1]:.3f}] | {_md(s['worst_domain'])} ({s['worst_macro_f1']:.3f}) |")
    L += ["", "## Every fold", "", "| Backbone | Head | Held-out domain | n test | Source-val F1 | Target F1 [95% CI] | Target ECE [95% CI] | Unseen-label images |",
          "|---|---|---|---|---|---|---|---|"]
    for r in sorted(res["folds"], key=lambda r: (r["domain"], r["backbone"], r["head"])):
        t = r["target"]
        L.append(f"| {r['backbone']} | {r['head']} | {_md(r['domain'])} | {t['n']} | {r['source_val']['macro_f1']:.3f} | {t['macro_f1']:.3f} "
                 f"[{t['macro_f1_ci'][0]:.3f}, {t['macro_f1_ci'][1]:.3f}] | {t['ece']:.3f} [{t['ece_ci'][0]:.3f}, {t['ece_ci'][1]:.3f}] | {r['unseen_label_images']} |")
    if res["skipped"]:
        L += ["", "## Not scored", ""] + sorted({f"- {_md(s['domain'])}: {s['skip']}" for s in res["skipped"]})
    return "\n".join(L) + "\n"


def merge(paths: list[str], out_json: str, B: int = 1000) -> dict:
    """Merge RQ1 JSONs written by parallel runs (one per backbone group) and recompute the summary."""
    res = None
    for p in paths:
        r = json.load(open(p))
        if res is None:
            res = r
            res["folds"], res["skipped"] = list(r["folds"]), list(r["skipped"])
        else:
            res["folds"] += r["folds"]
            res["skipped"] += r["skipped"]
    res["summary"] = summarise(res["folds"], B)
    json.dump(res, open(out_json, "w"), indent=1)
    open(os.path.splitext(out_json)[0] + ".md", "w", encoding="utf-8").write(to_markdown(res))
    return res


def main(argv):
    if argv and argv[0] == "merge":
        merge(argv[2:], argv[1])
        return
    args = argv
    bbs = args[args.index("--backbones") + 1].split(",") if "--backbones" in args else None
    B = int(args[args.index("--boot") + 1]) if "--boot" in args else 1000
    crops = args[args.index("--crops") + 1].split(",") if "--crops" in args else None
    pos = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))]
    res = run(pos[0], pos[1], pos[2], bbs, B, crops)
    open(os.path.splitext(pos[2])[0] + ".md", "w", encoding="utf-8").write(to_markdown(res))


if __name__ == "__main__":
    main(sys.argv[1:])
