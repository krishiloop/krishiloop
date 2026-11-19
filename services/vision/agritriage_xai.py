"""Real explainability for the AgriTriage-Lite student, in numpy. The browser runs the same maths
(apps/web/src/lib/agritriage/xai.ts); xai.fixture.json holds fixed inputs and this module's answers, and both
tests/test_agritriage_xai.py and xai.test.ts check against it.

Three views come from ONE model run (model_xai.onnx, tools/xai_export.py), so they cost nothing after the diagnosis:

* **Class activation map (CAM), exact.** The model's head is pool -> LayerNorm -> linear, so each of the 7 x 7 cells of
  the last feature map owns an exact share of each class's score: logit_c = sum of the 49 cells + a fixed bias.
  `xai_cam` is computed inside the graph; `cam_from_features` redoes it here from the feature map and the weights, as
  an independent check. The map shows the positive shares (what pushed the model TOWARDS its answer).
* **Attention.** The stage-3 self-attention runs over one 7 x 7 window that covers the whole photo. We show the
  attention each square RECEIVES: the mean over the 14 heads, over all 49 asking squares, and over the stage's two
  blocks (rows sum to 1, so the 49 values sum to 1). Plain mean, not rollout: rollout across TinyViT's stages would need
  the patch-merging convolutions, which attention cannot pass through.
* **Occlusion** (agritriage.py): hide one square at a time and measure the drop. Needs 16 + 49 extra runs; a cross-check.

Plus a **lesion estimate that is NOT the AI model**: a leaf mask (excess green 2G - R - B, Otsu threshold, holes
filled) and, inside it, brown, yellow or dark pixels (HSV thresholds, cleaned with a 3 x 3 opening). Severity is the
spot area divided by the leaf area. It is a colour rule, labelled as such. No trained lesion segmenter ships with this
project: the poster pipeline trained one (LR-ASPP MobileNetV3 on PlantSeg; lesion IoU 0.638 on its test split, its
metrics.json), but its weights are not on this machine.
"""
from __future__ import annotations

import numpy as np

GRID = 7
SIZE = 224
# the lesion colour rule (HSV: hue in degrees, saturation and value in [0, 1]); tuned on drawn leaves only, not on data
EXG_MIN, EXG_MAX = 10, 60          # the Otsu threshold on 2G - R - B is kept inside this band
DARK_V = 0.20                      # darker than this inside the leaf, and not green: a dark spot
BROWN_HUE, YELLOW_HUE = 42.0, 64.0 # hue < 42 (or >= 330): brown or red-brown; 42..64: yellow; above: green
BROWN_S, YELLOW_S = 0.22, 0.32
BROWN_V, YELLOW_V = 0.20, 0.40
SINK = 4.0                         # attention above 4x a fair share: a sink square, left out of the scale
MIN_LEAF = 0.03                    # a leaf must cover 3% of the square, or we say we found none
KINDS = ("brown", "yellow", "dark")


# ---------------------------------------------------------------- the CAM (exact) and attention
def head_params(model_path) -> dict:
    """W (dequantised INT8), b, LayerNorm gamma, beta and epsilon, read from the ONNX file's own initializers."""
    import onnx
    from onnx import helper, numpy_helper
    m = onnx.load(str(model_path))
    t = {i.name: numpy_helper.to_array(i) for i in m.graph.initializer}
    q, scale, zp = (t["classifier.weight_q"].astype(np.float64), t["classifier.weight_scale"].astype(np.float64),
                    t["classifier.weight_zp"].astype(np.float64))
    ln = next(n for n in m.graph.node if n.name == "/head/norm/LayerNormalization")
    eps = next((helper.get_attribute_value(a) for a in ln.attribute if a.name == "epsilon"), 1e-5)
    return {"W": (q - zp[:, None]) * scale[:, None], "b": t["classifier.bias"].astype(np.float64),
            "gamma": t["backbone.head.norm.weight"].astype(np.float64), "beta": t["backbone.head.norm.bias"].astype(np.float64),
            "eps": float(eps)}


