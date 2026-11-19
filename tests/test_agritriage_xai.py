"""Real explainability for AgriTriage-Lite (tools/xai_export.py, services/vision/agritriage_xai.py):

* model_xai.onnx has the same weights and gives the same logits as the model it was made from;
* the class activation map is exact: the 49 cells plus a fixed bias rebuild the logit, and numpy rebuilds the cells from
  the feature map and the weights;
* the stage-3 attention is a 7 x 7 window over the whole photo, and its rows sum to 1;
* the lesion colour estimate finds drawn spots of known size;
* xai.fixture.json (which xai.test.ts also checks) still matches this module's answers.
"""
import io
import json
import time

import numpy as np
import pytest

from services.vision import agritriage as at
from services.vision import agritriage_xai as xa
from tools import xai_export as ex

CFG = json.loads((at.MODEL_DIR / "config.json").read_text(encoding="utf-8"))
EVIDENCE = json.loads(ex.EVIDENCE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def sess():
    return ex.session((at.MODEL_DIR / CFG["model"]).read_bytes())


@pytest.fixture(scope="module")
def model():
    return at.load_model()


def leaf_jpeg(seed: int = 0) -> bytes:
    from tests.test_agritriage import leaf_jpeg as draw
    return draw(seed)


def run(sess, x):
    names = ["logits", *ex.OUTPUTS]
    return dict(zip(names, sess.run(names, {"image": x.astype(np.float32)})))


# ---------------------------------------------------------------- the file
def test_one_model_file_with_the_same_weights_and_logits(sess):
    import onnx
    assert CFG["model"] == "model_xai.onnx"
    assert sorted(p.name for p in at.MODEL_DIR.glob("*.onnx")) == ["model_xai.onnx"]       # served alone: no 2nd 11.5 MB
    m = onnx.load(str(at.MODEL_DIR / CFG["model"]))
    assert ex.weights_sha256(m) == EVIDENCE["weights_sha256"]["before"]                   # the same weights, byte for byte
    assert [o.name for o in m.graph.output] == ["logits", *ex.OUTPUTS]
    z = sess.run(["logits"], {"image": ex.test_inputs()})[0]
    src = np.asarray(EVIDENCE["source_logits"], dtype=np.float32)                          # model.onnx's own logits
    assert z.shape == src.shape == (3, 89)
    assert float(np.abs(z - src).max()) <= 1e-5
    assert EVIDENCE["source"]["sha256"] == "3e269bed37af20e16aeddb4188d2a73be12e5921efc14b5b16ae9be729746fbb"


# ---------------------------------------------------------------- the CAM is exact
def test_cam_cells_plus_bias_rebuild_the_logits(sess):
    x = np.concatenate([ex.test_inputs(), at.preprocess(leaf_jpeg(0)), at.preprocess(leaf_jpeg(5))])
    o = run(sess, x)
    assert o["xai_cam"].shape == (5, 89, 49) and o["xai_cam_bias"].shape == (89,)
    rebuilt = o["xai_cam"].astype(np.float64).sum(-1) + o["xai_cam_bias"].astype(np.float64)[None]
    err = float(np.abs(rebuilt - o["logits"]).max())
    assert err < 1e-4, f"CAM reconstruction error {err}"
    # numpy, independently: the feature map and the ONNX file's own weights (W dequantised from INT8)
    head = xa.head_params(at.MODEL_DIR / CFG["model"])
    cells, bias = xa.cam_from_features(o["xai_feat"], head)
    assert float(np.abs(cells - o["xai_cam"]).max()) < 1e-4
    assert float(np.abs(bias - o["xai_cam_bias"]).max()) < 1e-4
    assert float(np.abs(cells.sum(-1) + bias[None] - o["logits"]).max()) < 1e-4


# ---------------------------------------------------------------- attention
def test_attention_is_one_window_over_the_photo_and_rows_sum_to_one(sess):
    o = run(sess, at.preprocess(leaf_jpeg(1)))
    for k in ("xai_attn3_0", "xai_attn3_1"):
        A = o[k]
        assert A.shape == (1, 14, 49, 49)                       # 14 heads, 7 x 7 = 49 squares, one window
        assert float(np.abs(A.sum(-1) - 1).max()) < 1e-5 and float(A.min()) >= 0
    assert o["xai_attn2_5"].shape == (1, 8, 196, 196)           # stage 2: one 14 x 14 window
    recv = xa.attention_received([o["xai_attn3_0"][0], o["xai_attn3_1"][0]])
    assert recv.shape == (49,) and recv.sum() == pytest.approx(1, abs=1e-6)
    view, sinks = xa.attention_view(recv)
    assert view.shape == (49,) and view.min() >= 0 and view.max() == pytest.approx(1)
    assert all(view[i] == 0 for i in sinks) and all(recv[i] > xa.SINK / 49 for i in sinks)


def test_map_helpers():
    assert xa.cam_unit([0.1, 0.3, 0.2]).tolist() == pytest.approx([0, 1, 0.5])
    assert xa.cam_unit([-0.2, 0.0, 0.4]).tolist() == pytest.approx([0, 0, 1])               # pushed away: 0
    assert xa.cam_unit([-1, -2]).tolist() == [0, 0]
    up = xa.upsample(np.arange(49), 7, 224)
    assert up.shape == (224, 224) and up[0, 0] == 0 and up[-1, -1] == 48
    assert up[15, 15] == 0 and up[0, 223] == 6 and up[223, 0] == 42 and np.all(np.diff(up[100]) >= 0)  # corners, smooth
    v, s = xa.attention_view([0.5] + [0.5 / 48] * 48)
    assert s == [0] and v.tolist() == [0.0] * 49


# ---------------------------------------------------------------- the lesion estimate (a colour rule)
@pytest.mark.parametrize("spots", [
    [(40, 34, 6, "brown"), (55, 60, 5, "brown")],
    [(48, 30, 9, "brown"), (44, 62, 7, "yellow"), (58, 46, 4, "dark")],
    [(48, 48, 14, "brown")],
    [(40, 28, 5, "yellow"), (52, 40, 5, "yellow"), (46, 64, 6, "dark")],
])
@pytest.mark.parametrize("size", [96, 224])
def test_lesion_estimate_on_drawn_leaves_of_known_spot_area(spots, size):
    k = size / 96
    sp = [(round(y * k), round(x * k), round(r * k), kind) for y, x, r, kind in spots]
    rgb, n_leaf, n_spot = xa.synth_leaf(size, sp)
    les = xa.lesion(rgb)
    truth = 100 * n_spot / n_leaf
    assert les["leaf_found"] and abs(les["leaf"].sum() - n_leaf) <= 0.02 * n_leaf
    assert les["severity_pct"] == pytest.approx(truth, abs=1.0), (les["severity_pct"], truth)
    kinds = {kind for *_, kind in sp}
    for kind in xa.KINDS:
        assert (les["kinds_pct"][kind] > 0) == (kind in kinds)


def test_lesion_estimate_says_no_spots_and_no_leaf():
    rgb, _, _ = xa.synth_leaf(160, [])
    healthy = xa.lesion(rgb)
    assert healthy["leaf_found"] and healthy["severity_pct"] < 0.5
    grey = xa.lesion(np.full((120, 120, 3), 128, np.uint8))
    assert grey["leaf_found"] is False and grey["severity_pct"] is None
    ov = xa.overlap(np.ones((120, 120)), grey)
    assert ov["verdict"] == "no_leaf"


def test_overlap_says_where_the_map_fell():
    rgb, _, _ = xa.synth_leaf(96, [(40, 36, 7, "brown")])
    les = xa.lesion(rgb)
    on = np.zeros((96, 96))
    on[33:48, 29:44] = 1                                         # a map on the spot
    assert xa.overlap(on, les)["verdict"] in ("mostly_spots", "more_on_spots")
    off = np.zeros((96, 96))
    off[44:56, 60:72] = 1                                        # a map on clean leaf
    assert xa.overlap(off, les)["verdict"] == "other_leaf"
    out = np.zeros((96, 96))
    out[:6, :6] = 1                                              # a map on the background
    assert xa.overlap(out, les)["verdict"] == "outside_leaf"


# ---------------------------------------------------------------- the browser runs the same maths
def _close(a, b, tol):
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(_close(a[k], b[k], tol) for k in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(_close(x, y, tol) for x, y in zip(a, b))
    if isinstance(a, float) or isinstance(b, float):
        return a is not None and b is not None and abs(a - b) <= tol
    return a == b


def test_the_shared_fixture_matches_this_module():
    saved = json.loads(ex.FIXTURE.read_text(encoding="utf-8"))
    fresh = json.loads(json.dumps(xa.fixture()))
    assert _close(fresh, saved, 1e-9), "xai.fixture.json is stale: .venv/Scripts/python.exe -m tools.xai_export fixture"


# ---------------------------------------------------------------- the server's reading carries the views
def test_server_reading_carries_cam_attention_and_lesion_from_one_run(model):
    assert model.xai
    image = leaf_jpeg(2)
    model.read(image, "rice")                                    # warm up
    t0 = time.perf_counter()
    r, p, x = model.read_explained(image, None)
    total = (time.perf_counter() - t0) * 1000
    assert x["target"] == r["labels"][0]["label"] and x["grid"] == 7
    assert len(x["cam"]) == 49 and len(x["attention"]) == 49 and x["cam_error"] < 1e-4
    assert sum(x["cam"]) + x["cam_bias"] == pytest.approx(x["logit"], abs=1e-4)
    les = x["lesion"]
    assert les["leaf_found"] and 1 < les["severity_pct"] < 40 and les["kinds_pct"]["brown"] > 0     # drawn brown spots
    assert les["overlap"]["verdict"] in ("mostly_spots", "more_on_spots", "other_leaf", "outside_leaf", "no_spots")
    assert x["ms"] < 1000 and total < 5000
    print(f"server: model run {r['inference_ms']} ms, XAI views {x['ms']} ms, CAM error {x['cam_error']:.2e}")
