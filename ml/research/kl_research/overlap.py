"""Cross-dataset overlap check: for every perceptual-duplicate group (pHash Hamming <= 6) that spans two datasets,
report the DINOv2-B cosine between its members and their labels. A same-photo copy shows cosine near 1; a pHash
false positive (e.g. maize vs rice) shows a low cosine. Output: <bench>/overlap_report.json (pairs, no images).

Usage: python -m kl_research.overlap <bench_dir> <feat_root>
"""
from __future__ import annotations

import json
import os
import sys
from collections import Counter

import numpy as np


def main(bench, feat_root):
    import pandas as pd
    m = pd.read_parquet(os.path.join(bench, "manifest.parquet"))
    m = m[m.ok].reset_index(drop=True)
    feats = {}
    for k in m.dataset.unique():
        p = os.path.join(feat_root, "dinov2_b", k + ".npz")
        if os.path.exists(p):
            z = np.load(p, allow_pickle=True)
            feats[k] = ({u: i for i, u in enumerate(z["uid"])}, z["X"].astype(np.float32))
    pairs = []
    for g, d in m.groupby("phash_group"):
        if d.dataset.nunique() < 2:
            continue
        rows = d.to_dict("records")
        for i in range(len(rows)):
            for j in range(i + 1, len(rows)):
                a, b = rows[i], rows[j]
                if a["dataset"] == b["dataset"]:
                    continue
                cos = None
                if a["dataset"] in feats and b["dataset"] in feats:
                    ia, xa = feats[a["dataset"]]
                    ib, xb = feats[b["dataset"]]
                    if a["uid"] in ia and b["uid"] in ib:
                        va, vb = xa[ia[a["uid"]]], xb[ib[b["uid"]]]
                        cos = float(va @ vb / (np.linalg.norm(va) * np.linalg.norm(vb) + 1e-8))
                pairs.append({"a": a["uid"], "b": b["uid"], "crop_a": a["crop"], "crop_b": b["crop"],
                              "label_a": a["orig_label"], "label_b": b["orig_label"], "size_a": [a["width"], a["height"]],
                              "size_b": [b["width"], b["height"]], "dinov2_b_cos": cos})
    ds_pairs = Counter(" + ".join(sorted([p["a"].split("/")[0], p["b"].split("/")[0]])) for p in pairs)
    hi = [p for p in pairs if p["dinov2_b_cos"] is not None and p["dinov2_b_cos"] >= 0.95]
    rep = {"cross_dataset_phash_pairs": len(pairs), "pairs_by_dataset": dict(ds_pairs),
           "pairs_with_dinov2_cos_ge_0.95": len(hi),
           "pairs_with_dinov2_cos_ge_0.95_by_dataset": dict(Counter(" + ".join(sorted([p["a"].split("/")[0], p["b"].split("/")[0]])) for p in hi)),
           "cross_crop_pairs": sum(1 for p in pairs if p["crop_a"] != p["crop_b"]),
           "cos_quantiles": np.percentile([p["dinov2_b_cos"] for p in pairs if p["dinov2_b_cos"] is not None], [0, 25, 50, 75, 100]).round(3).tolist() if pairs else [],
           "label_pairs_of_same_photo_copies": dict(Counter(f"{p['label_a']} | {p['label_b']}" for p in hi).most_common(30)),
           "pairs": pairs[:400]}
    # within-dataset pHash matches: how many are also DINOv2-B near-copies (cos >= 0.95)?
    within = {}
    for k, d in m.groupby("dataset"):
        if k not in feats:
            continue
        ia, xa = feats[k]
        cs = []
        for g, dg in d.groupby("phash_group"):
            if len(dg) < 2:
                continue
            us = [u for u in dg.uid if u in ia]
            if len(us) < 2:
                continue
            V = xa[[ia[u] for u in us]]
            V = V / (np.linalg.norm(V, axis=1, keepdims=True) + 1e-8)
            S = V @ V.T
            iu = np.triu_indices(len(us), 1)
            cs.extend(S[iu].tolist())
        if cs:
            cs = np.array(cs)
            within[k] = {"pairs": int(len(cs)), "share_cos_ge_0.95": round(float((cs >= 0.95).mean()), 3),
                         "cos_quantiles": np.percentile(cs, [0, 10, 50, 90, 100]).round(3).tolist()}
    rep["within_dataset_phash_pairs"] = within
    json.dump(rep, open(os.path.join(bench, "overlap_report.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in rep.items() if k != "pairs"}, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:3])
