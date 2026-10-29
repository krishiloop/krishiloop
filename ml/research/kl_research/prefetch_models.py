"""Prefetch backbone weights from the Hugging Face CDN in parallel byte ranges, straight into the HF cache layout
(models--org--name/snapshots/<commit>/<file> + refs/main), so timm / open_clip find them locally. A marker file
<HF_HOME>/../weights_ready/<backbone> tells the pipeline a backbone is ready. Connections: KL_CDN_CONN (default 2).

Usage: python -m kl_research.prefetch_models <backbones.yaml> [k1,k2,...]
"""
from __future__ import annotations

import os
import sys

import yaml

from . import fetch, sources

HF_HOME = os.environ.setdefault("HF_HOME", r"F:\krishiloop-5090\models\hf")
READY = os.path.join(os.path.dirname(HF_HOME), "weights_ready")
PREFER = ("open_clip_model.safetensors", "model.safetensors", "open_clip_pytorch_model.bin", "pytorch_model.bin")


def repo_for(spec: dict) -> str:
    if spec["kind"] == "timm":
        return "timm/" + spec["arch"]
    if str(spec["arch"]).startswith("hf-hub:"):
        return spec["arch"][len("hf-hub:"):]
    import open_clip
    cfg = open_clip.get_pretrained_cfg(spec["arch"], spec["pretrained"])
    return cfg["hf_hub"].strip("/")


def prefetch(spec: dict) -> str:
    repo = repo_for(spec)
    info = sources.http_get(f"https://huggingface.co/api/models/{repo}?blobs=true")
    sha = info["sha"]
    sizes = {s["rfilename"]: s.get("size") for s in info.get("siblings", [])}
    fname = next((f for f in PREFER if f in sizes), None)
    if fname is None:
        raise RuntimeError(f"no weight file in {repo}: {list(sizes)[:10]}")
    base = os.path.join(HF_HOME, "hub", "models--" + repo.replace("/", "--"))
    dest = os.path.join(base, "snapshots", sha, fname)
    url = f"https://huggingface.co/{repo}/resolve/{sha}/{fname}"
    fetch.log(f"{spec['key']}: {repo}@{sha[:8]} {fname} {(sizes[fname] or 0) / 1e9:.2f} GB")
    fetch.download(url, dest, sizes[fname])
    os.makedirs(os.path.join(base, "refs"), exist_ok=True)
    ref = os.path.join(base, "refs", "main")
    if not os.path.exists(ref):
        open(ref, "w").write(sha)
    os.makedirs(READY, exist_ok=True)
    open(os.path.join(READY, spec["key"]), "w").write(f"{repo}@{sha}/{fname}\n")
    return dest


def main(argv):
    specs = yaml.safe_load(open(argv[0], encoding="utf-8"))["backbones"]
    order = argv[1].split(",") if len(argv) > 1 else [s["key"] for s in specs]
    by = {s["key"]: s for s in specs}
    for k in order:
        if os.path.exists(os.path.join(READY, k)):
            continue
        try:
            prefetch(by[k])
        except Exception as e:  # noqa: BLE001
            fetch.log(f"{k}: PREFETCH FAILED {e!r}"[:400])


if __name__ == "__main__":
    main(sys.argv[1:])
