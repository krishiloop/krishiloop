"""Install the Ask router's text models (ml/ask/models.yaml) into a folder OUTSIDE the repo. Weights never go in git.

Both models already have ONNX exports on Hugging Face (multilingual-e5-small in its own repo; the reranker as
onnx-community's conversion of Alibaba-NLP/gte-multilingual-reranker-base), so nothing is converted here and no
model code is executed: the script downloads exactly the pinned files, checks each one's size and sha256 against
models.yaml, writes meta.json per model plus manifest.json, and runs a CPU smoke test (English and Bangla).

    .venv/Scripts/python ml/ask/export_text_models.py                  # -> <repo>/../../models/ask (fp32 reranker)
    .venv/Scripts/python ml/ask/export_text_models.py --reranker int8  # smaller reranker for a small CPU server
    .venv/Scripts/python ml/ask/export_text_models.py --check-only     # verify an existing install, download nothing

Then start the API with KRISHILOOP_ASK_MODELS=<that folder>. Without it the router runs on BM25 alone and says so.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SPEC = Path(__file__).resolve().parent / "models.yaml"
DEFAULT_OUT = ROOT.parent.parent / "models" / "ask"     # D:\AI_congress\models\ask on the team machine
CHUNK = 1 << 20


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def _fetch(repo: str, revision: str, rel: str, size: int, sha256: str, dest: Path) -> None:
    """Download one pinned file unless an identical copy is already there; refuse anything that does not match."""
    if dest.exists() and dest.stat().st_size == size and _sha256(dest) == sha256:
        print(f"  ok (already installed)  {dest.name}")
        return
    url = f"https://huggingface.co/{repo}/resolve/{revision}/{rel}"
    part = dest.with_name(dest.name + ".partial")
    h, got, t0 = hashlib.sha256(), 0, time.time()
    with urllib.request.urlopen(url, timeout=60) as r, part.open("wb") as out:
        while True:
            block = r.read(CHUNK)
            if not block:
                break
            out.write(block)
            h.update(block)
            got += len(block)
            if got % (64 * CHUNK) < CHUNK:
                print(f"    {dest.name}: {got / 1e6:.0f} / {size / 1e6:.0f} MB", flush=True)
    if got != size or h.hexdigest() != sha256:
        part.unlink(missing_ok=True)
        raise SystemExit(f"REFUSED {repo}/{rel}: size {got} (want {size}), sha256 {h.hexdigest()} (want {sha256})")
    os.replace(part, dest)
    print(f"  ok (downloaded, sha256 verified, {time.time() - t0:.0f}s)  {dest.name}")


def _meta(role: str, spec: dict, files: dict[str, dict], variant: str | None) -> dict:
    keep = ("name", "role", "repo", "revision", "base_model", "base_revision", "card", "licence", "licence_evidence",
            "bangla_evidence", "parameters", "onnx_source", "query_prefix", "passage_prefix", "pooling", "max_length")
    meta = {k: spec[k] for k in keep if k in spec}
    meta.update(kind=role, variant=variant or "fp32",
                files={name: {"source": f["path"], "sha256": f["sha256"], "size": f["size"]} for name, f in files.items()})
    return meta


def install(out: Path, reranker_variant: str, check_only: bool) -> dict:
    spec = yaml.safe_load(SPEC.read_text(encoding="utf-8"))
    manifest = {"installed_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                "spec": "ml/ask/models.yaml", "models": {}}
    for role in ("embedder", "reranker"):
        m = spec[role]
        files = dict(m["files"])
        variant = None
        if role == "reranker":
            variant = reranker_variant
            files = {"model.onnx": m["variants"][variant], **files}
        d = out / role
        d.mkdir(parents=True, exist_ok=True)
        print(f"{role}: {m['repo']}@{m['revision'][:12]} ({m['licence']})")
        for name, f in files.items():
            dest = d / name
            if check_only:
                ok = dest.exists() and dest.stat().st_size == f["size"] and _sha256(dest) == f["sha256"]
                print(f"  {'ok' if ok else 'MISSING OR CHANGED'}  {dest.name}")
                if not ok:
                    raise SystemExit(1)
            else:
                _fetch(m["repo"], m["revision"], f["path"], f["size"], f["sha256"], dest)
        meta = _meta(role, m, files, variant)
        (d / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        manifest["models"][role] = {k: meta[k] for k in ("name", "repo", "revision", "licence", "variant")}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def smoke(out: Path) -> None:
    """Load both models the way the API does and score one English and one Bangla pair."""
    os.environ["KRISHILOOP_ASK_MODELS"] = str(out)
    from services.ask import models
    emb, rr = models.load_embedder(), models.load_reranker()
    print("smoke test:", "embedder", "ok" if emb else models.load_errors(), "| reranker", "ok" if rr else models.load_errors())
    if not (emb and rr):
        raise SystemExit(1)
    qs = ["When should I harvest my potatoes?", "ধান কাটার সঠিক সময় কখন?"]
    ps = ["Harvest on time and avoid working in the field when it is humid.",
          "কাটার আগে ধান পাকা কি না দেখুন: শিষের মাথার ১০০টি ধানের ৮০টির চাল শক্ত হলে ধান পাকা।",
          "Make high, well-formed hills."]
    t0 = time.time()
    q, p = emb.embed(qs, "query"), emb.embed(ps, "passage")
    print(f"  embed: {q.shape} + {p.shape} in {1000 * (time.time() - t0):.0f} ms; cosine:")
    for i, text in enumerate(qs):
        print(f"    {text[:40]:42s}", " ".join(f"{s:.3f}" for s in (p @ q[i])))
    t0 = time.time()
    for text in qs:
        print(f"    rerank {text[:34]:36s}", " ".join(f"{s:.3f}" for s in rr.score(text, ps)))
    print(f"  rerank: {1000 * (time.time() - t0):.0f} ms for {2 * len(ps)} pairs")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"install folder (default {DEFAULT_OUT})")
    ap.add_argument("--reranker", choices=("fp32", "int8"), default="fp32", help="reranker weights (int8: ~0.34 GB)")
    ap.add_argument("--check-only", action="store_true", help="verify an existing install; download nothing")
    ap.add_argument("--no-smoke", action="store_true", help="skip the CPU smoke test")
    args = ap.parse_args()
    if args.out.resolve().is_relative_to(ROOT.resolve()):
        raise SystemExit("refusing to install model weights inside the repository")
    print(json.dumps(install(args.out, args.reranker, args.check_only)["models"], indent=2))
    if not args.no_smoke:
        smoke(args.out)
    print(f"\nset KRISHILOOP_ASK_MODELS={args.out}")
