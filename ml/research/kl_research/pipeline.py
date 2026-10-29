"""Keep the GPU busy while downloads land: scan each finished dataset, then extract every backbone for it.

Loop: scan datasets whose download has a _DONE marker -> for each backbone in priority order, embed every dataset that
has a scan shard but no feature file -> stop when the fetch job has ended and nothing is pending. Resumable: every
step skips finished work (scan shards and npz files are the state).

Usage: python -m kl_research.pipeline <configs_dir> <raw_root> <bench_dir> <feat_root> <fetch_job_dir> [--only k1,k2]
"""
from __future__ import annotations

import os
import sys
import time

import yaml

from . import features, manifest

ORDER = ["dinov2_b", "bioclip2", "siglip2_b16", "dinov2_l", "pe_core_l", "eva02_l", "siglip2_so400m", "dinov2_g",
         "dinov3_b", "dinov3_l"]
IN_PROCESS = {"dinov2_b", "bioclip2"}   # weights fetched by the library itself; the others wait for prefetch_models


def weights_ready(k: str) -> bool:
    hf = os.environ.get("HF_HOME", r"F:\krishiloop-5090\models\hf")
    return k in IN_PROCESS or os.path.exists(os.path.join(os.path.dirname(hf), "weights_ready", k))


def main(argv):
    cfg_dir, raw_root, bench, feat_root, fetch_job = argv[:5]
    only = argv[argv.index("--only") + 1].split(",") if "--only" in argv else ORDER
    specs = {s["key"]: s for s in yaml.safe_load(open(os.path.join(cfg_dir, "backbones.yaml"), encoding="utf-8"))["backbones"]}
    ds_cfg = os.path.join(cfg_dir, "datasets.yaml")
    fails: dict[str, int] = {}
    while True:
        new = manifest.scan(ds_cfg, raw_root, bench, [])
        did = False
        for k in only:
            if k not in specs or fails.get(k, 0) >= 2 or not weights_ready(k):
                continue
            new_scans = manifest.scan(ds_cfg, raw_root, bench, [])   # pick up datasets that landed meanwhile
            try:
                rec = features.run_backbone(specs[k], bench, feat_root, workers=int(os.environ.get('KL_WORKERS', 6)))
                did = did or rec is not None
            except Exception as e:  # noqa: BLE001
                fails[k] = fails.get(k, 0) + 1
                features.log("BACKBONE FAILED", k, f"(attempt {fails[k]})", repr(e)[:400])
            if new_scans:
                did = True
        fetch_over = os.path.exists(os.path.join(fetch_job, "exit.txt"))
        pend = any(features.pending(bench, os.path.join(feat_root, k)) for k in only if k in specs and fails.get(k, 0) < 2
                   and os.path.isdir(os.path.join(feat_root, k)))
        if fetch_over and not new and not did and not pend:
            features.log("pipeline: downloads finished and every dataset has every backbone; done")
            return
        if not did:
            time.sleep(90)


if __name__ == "__main__":
    main(sys.argv[1:])