def cam_from_features(feat: np.ndarray, head: dict) -> tuple[np.ndarray, np.ndarray]:
    """The independent derivation: feat [B, C, 7, 7] -> (cells [B, K, 49], bias [K]); cells.sum(-1) + bias = logits."""
    F = np.asarray(feat, dtype=np.float64).reshape(feat.shape[0], feat.shape[1], -1)
    v = F.mean(-1)
    mu = v.mean(-1, keepdims=True)
    sigma = np.sqrt(((v - mu) ** 2).mean(-1, keepdims=True) + head["eps"])
    G = head["gamma"][None, :, None] * (F - mu[..., None]) / sigma[..., None]
    return np.einsum("kc,bcn->bkn", head["W"], G) / F.shape[-1], head["b"] + head["W"] @ head["beta"]


def cam_unit(v) -> np.ndarray:
    """The CAM view: cells that pushed against the answer are 0; the rest run from the weakest push (0) to the strongest
    (1). Usually every cell pushes a little, so this shows which pushed MOST. All 0 when no cell pushes towards it."""
    v = np.asarray(v, dtype=np.float64)
    hi = float(v.max()) if v.size else 0.0
    if hi <= 0:
        return np.zeros_like(v)
    lo = max(0.0, float(v.min()))
    return np.clip((v - lo) / (hi - lo), 0.0, 1.0) if hi > lo else np.where(v > 0, 1.0, 0.0)


def unit_range(v) -> np.ndarray:
    """(v - min) / (max - min), all 0 when flat: the attention view."""
    v = np.asarray(v, dtype=np.float64)
    lo, hi = float(v.min()), float(v.max())
    return (v - lo) / (hi - lo) if hi > lo else np.zeros_like(v)


def attention_view(received, sink: float = SINK) -> tuple[np.ndarray, list[int]]:
    """The attention view: squares that soak up more than `sink` times a fair share (1/N) are 'sinks' (in this model one
    corner square takes 25-50% of all attention in almost every photo, whatever is there: a known habit of attention
    models, "Vision Transformers Need Registers", Darcet et al. 2024). They are left out of the colour scale and marked;
    the other squares run from least (0) to most (1)."""
    v = np.asarray(received, dtype=np.float64)
    sinks = [int(i) for i in np.nonzero(v > sink / v.size)[0]]
    rest = np.ones(v.size, dtype=bool)
    rest[sinks] = False
    out = np.zeros_like(v)
    if rest.any():
        lo, hi = float(v[rest].min()), float(v[rest].max())
        if hi > lo:
            out[rest] = (v[rest] - lo) / (hi - lo)
    return out, sinks


def attention_received(blocks) -> np.ndarray:
    """blocks: [heads, N, N] arrays (rows = asking squares, softmax over the columns). The attention each square receives:
    the mean over heads and asking squares, then over blocks. Sums to 1."""
    acc = np.zeros(np.asarray(blocks[0]).shape[-1])
    for A in blocks:
        A = np.asarray(A, dtype=np.float64)
        acc += A.sum(axis=(0, 1)) / (A.shape[0] * A.shape[1])
    return acc / len(blocks)


def upsample(grid_vals, g: int = GRID, size: int = SIZE) -> np.ndarray:
    """Bilinear, cell centres at (i + 0.5) * size / g, edges clamped (align_corners=False): [g*g] -> [size, size]."""
    v = np.asarray(grid_vals, dtype=np.float64).reshape(g, g)
    c = np.clip((np.arange(size) + 0.5) * g / size - 0.5, 0, g - 1)
    i0 = np.floor(c).astype(int)
    i1 = np.minimum(i0 + 1, g - 1)
    f = c - i0
    rows = v[i0] * (1 - f)[:, None] + v[i1] * f[:, None]
    return rows[:, i0] * (1 - f)[None, :] + rows[:, i1] * f[None, :]


# ---------------------------------------------------------------- the lesion estimate (a colour rule, not the model)
def to_rgb(x: np.ndarray) -> np.ndarray:
    """The model's input [1 or none, 3, S, S] in [0, 1] -> uint8 [S, S, 3] (exact: the input was uint8 / 255)."""
    x = np.asarray(x)
    if x.ndim == 4:
        x = x[0]
    return np.clip(np.round(x.transpose(1, 2, 0) * 255), 0, 255).astype(np.uint8)


def hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    r, g, b = (rgb[..., i].astype(np.float64) for i in range(3))
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    d = mx - mn
    safe = np.where(d > 0, d, 1.0)
    h = np.where(mx == r, 60 * ((g - b) / safe), np.where(mx == g, 60 * ((b - r) / safe + 2), 60 * ((r - g) / safe + 4)))
    h = np.where(d > 0, np.where(h < 0, h + 360, h), 0.0)
    s = np.where(mx > 0, d / np.where(mx > 0, mx, 1.0), 0.0)
    return h, s, mx / 255


def otsu(values: np.ndarray, lo: int = -510, hi: int = 510) -> int:
    """Otsu's threshold on integer values in [lo, hi]: the class above is 'value > t'. Ties keep the first."""
    hist = np.bincount((np.asarray(values, dtype=np.int64) - lo).ravel(), minlength=hi - lo + 1).astype(np.float64)
    total = float(hist.sum())
    sum_all = float(sum((lo + i) * hist[i] for i in np.nonzero(hist)[0]))
    best, best_t, w_b, sum_b = -1.0, lo, 0.0, 0.0
    for i in range(hi - lo + 1):
        if hist[i] == 0 and w_b == 0:
            continue
        w_b += hist[i]
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += (lo + i) * hist[i]
        m_b, m_f = sum_b / w_b, (sum_all - sum_b) / w_f
        between = w_b * w_f * (m_b - m_f) * (m_b - m_f)
        if between > best:
            best, best_t = between, lo + i
    return best_t


def _shift_all(m: np.ndarray, fn) -> np.ndarray:
    """Combine the 3 x 3 neighbourhood of a bool mask with fn (and / or); neighbours outside the image are skipped."""
    H, W = m.shape
    out = m.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            ys, yd = (slice(max(0, dy), H + min(0, dy)), slice(max(0, -dy), H + min(0, -dy)))
            xs, xd = (slice(max(0, dx), W + min(0, dx)), slice(max(0, -dx), W + min(0, -dx)))
            out[yd, xd] = fn(out[yd, xd], m[ys, xs])
    return out


def erode(m: np.ndarray) -> np.ndarray:
    return _shift_all(m, np.logical_and)


def dilate(m: np.ndarray) -> np.ndarray:
    return _shift_all(m, np.logical_or)


