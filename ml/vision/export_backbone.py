"""Export the photo backbone for the server (services/vision/backbone.py): vision tower ONNX + class text embeddings.

BioCLIP 2 (hf-hub:imageomics/bioclip-2) won the earned-trust simulations (analysis/earned_trust_sim_v2.py), so it is
the default. The class descriptions are the ones fixed before the v2 study (kaggle/krishilens_v2_probe.py PROMPTS),
so the server's zero-shot start is the one that was measured.

Parity checks written to <out>/export_report.json:
  1. ONNX vs PyTorch on the same tensor (max abs difference, cosine);
  2. the server's own preprocessing (backbone.py, Pillow) vs open_clip's (torchvision) on the same JPEG (cosine);
  3. text embeddings vs the ones saved by the Kaggle run (artifacts/emb_bioclip2.npz), if present.
Usage: python ml/vision/export_backbone.py <out_dir> [--name krishilens-bioclip2 --version 1]
"""
import hashlib
import io
import json
import re
import sys
from pathlib import Path

import numpy as np
import open_clip
import torch
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[1])
NAME = sys.argv[sys.argv.index("--name") + 1] if "--name" in sys.argv else "krishilens-bioclip2"
VERSION = sys.argv[sys.argv.index("--version") + 1] if "--version" in sys.argv else "1"
ARCH = "hf-hub:imageomics/bioclip-2"


def kaggle_prompts() -> tuple[list[str], dict]:
    """CORE and PROMPTS exactly as the v2 study used them (parsed from the kernel source, not retyped)."""
    src = (HERE / "kaggle" / "krishilens_v2_probe.py").read_text(encoding="utf-8")
    core = eval(re.search(r"^CORE = (\[.*?\])$", src, re.M).group(1))
    prompts = eval(re.search(r"^PROMPTS = (\{.*?^\})$", src, re.M | re.S).group(1))
    return core, prompts


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    model, _, preprocess = open_clip.create_model_and_transforms(ARCH)
    model.eval()
    tok = open_clip.get_tokenizer(ARCH)
    core, prompts = kaggle_prompts()
    with torch.no_grad():
        T = []
        for c in core:
            e = model.encode_text(tok(prompts[c])).float()
            e = e / e.norm(dim=-1, keepdim=True)
            m = e.mean(0)
            T.append((m / m.norm()).numpy())
    T = np.stack(T)
    np.savez(OUT / "text.npz", labels=np.array(core), T=T)

    # vision tower -> ONNX (single file, legacy exporter as in kaggle/krishilens_v1_lodo.py)
    class Vision(torch.nn.Module):
        def __init__(self, m):
            super().__init__(); self.m = m

        def forward(self, x):
            return self.m.encode_image(x)
    size = preprocess.transforms[1].size if hasattr(preprocess.transforms[1], "size") else 224
    size = size[0] if isinstance(size, (tuple, list)) else int(size)
    norm = next(t for t in preprocess.transforms if t.__class__.__name__ == "Normalize")
    vision = Vision(model).eval()
    x = torch.randn(1, 3, size, size)
    onnx_path = OUT / "vision.onnx"
    torch.onnx.export(vision, x, str(onnx_path), input_names=["image"], output_names=["features"], opset_version=17,
                      dynamic_axes={"image": {0: "b"}, "features": {0: "b"}}, dynamo=False)
    meta = {"name": NAME, "version": VERSION, "arch": ARCH, "size": size, "mean": list(map(float, norm.mean)),
            "std": list(map(float, norm.std)), "labels": core, "prompts_from": "ml/vision/kaggle/krishilens_v2_probe.py"}
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    # parity
    import onnxruntime as ort
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    with torch.no_grad():
        ref = vision(x).numpy()
    got = sess.run(None, {"image": x.numpy()})[0]
    cos = lambda a, b: float((a * b).sum() / (np.linalg.norm(a) * np.linalg.norm(b)))
    report = {"onnx_vs_torch": {"max_abs_diff": float(np.abs(ref - got).max()), "cosine": cos(ref[0], got[0])}}

    rng = np.random.RandomState(0)   # a textured test JPEG, not a real photo
    img = Image.fromarray((np.clip(rng.rand(480, 640, 3) * 0.4 + np.linspace(0, 0.6, 640)[None, :, None], 0, 1) * 255).astype(np.uint8))
    buf = io.BytesIO(); img.save(buf, "JPEG", quality=92); jpeg = buf.getvalue()
    sys.path.insert(0, str(HERE.parents[1]))
    import os
    os.environ["KRISHILENS_DIR"] = str(OUT)
    from services.vision.backbone import Backbone
    server = Backbone(OUT).features(jpeg)
    with torch.no_grad():
        theirs = vision(preprocess(Image.open(io.BytesIO(jpeg)).convert("RGB"))[None]).numpy()[0]
    report["server_preprocessing_vs_open_clip"] = {"cosine": cos(server, theirs)}

    saved = HERE / "artifacts" / "emb_bioclip2.npz"
    if saved.exists():
        Tk = np.load(saved)["T"]
        report["text_vs_kaggle_run"] = {"max_abs_diff": float(np.abs(Tk - T).max()),
                                        "min_cosine": float(min(cos(a, b) for a, b in zip(Tk, T)))}
    report["vision_onnx_sha256"] = hashlib.sha256(onnx_path.read_bytes()).hexdigest()
    report["vision_onnx_mb"] = round(onnx_path.stat().st_size / 1e6, 1)
    (OUT / "export_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
