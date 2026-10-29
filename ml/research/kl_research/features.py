"""Frozen-backbone embeddings for every scanned image (PROTOCOL_v1 section M), cached outside git.

Per backbone (configs/backbones.yaml), one pass over every dataset that has a scan shard but no feature file yet:
    <feat_root>/<backbone>/<dataset>.npz   uid (aligned with the manifest), X (float16, L2-normalised), ok
    <feat_root>/<backbone>/_text.npz       labels, T (L2-normalised mean of the prompt embeddings) for text models
    <feat_root>/<backbone>/_meta.json      model id, licence key, resolution, output used, throughput, peak VRAM

What X is:
- open_clip models (BioCLIP 2, SigLIP 2, EVA-02-CLIP, PE-Core): ``encode_image`` = the model's own pooled, projected
  image embedding (the one compared with text), with the model's own open_clip preprocessing.
- timm ViTs (DINOv2, DINOv3): the CLS token after the final norm (``forward_features(x)[:, 0]``), preprocessing =
  resize (bicubic) to res*256/224, centre-crop res, the model's mean/std (official DINOv2 linear-evaluation transform).
Decoding: EXIF orientation applied; JPEGs are decoded with libjpeg DCT scaling to >= 2x the model resolution
(``Image.draft``) before the model's own resize, for throughput. bf16 autocast on the GPU.

Usage: python -m kl_research.features run <backbones.yaml> <bench_dir> <feat_root> [--only k1,k2] [--workers 12]
       python -m kl_research.features text <backbones.yaml> <label_map.csv> <prompts.yaml> <feat_root> [--only ...]
"""
from __future__ import annotations

import json
import os
import sys
import time

import numpy as np

HF_HOME = os.environ.setdefault("HF_HOME", r"F:\krishiloop-5090\models\hf")


def log(*a):
    line = " ".join([time.strftime("%H:%M:%S")] + [str(x) for x in a])
    print(line, flush=True)
    if os.environ.get("KL_LOG"):   # jobs also append to a plain log file (stdout redirection can stay empty)
        with open(os.environ["KL_LOG"], "a", encoding="utf-8") as f:
            f.write(line + "\n")


class ImageList:
    """torch Dataset over image paths; returns (tensor, ok). Defined at module level so Windows spawn can pickle it."""

    def __init__(self, paths, transform, draft_size):
        self.paths, self.transform, self.draft_size = list(paths), transform, draft_size

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, i):
        import torch
        from PIL import Image, ImageOps
        try:
            img = Image.open(self.paths[i])
            if img.format == "JPEG" and self.draft_size:
                img.draft("RGB", (self.draft_size, self.draft_size))
            img = ImageOps.exif_transpose(img).convert("RGB")
            return self.transform(img), True
        except Exception:  # noqa: BLE001
            return None, False


def collate(batch):
    import torch
    ok = [b[1] for b in batch]
    ref = next((b[0] for b in batch if b[1]), None)
    if ref is None:
        return None, torch.tensor(ok)
    x = torch.stack([b[0] if b[1] else torch.zeros_like(ref) for b in batch])
    return x, torch.tensor(ok)


def threaded_batches(ds, bs: int, threads: int, ahead: int = 3):
    """Decode and transform images in a thread pool (PIL and torch release the GIL), a few batches ahead of the GPU."""
    import collections
    from concurrent.futures import ThreadPoolExecutor
    chunks = [list(range(i, min(len(ds), i + bs))) for i in range(0, len(ds), bs)]
    with ThreadPoolExecutor(threads) as ex:
        pend = collections.deque()
        it = iter(chunks)
        for _ in range(ahead):
            c = next(it, None)
            if c is None:
                break
            pend.append(ex.map(ds.__getitem__, c))
        while pend:
            res = list(pend.popleft())
            c = next(it, None)
            if c is not None:
                pend.append(ex.map(ds.__getitem__, c))
            yield collate(res)


def load_backbone(spec: dict, device: str):
    """Returns (encode_fn, transform, res, tokenizer_or_None, model)."""
    import torch
    if spec["kind"] == "open_clip":
        import open_clip
        if spec.get("pretrained"):
            model, _, tf = open_clip.create_model_and_transforms(spec["arch"], pretrained=spec["pretrained"])
        else:
            model, _, tf = open_clip.create_model_and_transforms(spec["arch"])
        model = model.to(device).eval()
        tok = open_clip.get_tokenizer(spec["arch"])
        res = None
        for t in getattr(tf, "transforms", []):
            if hasattr(t, "size"):
                s = t.size
                res = s if isinstance(s, int) else max(s)
        return (lambda x: model.encode_image(x)), tf, res or 224, tok, model
    import timm
    import torchvision.transforms as T
    res = int(spec.get("res", 224))
    model = timm.create_model(spec["arch"], pretrained=True, num_classes=0, img_size=res).to(device).eval()
    cfg = timm.data.resolve_model_data_config(model)
    tf = T.Compose([T.Resize(int(round(res * 256 / 224)), interpolation=T.InterpolationMode.BICUBIC, antialias=True),
                    T.CenterCrop(res), T.ToTensor(), T.Normalize(cfg["mean"], cfg["std"])])
    return (lambda x: model.forward_features(x)[:, 0]), tf, res, None, model


