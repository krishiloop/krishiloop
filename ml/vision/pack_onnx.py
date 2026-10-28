"""Pack Kaggle ONNX exports into single files, quantize to int8, and sanity-check them.

The torch dynamo exporter writes weights to `<name>.onnx.data`. This script folds them into
`<name>_fp32.onnx` and writes `<name>_int8.onnx`:
- with a calibration folder: static QDQ, per-channel weights (dynamic quantization breaks
  MobileNetV4's depthwise convolutions: fp32/int8 top-1 agreement fell to 0.43);
- without one: dynamic weight quantization.

Given a folder of labelled images (`<dir>/<class>/*.jpg`), it reports fp32 accuracy, fp32-vs-int8
agreement and CPU latency. Sample images may overlap the training set, so the accuracy is a
preprocessing sanity check only, never a reported metric. Calibration images must not overlap
the sample images.

Usage: python ml/vision/pack_onnx.py [artifacts_dir] [sample_dir] [calibration_dir]
"""
from __future__ import annotations

import json
import statistics
import sys
import time
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnxruntime.quantization import (CalibrationDataReader, CalibrationMethod, QuantFormat, QuantType, quantize_dynamic,
                                      quantize_static)
from onnxruntime.quantization.shape_inference import quant_pre_process
from PIL import Image

ART = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / "artifacts"
SAMPLE = Path(sys.argv[2]) if len(sys.argv) > 2 else None
CALIB = Path(sys.argv[3]) if len(sys.argv) > 3 else None
MODELS = ("mnv4_union", "dinov2_probe_union")
INT8 = {"mnv4_union"}  # percentile calibration of the 87 MB ViT runs out of memory on a 16 GB laptop; it is not an on-device candidate
MEAN, STD = np.array([0.485, 0.456, 0.406], np.float32), np.array([0.229, 0.224, 0.225], np.float32)
# folder names in the source datasets → union label names (same synonyms as the Kaggle kernel)
SYN = {"blast": "rice_blast", "normal": "healthy", "bacterial_blight": "bacterial_leaf_blight", "brownspot": "brown_spot"}


def fp16_weights(src: Path, dst: Path) -> None:
    """Store float initializers as fp16 and Cast them back to fp32 at load: half the download, fp32 compute."""
    m = onnx.load(str(src))
    casts, keep = [], []
    for init in m.graph.initializer:
        if init.data_type == onnx.TensorProto.FLOAT and np.prod(init.dims) >= 1024:
            arr = onnx.numpy_helper.to_array(init).astype(np.float16)
            half = onnx.numpy_helper.from_array(arr, init.name + "__fp16")
            keep.append(half)
            casts.append(onnx.helper.make_node("Cast", [half.name], [init.name], to=onnx.TensorProto.FLOAT, name=init.name + "__cast"))
        else:
            keep.append(init)
    del m.graph.initializer[:]
    m.graph.initializer.extend(keep)
    nodes = casts + list(m.graph.node)
    del m.graph.node[:]
    m.graph.node.extend(nodes)
    onnx.save(m, str(dst), save_as_external_data=False)
    onnx.checker.check_model(str(dst))


class Images(CalibrationDataReader):
    def __init__(self, files: list[Path]):
        self.it = iter([{"image": preprocess(f)} for f in files])

    def get_next(self):
        return next(self.it, None)


def pack(name: str, calib: list[Path], int8_too: bool) -> dict[str, Path]:
    m = onnx.load(str(ART / f"{name}.onnx"))  # pulls in <name>.onnx.data from the same folder
    del m.graph.value_info[:]  # stale shapes from the exporter break quantization shape inference
    fp32 = ART / f"{name}_fp32.onnx"
    onnx.save(m, str(fp32), save_as_external_data=False)
    onnx.checker.check_model(str(fp32))
    fp16w = ART / f"{name}_fp16w.onnx"
    fp16_weights(fp32, fp16w)
    if not int8_too:
        return {"fp32": fp32, "fp16w": fp16w}
    int8 = ART / f"{name}_int8.onnx"
    if calib:
        pre = ART / f"{name}_pre.onnx"
        quant_pre_process(str(fp32), str(pre), skip_symbolic_shape=True)  # symbolic inference fails on the ViT's Expand
        # percentile calibration: min-max and entropy gave 0.42 agreement on MobileNetV4 (activation outliers)
        quantize_static(str(pre), str(int8), Images(calib), quant_format=QuantFormat.QDQ, per_channel=True,
                        activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8,
                        calibrate_method=CalibrationMethod.Percentile,
                        nodes_to_exclude=[n.name for n in m.graph.node if n.op_type == "Softmax"])
        pre.unlink()
    else:
        quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8)
    return {"fp32": fp32, "fp16w": fp16w, "int8": int8}


def preprocess(path: Path) -> np.ndarray:
    """Resize(256) on the short side → CenterCrop(224) → ImageNet normalisation, as in tf_eval."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    s = 256 / min(w, h)
    im = im.resize((round(w * s), round(h * s)), Image.BILINEAR)
    w, h = im.size
    left, top = (w - 224) // 2, (h - 224) // 2
    x = (np.asarray(im.crop((left, top, left + 224, top + 224)), np.float32) / 255.0 - MEAN) / STD
    return x.transpose(2, 0, 1)[None]


def main() -> None:
    labels = json.loads((ART / "label_map_union.json").read_text())["labels"]
    report: dict = {"labels": labels, "models": {}}
    samples = []
    if SAMPLE:
        for d in sorted(p for p in SAMPLE.iterdir() if p.is_dir()):
            lab = SYN.get(d.name, d.name)
            if lab in labels:
                samples += [(f, labels.index(lab)) for f in sorted(d.iterdir())]
    xs = [preprocess(f) for f, _ in samples]
    calib = sorted(CALIB.rglob("*.jpg")) if CALIB else []
    report["int8_method"] = f"static QDQ per-channel, {len(calib)} calibration images" if calib else "dynamic"
    for name in MODELS:
        files = pack(name, calib, name in INT8)
        r = {f"{k}_mb": round(p.stat().st_size / 1e6, 2) for k, p in files.items()}
        sess = {k: ort.InferenceSession(str(p), providers=["CPUExecutionProvider"]) for k, p in files.items()}
        for k, s in sess.items():
            x0 = xs[0] if xs else np.zeros((1, 3, 224, 224), np.float32)
            s.run(None, {"image": x0})
            t = []
            for _ in range(20):
                t0 = time.perf_counter(); s.run(None, {"image": x0}); t.append((time.perf_counter() - t0) * 1000)
            r[f"{k}_cpu_ms_median"] = round(statistics.median(t), 1)
        if xs:
            probs = {k: np.concatenate([s.run(None, {"image": x})[0] for x in xs]) for k, s in sess.items()}
            y = np.array([t for _, t in samples])
            r.update({"n_sample": len(xs), "prob_sum_ok": bool(np.allclose(probs["fp32"].sum(1), 1, atol=1e-3)),
                      "sanity_top1_fp32": round(float((probs["fp32"].argmax(1) == y).mean()), 3)})
            for k in [k for k in ("fp16w", "int8") if k in probs]:
                r[f"agreement_fp32_{k}"] = round(float((probs["fp32"].argmax(1) == probs[k].argmax(1)).mean()), 3)
                r[f"max_abs_prob_diff_{k}"] = round(float(np.abs(probs["fp32"] - probs[k]).max()), 4)
        report["models"][name] = r
        print(name, json.dumps(r), flush=True)
    (ART / "onnx_pack_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
