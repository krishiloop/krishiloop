"""One-shot build on the 5090: de-duplicate -> manifest -> text embeddings -> RQ1 (frozen backbones).

Every step is deterministic and can be re-run as more datasets land (the outputs are rebuilt from the scan shards and
feature files). Usage:
    python -m kl_research.build <research_dir_on_5090> <bench_dir> <feat_root> <results_dir> [--no-rq1] [--boot 1000]
"""
from __future__ import annotations

import json
import os
import sys
import time

import yaml

from . import dedup, features, manifest, pipeline, rq1


def main(argv):
    rdir, bench, feat_root, out_dir = argv[:4]
    boot = int(argv[argv.index("--boot") + 1]) if "--boot" in argv else 1000
    cfg = os.path.join(rdir, "configs", "datasets.yaml")
    lm = os.path.join(rdir, "configs", "label_map.csv")
    scr = os.path.join(rdir, "benchmark", "licence_screen.json")
    t0 = time.time()
    dedup.run(cfg, bench, feat_root, lm, scr)
    man = manifest.build(cfg, bench, lm, scr)
    kept = man[man.keep]
    # unmapped labels are logged for review (they are dropped from the benchmark)
    um = man[(man.label == "") & man.ok].groupby(["dataset", "orig_label"]).size()
    json.dump({f"{a}|{b}": int(n) for (a, b), n in um.items()}, open(os.path.join(bench, "unmapped_labels.json"), "w"), indent=1)
    manifest.log(f"unmapped/dropped original labels: {len(um)} (see unmapped_labels.json)")
    # text embeddings for text-capable backbones that have image features
    specs = yaml.safe_load(open(os.path.join(rdir, "configs", "backbones.yaml"), encoding="utf-8"))["backbones"]
    import numpy as np
    import pandas as pd
    want = sorted({c for c in pd.read_csv(lm, dtype=str).fillna("").canonical if c})
    for s in specs:
        fdir = os.path.join(feat_root, s["key"])
        has_feats = os.path.isdir(fdir) and any(f.endswith(".npz") and not f.startswith("_") for f in os.listdir(fdir))
        tp = os.path.join(fdir, "_text.npz")
        stale = (not os.path.exists(tp)) or sorted(np.load(tp, allow_pickle=True)["labels"].tolist()) != want
        if s.get("text") and has_feats and pipeline.weights_ready(s["key"]) and stale:
            try:
                features.text_embeddings(s, lm, os.path.join(rdir, "configs", "prompts.yaml"), feat_root)
            except Exception as e:  # noqa: BLE001
                manifest.log("TEXT FAILED", s["key"], repr(e)[:300])
    summary = {"kept": int(len(kept)), "domains": int(kept.domain.nunique()), "crops": sorted(kept.crop.unique().tolist()),
               "countries": sorted(kept.country.unique().tolist()),
               "domain_counts": {k: int(v) for k, v in kept.domain.value_counts().items()}}
    json.dump(summary, open(os.path.join(bench, "build_summary.json"), "w"), indent=1)
    manifest.log("build summary:", json.dumps(summary)[:1500])
    if "--no-rq1" not in argv:
        os.makedirs(out_dir, exist_ok=True)
        out = os.path.join(out_dir, "rq1_frozen.json")
        res = rq1.run(bench, feat_root, out, None, boot)
        open(os.path.join(out_dir, "rq1_frozen.md"), "w", encoding="utf-8").write(rq1.to_markdown(res))
    manifest.log(f"build done in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main(sys.argv[1:])