def pending(bench: str, out_dir: str) -> list[str]:
    scan_dir = os.path.join(bench, "scan")
    keys = sorted(f[:-8] for f in os.listdir(scan_dir) if f.endswith(".parquet"))
    return [k for k in keys if not os.path.exists(os.path.join(out_dir, k + ".npz"))]


def wait_for_vram(need_gb: float, max_wait_s: int = 1800):
    import torch
    t0 = time.time()
    while True:
        free, total = torch.cuda.mem_get_info()
        if free / 2**30 >= need_gb or time.time() - t0 > max_wait_s:
            return free / 2**30
        log(f"waiting for VRAM: {free / 2**30:.1f} GB free < {need_gb} GB (the safety eval has priority)")
        time.sleep(60)


def run_backbone(spec: dict, bench: str, feat_root: str, workers: int = 12, batch: int | None = None) -> dict | None:
    import pandas as pd
    import torch
    out_dir = os.path.join(feat_root, spec["key"])
    os.makedirs(out_dir, exist_ok=True)
    todo = pending(bench, out_dir)
    if not todo:
        return None
    frames = []
    for k in todo:
        d = pd.read_parquet(os.path.join(bench, "scan", k + ".parquet"), columns=["uid", "path", "ok"])
        d = d[d.ok]
        d["dataset"] = k
        frames.append(d)
    df = pd.concat(frames, ignore_index=True)
    if df.empty:
        return None
    big = any(s in spec["arch"].lower() for s in ("giant", "so400m", "large", "-l-", "eva02-l", "pe-core-l", "bioclip"))
    bs = batch or (128 if big else 256)
    wait_for_vram(8.0 if big else 4.0)
    device = "cuda"
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.benchmark = True
    t_load = time.time()
    encode, tf, res, _, model = load_backbone(spec, device)
    t_load = time.time() - t_load
    torch.cuda.reset_peak_memory_stats()
    ds = ImageList(df.path.tolist(), tf, 2 * res)
    if os.environ.get("KL_LOADER", "process") == "thread":
        torch.set_num_threads(1)
        dl = threaded_batches(ds, bs, workers)
    else:   # worker processes: ~0.7 GB RAM each on this PC, so keep the count modest (shared 32 GB host)
        from torch.utils.data import DataLoader
        dl = DataLoader(ds, batch_size=bs, num_workers=workers, collate_fn=collate, pin_memory=True,
                        persistent_workers=False, prefetch_factor=4 if workers else None)
    feats = np.zeros((len(df), 0), dtype=np.float16)
    oks = np.zeros(len(df), dtype=bool)
    gpu_s, n_done, t0 = 0.0, 0, time.time()
    warm, gpu_ss, n_ss, t_ss = 2, 0.0, 0, None   # steady state = after the first 2 batches (cudnn autotune, worker start)
    nb = 0
    ends = df.groupby("dataset", sort=False).size().cumsum().to_dict()   # flush each dataset when complete
    order = list(dict.fromkeys(df.dataset.tolist()))
    flushed = set()
    start_ev, end_ev = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
    with torch.inference_mode():
        for x, ok in dl:
            n = len(ok)
            if x is not None:
                x = x.to(device, non_blocking=True)
                start_ev.record()
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    z = encode(x)
                z = torch.nn.functional.normalize(z.float(), dim=-1)
                end_ev.record()
                torch.cuda.synchronize()
                dt = start_ev.elapsed_time(end_ev) / 1000
                gpu_s += dt
                if nb >= warm:
                    gpu_ss += dt
                    n_ss += n
                z = z.cpu().numpy().astype(np.float16)
                if feats.shape[1] == 0:
                    feats = np.zeros((len(df), z.shape[1]), dtype=np.float16)
                feats[n_done:n_done + n] = z
                oks[n_done:n_done + n] = ok.numpy()
            n_done += n
            nb += 1
            if nb == warm:
                t_ss = time.time()
            for k in order:
                if k not in flushed and n_done >= ends[k]:
                    lo = ends[k] - int((df.dataset == k).sum())
                    np.savez(os.path.join(out_dir, k + ".npz"), uid=np.array(df.uid.tolist()[lo:ends[k]], dtype=np.str_),
                             X=feats[lo:ends[k]], ok=oks[lo:ends[k]])
                    flushed.add(k)
                    log(f"{spec['key']}: saved {k} ({ends[k] - lo} images)")
    wall = time.time() - t0
    peak = torch.cuda.max_memory_allocated() / 2**30
    rec = {"backbone": spec["key"], "arch": spec["arch"], "pretrained": spec.get("pretrained"), "res": res,
           "dim": int(feats.shape[1]), "images": int(len(df)), "decoded_ok": int(oks.sum()), "datasets": order,
           "batch": bs, "workers": workers, "loader": os.environ.get("KL_LOADER", "process"), "wall_s": round(wall, 1), "gpu_forward_s": round(gpu_s, 1),
           "img_per_s_end_to_end": round(len(df) / wall, 1), "img_per_s_gpu": round(len(df) / max(gpu_s, 1e-9), 1),
           "steady_images": int(n_ss), "steady_img_per_s_gpu": round(n_ss / gpu_ss, 1) if gpu_ss else None,
           "steady_img_per_s_end_to_end": round(n_ss / (time.time() - t_ss), 1) if (t_ss and n_ss) else None,
           "peak_vram_gb": round(peak, 2), "model_load_s": round(t_load, 1),
           "output": "encode_image (pooled, projected)" if spec["kind"] == "open_clip" else "CLS token after final norm",
           "dtype": "bf16 autocast; stored float16 L2-normalised", "time": time.strftime("%Y-%m-%dT%H:%M:%S"),
           "torch": torch.__version__, "gpu": torch.cuda.get_device_name(0)}
    hist_path = os.path.join(out_dir, "_meta.json")
    hist = json.load(open(hist_path)) if os.path.exists(hist_path) else {"passes": []}
    hist["passes"].append(rec)
    json.dump(hist, open(hist_path, "w"), indent=1)
    log(f"{spec['key']}: {len(df)} images, {rec['img_per_s_end_to_end']} img/s end-to-end, "
        f"{rec['img_per_s_gpu']} img/s GPU-only, peak {peak:.1f} GB")
    del model
    torch.cuda.empty_cache()
    return rec


