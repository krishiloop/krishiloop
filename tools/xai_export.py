"""Write model_xai.onnx: the AgriTriage-Lite student with extra graph outputs for real explainability.

The weights are the same, byte for byte (`weights_sha256` below is computed over every initializer, before and after),
and the logits are the same (the export records the source model's logits on fixed test inputs; tests/test_agritriage_xai.py
checks model_xai.onnx gives them back). Only outputs and a few small nodes are added, so the file is ~11.5 MB, not two:
the site serves model_xai.onnx alone and model.onnx is dropped.

Why the head allows an EXACT class activation map (CAM). TinyViT-11M ends with
    F (C x 7 x 7, the stage-3 feature map) -> GlobalAveragePool -> v -> LayerNorm(gamma, beta) -> Linear(W, b) -> logits.
With mu and sigma the mean and standard deviation of v over its C channels (LayerNorm's own statistics, eps inside sigma),
    LN(v) = gamma * (v - mu) / sigma + beta, and v = mean over the 49 cells of F_xy, so
    logit_c = sum over cells of [ W_c . (gamma * (F_xy - mu) / sigma) / 49 ]  +  ( b_c + W_c . beta ).
The bracket is the cell's share of the score (`xai_cam`, for every class); the rest is a fixed per-class bias that does
not depend on the photo (`xai_cam_bias`). The 49 cells plus the bias give back the logit to float error.

Added outputs (logits stays output 0):
    xai_cam        [B, 89, 49]   each 7 x 7 cell's share of each class's logit (row-major cells)
    xai_cam_bias   [89]          b + W . beta (the part no cell owns)
    xai_gradcam    [B, 89, 49]   Grad-CAM before its ReLU: sum over channels k of alpha_ck * F_k,cell, where alpha_ck is
                                 the mean over the 49 cells of d logit_c / d F_k,cell, i.e. (1/49) d logit_c / d v_k. That
                                 gradient is exact (analytic through LayerNorm, its mu and sigma included):
                                 d logit_c / d v_k = (1/sigma) [ w~_ck - mean_i w~_ci - y_k * mean_i (w~_ci * y_i) ],
                                 with w~ = W * gamma and y = (v - mu) / sigma. The export checks it against a numerical
                                 (central difference) gradient in numpy.
    xai_attn3_0    [B, 14, 49, 49]   stage-3 block-0 attention (softmax over keys; one 7 x 7 window = the whole image)
    xai_attn3_1    [B, 14, 49, 49]   stage-3 block-1 attention
    xai_attn2_5    [B, 8, 196, 196]  the last stage-2 attention (one 14 x 14 window = the whole image)
    xai_feat       [B, 448, 7, 7]    the pre-pool stage-3 feature map (so a test can redo the CAM in numpy)

    .venv/Scripts/python.exe -m tools.xai_export           # reads model.onnx, or re-exports a previous model_xai.onnx
    .venv/Scripts/python.exe -m tools.xai_export fixture   # rewrites apps/web/src/lib/agritriage/xai.fixture.json
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "apps" / "web" / "public" / "models" / "agritriage"
SRC, OUT = MODEL_DIR / "model.onnx", MODEL_DIR / "model_xai.onnx"
EVIDENCE = MODEL_DIR / "evidence" / "xai_export.json"
FIXTURE = ROOT / "apps" / "web" / "src" / "lib" / "agritriage" / "xai.fixture.json"

FEAT = "/stages/stages.3/Transpose_1_output_0"
POOL = "/head/global_pool/pool/GlobalAveragePool_output_0"
HEAD_LN = "/head/norm/LayerNormalization"
W_NAME, B_NAME = "classifier.weight", "classifier.bias"            # W is the output of a DequantizeLinear (INT8 weights)
GAMMA, BETA = "backbone.head.norm.weight", "backbone.head.norm.bias"
ATTN = {"xai_attn3_0": "/stages/stages.3/blocks/blocks.0/attn/Softmax_output_0",
        "xai_attn3_1": "/stages/stages.3/blocks/blocks.1/attn/Softmax_output_0",
        "xai_attn2_5": "/stages/stages.2/blocks/blocks.5/attn/Softmax_output_0"}
PREFIX = "xai/"          # every added node and constant
OUTPUTS = ["xai_cam", "xai_cam_bias", "xai_gradcam", "xai_attn3_0", "xai_attn3_1", "xai_attn2_5", "xai_feat"]
TEST_SEEDS = (0, 1, 2)   # fixed inputs: numpy PCG64 uniform [0, 1) images, the same on every machine


def weights_sha256(model) -> str:
    """sha256 over every initializer (name and raw bytes, sorted by name), leaving out the few XAI constants."""
    from onnx import numpy_helper
    h = hashlib.sha256()
    for t in sorted(model.graph.initializer, key=lambda t: t.name):
        if t.name.startswith(PREFIX):
            continue
        h.update(t.name.encode())
        h.update(np.ascontiguousarray(numpy_helper.to_array(t)).tobytes())
    return h.hexdigest()


def strip_xai(model) -> None:
    """Remove what an earlier export added, so the export can run again from model_xai.onnx."""
    g = model.graph
    keep = [n for n in g.node if not n.name.startswith(PREFIX)]
    del g.node[:]
    g.node.extend(keep)
    outs = [o for o in g.output if not o.name.startswith("xai_")]
    del g.output[:]
    g.output.extend(outs)
    inits = [t for t in g.initializer if not t.name.startswith(PREFIX)]
    del g.initializer[:]
    g.initializer.extend(inits)


def add_xai(model) -> None:
    from onnx import TensorProto, helper, numpy_helper
    g = model.graph
    names = {o for n in g.node for o in n.output} | {t.name for t in g.initializer}
    for need in (FEAT, POOL, W_NAME, B_NAME, GAMMA, BETA, *ATTN.values()):
        if need not in names:
            raise SystemExit(f"the model has no tensor {need!r}: not the TinyViT-11M AgriTriage student?")
    ln = next(n for n in g.node if n.name == HEAD_LN)
    eps = next((helper.get_attribute_value(a) for a in ln.attribute if a.name == "epsilon"), 1e-5)
    inits = {t.name: numpy_helper.to_array(t) for t in g.initializer}
    C = int(inits[GAMMA].shape[0])
    N = 49

    def const(name: str, value) -> str:
        g.initializer.append(numpy_helper.from_array(np.asarray(value), PREFIX + name))
        return PREFIX + name

    def node(op: str, inputs: list[str], name: str, **attrs) -> str:
        out = PREFIX + name
        g.node.append(helper.make_node(op, inputs, [out], name=out, **attrs))
        return out

    # LayerNorm's statistics of the pooled vector v [B, C, 1, 1] over its channels
    mu = node("ReduceMean", [POOL], "mu", axes=[1], keepdims=1)
    vc = node("Sub", [POOL, mu], "v_centred")
    var = node("ReduceMean", [node("Mul", [vc, vc], "v_sq")], "var", axes=[1], keepdims=1)
    sigma = node("Sqrt", [node("Add", [var, const("eps", np.float32(eps))], "var_eps")], "sigma")
    # each cell, normalised with the IMAGE's mu and sigma and scaled by gamma: [B, C, 7, 7] -> [B, C, 49]
    fc = node("Sub", [FEAT, mu], "f_centred")
    fn = node("Div", [fc, sigma], "f_norm")
    gam = node("Reshape", [GAMMA, const("shape_c11", np.array([C, 1, 1], dtype=np.int64))], "gamma_c11")
    fr = node("Reshape", [node("Mul", [fn, gam], "f_gamma"), const("shape_bcn", np.array([-1, C, N], dtype=np.int64))], "f_cells")
    # W [K, C] @ [B, C, 49] -> [B, K, 49], divided by 49: each cell's share of each logit
    cam = node("MatMul", [W_NAME, fr], "cam_sum")
    g.node.append(helper.make_node("Div", [cam, const("n_cells", np.float32(N))], ["xai_cam"], name=PREFIX + "cam"))
    # Grad-CAM: the exact gradient of every logit with respect to the pooled vector v, through LayerNorm (above)
    wt = node("Mul", [W_NAME, GAMMA], "w_tilde")                                                     # [K, C]
    m1 = node("ReduceMean", [wt], "w_tilde_mean", axes=[1], keepdims=1)                              # [K, 1]
    y = node("Reshape", [node("Div", [vc, sigma], "y_c11"), const("shape_bc1", np.array([-1, C, 1], dtype=np.int64))], "y_bc1")
    m2 = node("Div", [node("MatMul", [wt, y], "wy"), const("n_ch", np.float32(C))], "wy_mean")      # [B, K, 1]
    y_row = node("Reshape", [y, const("shape_b1c", np.array([-1, 1, C], dtype=np.int64))], "y_b1c")  # [B, 1, C]
    sig = node("Reshape", [sigma, const("shape_b11", np.array([-1, 1, 1], dtype=np.int64))], "sigma_b11")
    grad = node("Div", [node("Sub", [node("Sub", [wt, m1], "wt_centred"), node("Mul", [m2, y_row], "wy_y")], "grad_num"), sig], "grad_v")  # [B, K, C]
    alpha = node("Div", [grad, const("n_cells_g", np.float32(N))], "alpha")                         # mean gradient per cell
    f_raw = node("Reshape", [FEAT, const("shape_bcn_raw", np.array([-1, C, N], dtype=np.int64))], "f_raw_cells")
    g.node.append(helper.make_node("MatMul", [alpha, f_raw], ["xai_gradcam"], name=PREFIX + "gradcam"))   # [B, K, 49]
    wb = node("MatMul", [W_NAME, BETA], "w_beta")
    g.node.append(helper.make_node("Add", [B_NAME, wb], ["xai_cam_bias"], name=PREFIX + "cam_bias"))
    for out, src in ATTN.items():
        g.node.append(helper.make_node("Identity", [src], [out], name=PREFIX + out))
    g.node.append(helper.make_node("Identity", [FEAT], ["xai_feat"], name=PREFIX + "feat"))
    K = int(inits[B_NAME].shape[0])
    shapes = {"xai_cam": ["batch", K, N], "xai_cam_bias": [K], "xai_gradcam": ["batch", K, N], "xai_attn3_0": ["batch", 14, N, N],
              "xai_attn3_1": ["batch", 14, N, N], "xai_attn2_5": ["batch", 8, 196, 196], "xai_feat": ["batch", C, 7, 7]}
    for out in OUTPUTS:
        g.output.append(helper.make_tensor_value_info(out, TensorProto.FLOAT, shapes[out]))


def gradcam_check(model, outs) -> tuple[float, float]:
    """Redo Grad-CAM in numpy for the top class of each test input: the gradient of the logit with respect to the pooled
    vector by central differences (no formula), then alpha = gradient / 49 and the map = alpha . F. Returns the largest
    relative errors: the formula's gradient against the numerical one, and the graph's map against the numerical map."""
    from onnx import helper, numpy_helper
    g = model.graph
    inits = {t.name: numpy_helper.to_array(t) for t in g.initializer}
    dq = next(n for n in g.node if W_NAME in n.output)                       # DequantizeLinear: (q - zero) * scale
    q, scale = inits[dq.input[0]].astype(np.float64), inits[dq.input[1]].astype(np.float64)
    zero = inits[dq.input[2]].astype(np.float64) if len(dq.input) > 2 else 0.0
    axis = next((helper.get_attribute_value(a) for a in dq.attribute if a.name == "axis"), 1)
    shp = [1] * q.ndim
    if np.ndim(scale):
        shp[axis] = -1
    W = (q - np.reshape(zero, shp)) * np.reshape(scale, shp)
    gamma, beta, b = (inits[n].astype(np.float64) for n in (GAMMA, BETA, B_NAME))
    ln = next(n for n in g.node if n.name == HEAD_LN)
    eps = next((helper.get_attribute_value(a) for a in ln.attribute if a.name == "epsilon"), 1e-5)
    F = outs["xai_feat"].astype(np.float64)                                   # [B, C, 7, 7]
    B, C = F.shape[:2]
    cells = F.reshape(B, C, -1)
    grad_err = gc_err = 0.0
    for i in range(B):
        c = int(np.argmax(outs["logits"][i]))

        def logit(v: np.ndarray) -> float:
            y = (v - v.mean()) / np.sqrt(v.var() + eps)
            return float(W[c] @ (gamma * y + beta) + b[c])

        v = cells[i].mean(-1)
        h = 1e-3
        num = np.array([(logit(v + h * e) - logit(v - h * e)) / (2 * h) for e in np.eye(C)])
        gc_num = (num / cells.shape[-1]) @ cells[i]                             # alpha . F over the 49 cells
        gc_graph = outs["xai_gradcam"][i, c].astype(np.float64)
        # the formula's gradient in numpy too, so a wrong formula and a wrong graph cannot agree by accident
        y = (v - v.mean()) / np.sqrt(v.var() + eps)
        wt = W[c] * gamma
        ana = (wt - wt.mean() - y * (wt * y).mean()) / np.sqrt(v.var() + eps)
        grad_err = max(grad_err, float(np.abs(ana - num).max() / (np.abs(num).max() + 1e-12)))
        gc_err = max(gc_err, float(np.abs(gc_graph - gc_num).max() / (np.abs(gc_num).max() + 1e-12)))
    return grad_err, gc_err


def session(raw: bytes):
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.add_session_config_entry("session.disable_quant_qdq", "1")    # as the phone and the server run it
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(raw, so, providers=["CPUExecutionProvider"])


def test_inputs() -> np.ndarray:
    return np.concatenate([np.random.default_rng(s).random((1, 3, 224, 224), dtype=np.float32) for s in TEST_SEEDS])


def main() -> int:
    import onnx
    src = SRC if SRC.exists() else OUT
    if not src.exists():
        print(f"no model at {SRC} or {OUT}", file=sys.stderr)
        return 1
    raw_src = src.read_bytes()
    model = onnx.load_from_string(raw_src)
    strip_xai(model)
    w_before = weights_sha256(model)
    plain = model.SerializeToString()                     # the classifier alone (what model.onnx was)
    x = test_inputs()
    z_src = session(plain).run(["logits"], {"image": x})[0]
    add_xai(model)
    onnx.checker.check_model(model)
    raw = model.SerializeToString()
    if weights_sha256(onnx.load_from_string(raw)) != w_before:
        raise SystemExit("the weights changed: refusing to write")
    s = session(raw)
    outs = dict(zip(["logits", *OUTPUTS], s.run(["logits", *OUTPUTS], {"image": x})))
    diff = float(np.abs(outs["logits"] - z_src).max())
    recon = float(np.abs(outs["xai_cam"].sum(-1) + outs["xai_cam_bias"][None] - outs["logits"]).max())
    rows = float(max(np.abs(outs[k].sum(-1) - 1).max() for k in ATTN))
    grad_err, gc_err = gradcam_check(model, outs)
    if grad_err > 1e-3 or gc_err > 1e-3:
        raise SystemExit(f"Grad-CAM check failed: gradient err {grad_err:.3g}, map err {gc_err:.3g}")
    OUT.write_bytes(raw)

    cfg_path = MODEL_DIR / "config.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    cfg["model"] = OUT.name
    cfg["model_mb"] = round(len(raw) / 1e6, 1)
    cfg["xai"] = {"outputs": OUTPUTS, "grid": 7, "attention": ["xai_attn3_0", "xai_attn3_1"], "attention_fine": "xai_attn2_5",
                  "evidence": "evidence/xai_export.json"}
    cfg_path.write_bytes((json.dumps(cfg, indent=1, ensure_ascii=False) + "\n").encode("utf-8"))   # LF, as in git

    evidence = {
        "what": "model_xai.onnx = the AgriTriage-Lite student with extra outputs for the CAM, attention and feature map "
                "(tools/xai_export.py). Same weights, same logits.",
        "source": {"file": src.name, "sha256": hashlib.sha256(raw_src).hexdigest() if src == SRC else None},
        "output": {"file": OUT.name, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)},
        "weights_sha256": {"before": w_before, "after": w_before},
        "outputs_added": OUTPUTS,
        "test_inputs": f"numpy default_rng(seed).random((1, 3, 224, 224), float32) for seed in {list(TEST_SEEDS)}",
        "source_logits": [[float(np.float32(v)) for v in row] for row in z_src],
        "max_abs_logit_diff": diff,
        "cam_reconstruction_max_abs_err": recon,
        "attention_row_sum_max_err": rows,
        "gradcam_gradient_vs_central_difference_max_rel_err": grad_err,
        "gradcam_map_vs_numpy_max_rel_err": gc_err,
        "onnxruntime": __import__("onnxruntime").__version__,
    }
    if src != SRC and EVIDENCE.exists():   # a re-export keeps the ORIGINAL model's hash and logits
        old = json.loads(EVIDENCE.read_text(encoding="utf-8"))
        evidence["source"] = old["source"]
        evidence["source_logits"] = old["source_logits"]
        evidence["max_abs_logit_diff"] = float(np.abs(outs["logits"] - np.asarray(old["source_logits"], np.float32)).max())
    EVIDENCE.write_bytes((json.dumps(evidence, indent=1) + "\n").encode("utf-8"))
    print(f"wrote {OUT.relative_to(ROOT)} ({len(raw):,} bytes); logits max diff {evidence['max_abs_logit_diff']:.3g}; "
          f"CAM reconstruction max err {recon:.3g}; attention rows sum to 1 within {rows:.3g}")
    return 0


def write_fixture() -> None:
    from services.vision.agritriage_xai import fixture
    FIXTURE.write_bytes((json.dumps(fixture(), separators=(",", ":")) + "\n").encode("utf-8"))
    print(f"wrote {FIXTURE.relative_to(ROOT)}")


if __name__ == "__main__":
    if sys.argv[1:] == ["fixture"]:
        write_fixture()
        raise SystemExit(0)
    raise SystemExit(main())
