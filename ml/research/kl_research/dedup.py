"""De-duplication within and across datasets (PROTOCOL_v1 section D).

1. exact match: identical SHA-256 of the file bytes;
2. perceptual match: 64-bit pHash, Hamming distance <= 6;
3. near-copy clusters: DINOv2-B (CLS, 224 px) cosine >= 0.95.

Rules
- Exact matches, and perceptual matches CONFIRMED by DINOv2-B (cosine >= 0.95), are copies: one copy is kept per
  connected group. A pHash match that DINOv2-B does not confirm is kept (it is usually a different photo with a similar
  low-frequency layout; see overlap.py and DEVIATIONS.md) but stays in the same near-copy cluster. The kept copy comes from the
  dataset published first (licence-screen publish date; it is the likeliest original), then the larger image, then
  the uid. If the copies of one group carry different canonical labels, every copy is dropped ('label_conflict').
- Near-copy clusters are kept but grouped: ``cluster`` is the connected component over exact + pHash + DINOv2 edges
  among the remaining images. Downstream splits (LODO folds, streams) never put one cluster on both sides.

Output: <bench>/clusters.parquet (uid, exact_group, phash_group, cluster, dup_drop) and <bench>/dedup_report.json.
Usage: python -m kl_research.dedup <datasets.yaml> <bench_dir> <feat_root> <label_map.csv> <licence_screen.json>
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections import Counter, defaultdict

import numpy as np

PHASH_MAX = 6
COS_MIN = 0.95


def log(*a):
    line = " ".join([time.strftime("%H:%M:%S")] + [str(x) for x in a])
    print(line, flush=True)
    if os.environ.get("KL_LOG"):   # jobs also append to a plain log file (stdout redirection can stay empty)
        with open(os.environ["KL_LOG"], "a", encoding="utf-8") as f:
            f.write(line + "\n")


def components(n: int, edges: list[np.ndarray]) -> np.ndarray:
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    if edges:
        e = np.concatenate([x for x in edges if len(x)] or [np.zeros((0, 2), dtype=np.int64)])
    else:
        e = np.zeros((0, 2), dtype=np.int64)
    a = coo_matrix((np.ones(len(e), dtype=np.int8), (e[:, 0], e[:, 1])), shape=(n, n)) if len(e) else coo_matrix((n, n), dtype=np.int8)
    _, lab = connected_components(a, directed=False)
    return lab


def phash_edges(hashes: list[str], max_d: int = PHASH_MAX, block: int = 256) -> np.ndarray:
    h = np.array([int(x, 16) if x else 0 for x in hashes], dtype=np.uint64)
    valid = np.array([bool(x) for x in hashes])
    out = []
    n = len(h)
    for i0 in range(0, n, block):
        i1 = min(n, i0 + block)
        d = np.bitwise_count(h[i0:i1, None] ^ h[None, i0:])
        ii, jj = np.nonzero(d <= max_d)
        jj = jj + i0
        ii = ii + i0
        m = (jj > ii) & valid[ii] & valid[jj]
        if m.any():
            out.append(np.stack([ii[m], jj[m]], 1))
    return np.concatenate(out) if out else np.zeros((0, 2), dtype=np.int64)


def dino_edges(X: np.ndarray, cos_min: float = COS_MIN, block: int = 4096) -> np.ndarray:
    import torch
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    T = torch.from_numpy(X.astype(np.float16)).to(dev)
    T = torch.nn.functional.normalize(T.float(), dim=1).half()
    out = []
    n = len(X)
    for i0 in range(0, n, block):
        i1 = min(n, i0 + block)
        S = T[i0:i1] @ T[i0:].T
        ii, jj = torch.nonzero(S >= cos_min, as_tuple=True)
        jj = jj + i0
        ii = ii + i0
        m = jj > ii
        if m.any():
            out.append(torch.stack([ii[m], jj[m]], 1).cpu().numpy())
    return np.concatenate(out) if out else np.zeros((0, 2), dtype=np.int64)


def run(cfg_path, bench, feat_root, label_map_csv, screen_json):
    import pandas as pd
    import yaml
    cfg = {e["key"]: e for e in yaml.safe_load(open(cfg_path, encoding="utf-8"))["datasets"]}
    screen = {r["key"]: r for r in json.load(open(screen_json, encoding="utf-8"))["datasets"]}
    scan_dir = os.path.join(bench, "scan")
    df = pd.concat([pd.read_parquet(os.path.join(scan_dir, f)) for f in sorted(os.listdir(scan_dir)) if f.endswith(".parquet")],
                   ignore_index=True)
    df = df[df.ok].reset_index(drop=True)
    lm = pd.read_csv(label_map_csv, dtype=str).fillna("")
    lmk = {(r.dataset, r.orig_label.strip().lower(), r.crop_scope): r.canonical for r in lm.itertuples()}
    df["canon"] = [lmk.get((d, str(o).strip().lower(), c if d == "gh_ccmt" else ""), "")
                   for d, o, c in zip(df.dataset, df.orig_label, df.crop)]
    pub = {k: (screen.get(k, {}).get("publish_date") or "9999") for k in cfg}
    df["rank_pub"] = df.dataset.map(lambda k: pub.get(k, "9999"))
    df["area"] = df.width.astype(np.int64) * df.height.astype(np.int64)
    n = len(df)
    log(f"dedup over {n} readable images from {df.dataset.nunique()} datasets")

    # exact
    first = df.groupby("sha256").cumcount() == 0
    exact_id = df.groupby("sha256").ngroup().values
    e_exact = []
    for _, idx in df.groupby("sha256").indices.items():
        if len(idx) > 1:
            e_exact.append(np.stack([np.full(len(idx) - 1, idx[0]), idx[1:]], 1))
    e_exact = np.concatenate(e_exact) if e_exact else np.zeros((0, 2), dtype=np.int64)
    # DINOv2-B features for every readable image (needed to confirm perceptual matches and for near-copy clusters)
    feats_dir = os.path.join(feat_root, "dinov2_b")
    have, cache = {}, {}
    for k in df.dataset.unique():
        p = os.path.join(feats_dir, k + ".npz")
        if os.path.exists(p):
            z = np.load(p, allow_pickle=True)
            cache[k] = z["X"]
            have.update({u: (k, j) for j, u in enumerate(z["uid"])})
    missing = int(sum(u not in have for u in df.uid))
    X, has = None, np.zeros(n, dtype=bool)
    if cache:
        dim = next(iter(cache.values())).shape[1]
        X = np.zeros((n, dim), dtype=np.float32)
        for i, u in enumerate(df.uid):
            if u in have:
                k, j = have[u]
                X[i] = cache[k][j]
                has[i] = True
        X /= np.linalg.norm(X, axis=1, keepdims=True) + 1e-8
    # perceptual matches; a pHash match counts as a COPY only if DINOv2-B confirms it (cosine >= COS_MIN)
    t = time.time()
    e_ph = phash_edges(df.phash.tolist())
    if len(e_ph) and X is not None:
        ok = has[e_ph[:, 0]] & has[e_ph[:, 1]]
        cos = np.full(len(e_ph), np.nan)
        cos[ok] = (X[e_ph[ok, 0]] * X[e_ph[ok, 1]]).sum(1)
        e_copy = e_ph[np.nan_to_num(cos, nan=1.0) >= COS_MIN]   # no features -> fall back to the pHash rule
    else:
        e_copy = e_ph
    log(f"pHash edges (Hamming <= {PHASH_MAX}): {len(e_ph)}, of which {len(e_copy)} confirmed by DINOv2-B cos >= {COS_MIN} "
        f"in {time.time() - t:.0f} s")
    ph_group = components(n, [e_exact, e_ph])
    copy_group = components(n, [e_exact, e_copy])

    # dup_drop within each copy group (exact copies + confirmed perceptual copies)
    dup_drop = np.array([""] * n, dtype=object)
    conflicts = Counter()
    groups = defaultdict(list)
    for i, g in enumerate(copy_group):
        groups[g].append(i)
    cross = Counter()
    for g, idx in groups.items():
        if len(idx) < 2:
            continue
        labs = {df.canon[i] for i in idx if df.canon[i]}
        dsets = sorted({df.dataset[i] for i in idx})
        if len(dsets) > 1:
            cross[" + ".join(dsets)] += 1
        if len(labs) > 1:
            for i in idx:
                dup_drop[i] = "label_conflict"
            conflicts[" + ".join(dsets)] += len(idx)
            continue
        best = sorted(idx, key=lambda i: (df.rank_pub[i], -df.area[i], df.uid[i]))[0]
        for i in idx:
            if i != best:
                dup_drop[i] = ("exact_dup_of:" if df.sha256[i] == df.sha256[best] else "phash_dup_of:") + df.uid[best]

    # near-copy clusters (DINOv2-B) among the remaining images; pHash-only matches stay in the same cluster too
    e_dino = np.zeros((0, 2), dtype=np.int64)
    if X is not None:
        keep_idx = np.array([i for i in range(n) if has[i] and not dup_drop[i]])
        t = time.time()
        e_sub = dino_edges(X[keep_idx].astype(np.float16))
        e_dino = keep_idx[e_sub] if len(e_sub) else e_dino
        log(f"DINOv2-B edges (cos >= {COS_MIN}): {len(e_dino)} in {time.time() - t:.0f} s; {missing} images without features")
    cluster = components(n, [e_exact, e_ph, e_dino])

    out = pd.DataFrame({"uid": df.uid, "exact_group": exact_id, "phash_group": ph_group, "copy_group": copy_group,
                        "cluster": cluster, "dup_drop": dup_drop.astype(str)})
    out.to_parquet(os.path.join(bench, "clusters.parquet"), index=False)

    # report
    rep = {"images": n, "phash_max": PHASH_MAX, "cos_min": COS_MIN, "images_without_dinov2_b": missing, "per_dataset": {},
           "rule": "copies = exact SHA-256 matches + pHash matches confirmed by DINOv2-B cosine >= 0.95; pHash-only matches are kept and clustered",
           "phash_edges": int(len(e_ph)), "phash_edges_confirmed": int(len(e_copy)),
           "cross_dataset_duplicate_groups": dict(cross.most_common()), "label_conflict_images": dict(conflicts.most_common())}
    kept = out.dup_drop == ""
    cl_ds = df.groupby(cluster)["dataset"].nunique()
    for k, idx in df.groupby("dataset").indices.items():
        dd = out.dup_drop.values[idx]
        sizes = Counter(cluster[idx][kept.values[idx]])
        rep["per_dataset"][k] = {
            "readable": int(len(idx)),
            "exact_dup_dropped": int(sum(str(x).startswith("exact_dup_of") for x in dd)),
            "phash_dup_dropped": int(sum(str(x).startswith("phash_dup_of") for x in dd)),
            "label_conflict_dropped": int(sum(x == "label_conflict" for x in dd)),
            "kept": int(kept.values[idx].sum()),
            "near_copy_clusters_size_gt1": int(sum(1 for c, s in sizes.items() if s > 1)),
            "images_in_near_copy_clusters": int(sum(s for s in sizes.values() if s > 1)),
            "clusters_spanning_datasets": int(sum(1 for c in sizes if cl_ds.get(c, 1) > 1)),
        }
    json.dump(rep, open(os.path.join(bench, "dedup_report.json"), "w"), indent=1)
    log("dedup report:", json.dumps(rep["per_dataset"])[:2000])
    return out


if __name__ == "__main__":
    run(*sys.argv[1:6])