def fill_holes(m: np.ndarray) -> np.ndarray:
    """Everything not reachable from the border through non-mask pixels (4-neighbours) joins the mask."""
    try:   # the same rule (the background's default 4-connectivity), ~100x faster; scipy is a dev dependency only
        from scipy.ndimage import binary_fill_holes
        return binary_fill_holes(m)
    except ImportError:
        pass
    from collections import deque
    H, W = m.shape
    seen = np.zeros_like(m, dtype=bool)
    q = deque()
    for y in range(H):
        for x in (0, W - 1):
            if not m[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for x in range(W):
        for y in (0, H - 1):
            if not m[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < H and 0 <= nx < W and not m[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return ~seen


def outline(m: np.ndarray) -> np.ndarray:
    return m & ~erode(m)


def lesion(rgb: np.ndarray) -> dict:
    """Leaf mask, spot mask and severity from colour alone. rgb: uint8 [S, S, 3]."""
    rgb = np.asarray(rgb, dtype=np.uint8)
    r, g, b = (rgb[..., i].astype(np.int64) for i in range(3))
    exg = 2 * g - r - b
    t = int(min(max(otsu(exg), EXG_MIN), EXG_MAX))
    green = exg > t
    leaf = fill_holes(erode(dilate(dilate(erode(green)))))       # open (speckles out), close (small gaps), fill holes
    h, s, v = hsv(rgb)
    dark = (v < DARK_V) & ((h < YELLOW_HUE) | (h >= 330) | (s < 0.25))   # dark green shade is not a spot
    brown = (v >= DARK_V) & ((h < BROWN_HUE) | (h >= 330)) & (s > BROWN_S) & (v >= BROWN_V)
    yellow = (v >= DARK_V) & (h >= BROWN_HUE) & (h < YELLOW_HUE) & (s > YELLOW_S) & (v >= YELLOW_V)
    spots = dilate(erode((brown | yellow | dark) & leaf)) & leaf    # 3 x 3 opening, kept inside the leaf
    n, n_leaf, n_spot = rgb.shape[0] * rgb.shape[1], int(leaf.sum()), int(spots.sum())
    found = n_leaf >= MIN_LEAF * n
    kinds = {k: (round(100 * int((m & spots).sum()) / n_leaf, 2) if found else None)
             for k, m in zip(KINDS, (brown, yellow, dark))}
    return {"leaf": leaf, "spots": spots, "threshold": t, "leaf_found": bool(found), "leaf_pct": round(100 * n_leaf / n, 2),
            "severity_pct": round(100 * n_spot / n_leaf, 2) if found else None, "kinds_pct": kinds}


def overlap(cam_up: np.ndarray, les: dict) -> dict:
    """How much of the CAM's positive mass falls on the spots and on the leaf, against the spots' share of the photo."""
    c = np.asarray(cam_up, dtype=np.float64)
    total = float(c.sum())
    n = c.size
    spots, leaf = les["spots"], les["leaf"]
    spot_area = float(spots.sum()) / n
    on_spots = float(c[spots].sum()) / total if total > 0 else 0.0
    on_leaf = float(c[leaf].sum()) / total if total > 0 else 0.0
    return {"on_spots_pct": round(100 * on_spots, 2), "on_leaf_pct": round(100 * on_leaf, 2),
            "spot_area_pct": round(100 * spot_area, 2), "lift": round(on_spots / spot_area, 3) if spot_area > 0 else None,
            "verdict": verdict(les, on_spots, on_leaf, spot_area)}


def verdict(les: dict, on_spots: float, on_leaf: float, spot_area: float) -> str:
    """One plain answer for the UI: where the AI looked, compared with the spots."""
    if not les["leaf_found"]:
        return "no_leaf"
    if (les["severity_pct"] or 0) < 0.5:
        return "no_spots"
    if on_spots >= 0.5:
        return "mostly_spots"
    if spot_area > 0 and on_spots / spot_area >= 2:
        return "more_on_spots"
    if on_leaf >= 0.6:
        return "other_leaf"
    return "outside_leaf"


def explain(outs: dict, target: int, x: np.ndarray | None = None, with_fine: bool = False) -> dict:
    """The server's views for one photo from one run: outs holds model_xai's outputs for batch item 0."""
    cells = np.asarray(outs["xai_cam"])[0, target].astype(np.float64)
    bias = float(np.asarray(outs["xai_cam_bias"])[target])
    logit = float(np.asarray(outs["logits"])[0, target])
    att = attention_received([np.asarray(outs["xai_attn3_0"])[0], np.asarray(outs["xai_attn3_1"])[0]])
    out = {"method": "cam+attention", "grid": GRID, "target_index": int(target),
           "cam": [round(float(v), 6) for v in cells], "cam_bias": round(bias, 6), "logit": round(logit, 6),
           "cam_error": float(abs(cells.sum() + bias - logit)),
           "attention": [round(float(v), 6) for v in att], "attention_sinks": attention_view(att)[1]}
    if with_fine and "xai_attn2_5" in outs:
        out["attention_fine"] = [round(float(v), 6) for v in attention_received([np.asarray(outs["xai_attn2_5"])[0]])]
    if x is not None:
        les = lesion(to_rgb(x))
        ov = overlap(upsample(cam_unit(cells)), les)
        out["lesion"] = {k: les[k] for k in ("leaf_found", "leaf_pct", "severity_pct", "kinds_pct", "threshold")} | {"overlap": ov}
    return out


# ---------------------------------------------------------------- fixed inputs, the same in Python and TypeScript
def synth_leaf(size: int, spots: list[tuple[int, int, int, str]], bg: tuple[int, int, int] = (214, 204, 170)) -> tuple[np.ndarray, int, int]:
    """A drawn leaf with integer maths only (xai.ts synthLeaf draws the same pixels): a green ellipse with a little
    texture, and round spots (cy, cx, r, kind) with kind in brown / yellow / dark. Returns (rgb, leaf px, spot px)."""
    cy, cx, a, b = size // 2, size // 2, (size * 9) // 20, (size * 3) // 10
    col = {"brown": (132, 86, 44), "yellow": (214, 196, 58), "dark": (34, 26, 20)}
    rgb = np.zeros((size, size, 3), dtype=np.uint8)
    n_leaf = n_spot = 0
    for y in range(size):
        for x in range(size):
            inside = (x - cx) ** 2 * b * b + (y - cy) ** 2 * a * a <= a * a * b * b
            if not inside:
                rgb[y, x] = bg
                continue
            n_leaf += 1
            t = (x * 7 + y * 13) % 11 - 5
            px = (58 + t, 128 + 2 * t, 52 + t)
            for sy, sx, r, kind in spots:
                if (x - sx) ** 2 + (y - sy) ** 2 <= r * r:
                    px = col[kind]
                    n_spot += 1
                    break
            rgb[y, x] = px
    return rgb, n_leaf, n_spot


def synth_attention(blocks: int = 2, heads: int = 3, n: int = 49) -> list[np.ndarray]:
    """Softmax rows from a closed formula (xai.ts synthAttention): square 6 is a sink, as in the real model."""
    out = []
    for bl in range(blocks):
        A = np.zeros((heads, n, n))
        for h in range(heads):
            for i in range(n):
                z = [3 * np.sin(1.3 * i + 0.7 * j + 0.31 * h + 2.1 * bl) + (4.0 if j == 6 else 0.0) for j in range(n)]
                m = max(z)
                e = [float(np.exp(v - m)) for v in z]
                s = 0.0
                for v in e:
                    s += v
                A[h, i] = [v / s for v in e]
        out.append(A)
    return out


FIXTURE_CAM = [round(0.2 * np.sin(0.9 * i) + 0.05 * (i % 7) - 0.04, 6) for i in range(49)]
FIXTURE_LEAF = (96, [(40, 34, 6, "brown"), (55, 60, 5, "brown"), (46, 52, 4, "yellow"), (52, 26, 3, "dark")])


def fixture() -> dict:
    """xai.fixture.json: fixed inputs and this module's answers (xai.test.ts and the pytest both check them)."""
    cells = np.asarray(FIXTURE_CAM)
    att = attention_received(synth_attention())
    view, sinks = attention_view(att)
    size, spots = FIXTURE_LEAF
    rgb, n_leaf, n_spot = synth_leaf(size, spots)
    les = lesion(rgb)
    cam_up = upsample(cam_unit(cells), GRID, size)
    ov = overlap(cam_up, les)
    r6 = lambda v: [round(float(x), 9) for x in np.asarray(v).ravel()]
    return {
        "note": "Fixed inputs and services/vision/agritriage_xai.py's answers. tests/test_agritriage_xai.py and xai.test.ts "
                "both check this file; regenerate with .venv/Scripts/python.exe -m tools.xai_export fixture",
        "cam": {"cells": FIXTURE_CAM, "unit": r6(cam_unit(cells)), "up28": r6(upsample(cam_unit(cells), GRID, 28))},
        "attention": {"blocks": 2, "heads": 3, "received": r6(att), "view": r6(view), "sinks": sinks},
        "lesion": {"size": size, "spots": [list(s) for s in spots], "drawn_leaf": n_leaf, "drawn_spots": n_spot,
                   "threshold": les["threshold"], "leaf_px": int(les["leaf"].sum()), "spot_px": int(les["spots"].sum()),
                   "leaf_index_sum": int(np.nonzero(les["leaf"].ravel())[0].sum()),
                   "spot_index_sum": int(np.nonzero(les["spots"].ravel())[0].sum()),
                   "outline_px": int(outline(les["spots"]).sum()),
                   "severity_pct": les["severity_pct"], "leaf_pct": les["leaf_pct"], "kinds_pct": les["kinds_pct"],
                   "overlap": ov},
    }