def text_embeddings(spec: dict, label_map_csv: str, prompts_yaml: str, feat_root: str):
    import pandas as pd
    import torch
    import yaml
    if spec["kind"] != "open_clip" or not spec.get("text"):
        return None
    out = os.path.join(feat_root, spec["key"], "_text.npz")
    cfg = yaml.safe_load(open(prompts_yaml, encoding="utf-8"))
    lm = pd.read_csv(label_map_csv, dtype=str).fillna("")
    labels = sorted({c for c in lm.canonical if c})
    info = {}
    for r in lm.itertuples():
        if r.canonical and r.canonical not in info:
            info[r.canonical] = r
    prompts = {}
    for lab in labels:
        r = info[lab]
        cond = lab.split("/", 1)[1]
        fill = {"crop": r.crop_name, "crop_sci": r.crop_sci, "condition": r.condition_name, "agent": r.agent or r.condition_name}
        tpls = cfg["healthy"] if cond == "healthy" else (cfg["condition_with_agent"] if r.agent else cfg["condition"])
        prompts[lab] = [t.format(**fill) for t in tpls]
    encode, _, _, tok, model = load_backbone(spec, "cuda")
    T = []
    with torch.inference_mode():
        for lab in labels:
            e = model.encode_text(tok(prompts[lab]).to("cuda")).float()
            e = torch.nn.functional.normalize(e, dim=-1).mean(0)
            T.append(torch.nn.functional.normalize(e, dim=0).cpu().numpy())
    os.makedirs(os.path.dirname(out), exist_ok=True)
    np.savez(out, labels=np.array(labels), T=np.stack(T).astype(np.float32), prompts=json.dumps(prompts))
    log(f"{spec['key']}: text embeddings for {len(labels)} labels")
    del model
    torch.cuda.empty_cache()
    return out


def main(argv):
    import yaml
    args = argv[1:]
    only = args[args.index("--only") + 1].split(",") if "--only" in args else None
    workers = int(args[args.index("--workers") + 1]) if "--workers" in args else 12
    pos = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))]
    specs = yaml.safe_load(open(pos[0], encoding="utf-8"))["backbones"]
    if only:
        specs = [s for s in specs if s["key"] in only]
        specs.sort(key=lambda s: only.index(s["key"]))
    if argv[0] == "run":
        for s in specs:
            try:
                run_backbone(s, pos[1], pos[2], workers)
            except Exception as e:  # noqa: BLE001
                log("BACKBONE FAILED", s["key"], repr(e)[:400])
    elif argv[0] == "text":
        for s in specs:
            try:
                text_embeddings(s, pos[1], pos[2], pos[3])
            except Exception as e:  # noqa: BLE001
                log("TEXT FAILED", s["key"], repr(e)[:400])
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
