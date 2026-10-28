"""KrishiLens v1 pilot: leave-one-domain-out on licence-clean Bangladeshi rice field datasets (all CC BY 4.0).

Why: the v0 cross-dataset test was confounded (dataset A contained Paddy Doctor images), and both v0 training sets
have licence problems (plan/reviews/review_ml_2026-10-27.md). This run uses independent CC BY 4.0 domains only.

Domains (research/rice_datasets_dg_2026.md):
  BD-A  Dhan-Shomadhan, field background     vivo Y15                       Mendeley znsxdctwtt v1
  BD-B  Dhan-Shomadhan, white background     vivo Y15                       background-shift test only
  BD-C  RiceyLeafDisease, originals only     Samsung SM-M325F, Xiaomi       t46kkgh2yw v1
  BD-D  RiceLeafDisease-BD5 (Savar, 300x300)                                sjkptpgv79 v2 (RAR; skipped if no extractor)
  BD-E  RiceLeafDiseaseBD (Gazipur)          CMF Phone 2 Pro, Google Pixel 5 86s4jzj2m4 v3 (split by phone if the xlsx allows)
Protocol:
- Core classes: healthy, blast, brown_spot, tungro, sheath_blight. Hold out each domain in turn.
- BD-A and BD-B are never split across train and test (same phone, possibly the same leaves).
- Two recipes: "erm" (standard augmentation) and "isp" (+ simulated phone camera pipelines).
Reported per held-out domain, over the classes present there:
- macro-F1, balanced accuracy, the train-majority baseline;
- ECE before/after temperature scaling, fitted on SOURCE validation only;
- selective accuracy at 80% coverage, AURC.
Duplicates: D4-invariant perceptual hash (rotations and flips), banded LSH without truncation. Groups spanning
domains are dropped; groups never straddle train and validation.
Diagnostic H2: how well colour statistics alone identify the domain.
Outputs (/kaggle/working): lodo.json, krishilens_v1_rice.onnx (single file, calibrated probabilities), preprocess.json.
"""
import io, json, os, random, re, subprocess, sys, time, urllib.error, urllib.request, zipfile
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

subprocess.run([sys.executable, "-m", "pip", "install", "-q", "imagehash", "onnx", "onnxruntime", "rarfile", "openpyxl"], check=False)
subprocess.run("(apt-get install -y -qq unar || apt-get install -y -qq unrar-free) > /dev/null 2>&1 || true", shell=True)

import imagehash
import numpy as np
import timm
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.transforms as T
from PIL import Image, ImageFilter, ImageOps
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score, f1_score
from sklearn.model_selection import cross_val_score
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler

SEED = 7
random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
DEV = "cuda" if torch.cuda.is_available() else "cpu"
OUT, RAW, CACHE = "/kaggle/working", "/tmp/raw", "/tmp/cache"
for d in (RAW, CACHE):
    os.makedirs(d, exist_ok=True)
T0 = time.time()
RESULTS = {"started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "seed": SEED, "folds": {}}
CORE = ["healthy", "blast", "brown_spot", "tungro", "sheath_blight"]
SHORT_SIDE, CROP = 256, 224   # the browser does exactly this: resize short side to 256 (antialiased), centre-crop 224
MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)
EPOCHS, BATCH = 12, 64


def log(*a):
    print(f"[{time.time() - T0:7.0f}s]", *a, flush=True)


def save():
    json.dump(RESULTS, open(f"{OUT}/lodo.json", "w"), indent=2)


# ---------------------------------------------------------------- download (Mendeley public API)
API = "https://data.mendeley.com/public-api/datasets"
UA = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}


def jget(url, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            log("retry", url[-70:], e.code); time.sleep(5 * (i + 1))
        except Exception as e:
            log("retry", url[-70:], str(e)[:60]); time.sleep(5 * (i + 1))
    raise RuntimeError(url)


def fetch(url, dest, tries=5):
    if os.path.exists(dest):
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=900) as r, \
                    open(dest + ".part", "wb") as f:
                while True:
                    b = r.read(1 << 22)
                    if not b:
                        break
                    f.write(b)
            os.replace(dest + ".part", dest)
            return dest
        except Exception as e:
            log("retry download", os.path.basename(dest), str(e)[:60]); time.sleep(5 * (i + 1))
    raise RuntimeError(url)


def mendeley(ds, ver, skip):
    """Download every file of a dataset version, keeping its folder tree; extract zip/rar archives."""
    root = f"{RAW}/{ds}"
    folders = {f["id"]: f for f in (jget(f"{API}/{ds}/folders/{ver}") or [])}

    def fpath(fid):
        parts = []
        while fid in folders:
            parts.append(folders[fid]["name"]); fid = folders[fid].get("parent_id")
        return "/".join(reversed(parts))
    jobs = []
    for fid in ["root"] + list(folders):
        for f in jget(f"{API}/{ds}/files?folder_id={fid}&version={ver}") or []:
            url = (f.get("content_details") or {}).get("download_url")
            rel = "/".join(p for p in (fpath(fid) if fid != "root" else "", f["filename"]) if p)
            if url and not skip(rel):
                jobs.append((url, f"{root}/{rel}"))
    log(ds, "files to fetch:", len(jobs))
    with ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda j: fetch(*j), jobs))
    for url, dest in jobs:
        low = dest.lower()
        try:
            if low.endswith(".zip"):
                with zipfile.ZipFile(dest) as z:
                    z.extractall(dest[:-4], members=[m for m in z.namelist() if not skip(m)])
                os.remove(dest)
            elif low.endswith(".rar"):
                import rarfile
                with rarfile.RarFile(dest) as z:
                    z.extractall(dest[:-4])
                os.remove(dest)
        except Exception as e:
            log("could not extract", os.path.basename(dest), str(e)[:100])
    return root


SOURCES = [  # (domain resolver, mendeley id, version, skip predicate)
    ("dhan", "znsxdctwtt", 1, lambda p: False),
    ("ricey", "t46kkgh2yw", 1, lambda p: "augment" in p.lower()),
    ("bd5", "sjkptpgv79", 2, lambda p: False),
    ("munna", "86s4jzj2m4", 3, lambda p: p.lower().endswith((".png", ".pdf")) and "/" not in p),
]
ROOTS = {}
for key, ds, ver, skip in SOURCES:
    try:
        ROOTS[key] = mendeley(ds, ver, skip)
    except Exception as e:
        log("SOURCE FAILED", key, str(e)[:200])
RESULTS["sources"] = {k: v for k, v in ROOTS.items()}
log("downloads done")

# ---------------------------------------------------------------- labels, domains, devices
CANON = {
    "healthy": ["healthy", "normal", "healthy leaf", "healthy rice leaf", "normal leaf"],
    "blast": ["blast", "rice blast", "leaf blast"],
    "brown_spot": ["brown spot", "browon spot"],
    "tungro": ["tungro", "rice tungro", "tungro virus", "rice turngo", "rice turgro"],   # source-folder typos kept on purpose
    "sheath_blight": ["sheath blight", "steath blight", "shath blight"],
    "leaf_scald": ["leaf scald", "leaf scaled"],
    "narrow_brown_spot": ["narrow brown spot", "narrow brown leaf spot"],   # a different pathogen: never folded in
    "bacterial_leaf_blight": ["bacterial leaf blight", "bacterial blight", "blb"],
    "leaf_smut": ["leaf smut"], "hispa": ["rice hispa", "hispa"],
}
ALIAS = {a: c for c, alts in CANON.items() for a in alts}


def canon(name):
    k = re.sub(r"[_\-]+", " ", name.strip().lower())
    k = re.sub(r"^\d+[.)\s]*", "", re.sub(r"\s+", " ", k)).strip()
    return ALIAS.get(k)


def label_of(path, root):
    for part in reversed(os.path.relpath(path, root).replace("\\", "/").split("/")[:-1]):
        c = canon(part)
        if c:
            return c
    return None


def domain_of(key, path):
    if key == "dhan":
        return "BD-B" if "white" in path.lower() else "BD-A"
    return {"ricey": "BD-C", "bd5": "BD-D", "munna": "BD-E"}[key]


EXT = (".jpg", ".jpeg", ".png", ".bmp", ".webp")
items = []
for key, root in ROOTS.items():
    for dp, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(dp, f)
            if f.lower().endswith(EXT) and "augment" not in p.lower():
                lab = label_of(p, root)
                if lab:
                    items.append({"path": p, "label": lab, "domain": domain_of(key, p), "source": key})
log("labelled images:", len(items))

# BD-E: per-image phone from the metadata sheet, if its columns allow
device_map = {}
try:
    import pandas as pd
    for dp, _, fs in os.walk(ROOTS.get("munna", "/nonexistent")):
        for f in fs:
            if f.lower().endswith(".xlsx"):
                for sheet, df in pd.read_excel(os.path.join(dp, f), sheet_name=None).items():
                    log("metadata sheet", sheet, list(df.columns)[:20])
                    cols = {c.lower(): c for c in df.columns.astype(str)}
                    dev_col = next((cols[c] for c in cols if any(k in c for k in ("device", "phone", "camera", "model"))), None)
                    name_col = next((cols[c] for c in cols if any(k in c for k in ("file", "image", "name", "id"))), None)
                    if dev_col and name_col:
                        for n, d in zip(df[name_col].astype(str), df[dev_col].astype(str)):
                            device_map[os.path.basename(n).lower()] = d.strip()
except Exception as e:
    log("metadata parse failed", str(e)[:120])
RESULTS["bd_e_device_counts"] = dict(Counter(device_map.values()))
log("BD-E devices from metadata:", RESULTS["bd_e_device_counts"])


# ---------------------------------------------------------------- cache (short side 256, EXIF orientation applied)
def prep(i_it):
    i, it = i_it
    out = f"{CACHE}/{i}.jpg"
    try:
        with Image.open(it["path"]) as im0:
            exif_model = (im0.getexif() or {}).get(272)
            im = ImageOps.exif_transpose(im0).convert("RGB")
        it["orig_wh"] = im.size
        it["exif_model"] = str(exif_model) if exif_model else None
        w, h = im.size
        s = SHORT_SIDE / min(w, h)
        im = im.resize((max(SHORT_SIDE, round(w * s)), max(SHORT_SIDE, round(h * s))), Image.BILINEAR)
        im.save(out, quality=97)
        it["cache"] = out
        hs = [int(str(imagehash.phash(t)), 16) for t in (im, im.transpose(Image.FLIP_LEFT_RIGHT))
              for t in (t, t.rotate(90, expand=True), t.rotate(180), t.rotate(270, expand=True))]
        it["phash"] = min(hs)   # D4-invariant: rotated or flipped copies hash the same
    except Exception as e:
        it["cache"] = None
    return it


with ThreadPoolExecutor(8) as ex:
    items = [it for it in ex.map(prep, enumerate(items)) if it.get("cache")]
for it in items:
    if it["domain"] == "BD-E":
        dev = device_map.get(os.path.basename(it["path"]).lower()) or it.get("exif_model")
        it["device"] = dev
log("cached:", len(items))

# ---------------------------------------------------------------- dedupe: banded LSH over all pairs in each bucket
parent = list(range(len(items)))


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x


H = np.array([it["phash"] for it in items], dtype=np.uint64)
buckets = defaultdict(list)
for i, h in enumerate(H):
    for b in range(8):
        buckets[(b, int((int(h) >> (8 * b)) & 255))].append(i)
pairs = 0
for ids in buckets.values():
    ids = np.array(ids)
    for s in range(0, len(ids), 256):   # 256 x n x 64 bytes stays small
        a = ids[s:s + 256]
        x = H[a][:, None] ^ H[ids][None, :]
        dist = np.unpackbits(x.view(np.uint8).reshape(len(a), len(ids), 8), axis=2).sum(2)
        for ai, bj in zip(*np.nonzero(dist <= 6)):
            i, j = int(a[ai]), int(ids[bj])
            if i < j:
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[ri] = rj; pairs += 1
groups = [find(i) for i in range(len(items))]
dom_of_group = defaultdict(set)
for it, g in zip(items, groups):
    dom_of_group[g].add(it["domain"] if it["domain"] not in ("BD-A", "BD-B") else "BD-AB")
cross = {g for g, ds in dom_of_group.items() if len(ds) > 1}
label_conflict = defaultdict(set)
for it, g in zip(items, groups):
    label_conflict[g].add(it["label"])
RESULTS["dedupe"] = {"merges": pairs, "groups": len(set(groups)), "cross_domain_groups_dropped": len(cross),
                     "images_in_cross_groups": sum(g in cross for g in groups),
                     "groups_with_conflicting_labels": sum(len(v) > 1 for v in label_conflict.values())}
keep = [i for i, g in enumerate(groups) if g not in cross and len(label_conflict[g]) == 1]
items = [dict(items[i], group=groups[i]) for i in keep]
items = [it for it in items if it["label"] in CORE]
RESULTS["counts"] = {d: dict(Counter(it["label"] for it in items if it["domain"] == d)) for d in sorted({it["domain"] for it in items})}
log("dedupe:", RESULTS["dedupe"]); log("counts:", RESULTS["counts"]); save()

# ---------------------------------------------------------------- H2: does colour alone identify the domain?
try:
    def colour_feats(it):
        a = np.asarray(Image.open(it["cache"]).convert("RGB"), dtype=np.float32) / 255
        hist = [np.histogram(a[..., c], bins=16, range=(0, 1))[0] / a[..., c].size for c in range(3)]
        w, h = it["orig_wh"]
        return np.concatenate(hist + [a.mean((0, 1)), a.std((0, 1)), [w / h, np.log(w * h)]])
    sample = random.sample(items, min(4000, len(items)))
    X = np.stack([colour_feats(it) for it in sample]); y = [it["domain"] for it in sample]
    acc = cross_val_score(LogisticRegression(max_iter=3000), X, y, cv=5).mean()
    RESULTS["h2_domain_from_colour"] = {"cv_accuracy": round(float(acc), 3), "chance": round(max(Counter(y).values()) / len(y), 3),
                                       "n": len(y), "note": "accuracy far above chance = a strong capture fingerprint"}
    log("H2:", RESULTS["h2_domain_from_colour"]); save()
except Exception as e:
    log("H2 failed", str(e)[:100])


# ---------------------------------------------------------------- data + camera-pipeline augmentation
def isp(im):
    """Simulate another phone: exposure, white balance, colour matrix, tone curve, noise, resolution, blur/sharpen, JPEG."""
    a = (np.asarray(im, dtype=np.float32) / 255.0) ** np.random.uniform(1.8, 2.4)          # approx. linearise
    a = a * np.random.uniform(0.75, 1.25, 3) * np.random.uniform(0.6, 1.4)                # white balance, exposure
    a = a @ (np.eye(3) + np.random.uniform(-0.08, 0.08, (3, 3))).T                       # colour matrix
    a = a + np.random.normal(0, 1, a.shape) * (np.random.uniform(0, 0.02) * np.sqrt(np.clip(a, 0, 1)) + np.random.uniform(0, 0.006))
    a = np.clip(a, 0, 1) ** (1 / np.random.uniform(1.8, 2.6))                            # tone curve
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    if random.random() < 0.5:
        w, h = im.size; s = random.uniform(0.3, 1.0)
        im = im.resize((max(32, int(w * s)), max(32, int(h * s))), Image.BILINEAR).resize((w, h), Image.BILINEAR)
    r = random.random()
    if r < 0.3:
        im = im.filter(ImageFilter.GaussianBlur(random.uniform(0.3, 1.4)))
    elif r < 0.6:
        im = im.filter(ImageFilter.UnsharpMask(2, random.randint(50, 200), 2))
    if random.random() < 0.8:
        buf = io.BytesIO(); im.save(buf, "JPEG", quality=random.randint(30, 95)); im = Image.open(buf).convert("RGB")
    return im


TF_EVAL = T.Compose([T.CenterCrop(CROP), T.ToTensor(), T.Normalize(MEAN, STD)])
TF_GEO = T.Compose([T.RandomResizedCrop(CROP, scale=(0.35, 1.0)), T.RandomHorizontalFlip(), T.RandomVerticalFlip()])
TF_ERM_COLOUR = T.ColorJitter(0.2, 0.2, 0.2, 0.02)
TO_T = T.Compose([T.ToTensor(), T.Normalize(MEAN, STD)])


class DS(Dataset):
    def __init__(s, rows, train, recipe="erm"):
        s.rows, s.train, s.recipe = rows, train, recipe

    def __len__(s):
        return len(s.rows)

    def __getitem__(s, k):
        it = s.rows[k]
        im = Image.open(it["cache"]).convert("RGB")
        if not s.train:
            return TF_EVAL(im), CORE.index(it["label"])
        if s.recipe == "isp" and random.random() < 0.8:
            im = isp(im)
        im = TF_GEO(im)
        if s.recipe == "erm":
            im = TF_ERM_COLOUR(im)
        return TO_T(im), CORE.index(it["label"])


def split_groups(rows, frac=0.15):
    gs = sorted({it["group"] for it in rows}); random.Random(SEED).shuffle(gs)
    val = set(gs[:max(1, int(frac * len(gs)))])
    return [it for it in rows if it["group"] not in val], [it for it in rows if it["group"] in val]


def train(rows, recipe):
    m = timm.create_model("mobilenetv4_conv_small.e2400_r224_in1k", pretrained=True, num_classes=len(CORE)).to(DEV)
    cell = Counter((it["domain"], it["label"]) for it in rows); dom = Counter(it["domain"] for it in rows)
    w = [1.0 / np.sqrt(cell[(it["domain"], it["label"])]) / np.sqrt(dom[it["domain"]]) for it in rows]
    dl = DataLoader(DS(rows, True, recipe), batch_size=BATCH, sampler=WeightedRandomSampler(w, len(w)), num_workers=4, drop_last=True)
    opt = torch.optim.AdamW(m.parameters(), lr=1e-3, weight_decay=0.05)
    sch = torch.optim.lr_scheduler.OneCycleLR(opt, 1e-3, total_steps=EPOCHS * len(dl))
    sc = torch.amp.GradScaler("cuda", enabled=DEV == "cuda")
    for ep in range(EPOCHS):
        m.train()
        for x, t in dl:
            x, t = x.to(DEV), t.to(DEV)
            with torch.autocast("cuda", enabled=DEV == "cuda"):
                loss = F.cross_entropy(m(x), t, label_smoothing=0.05)
            opt.zero_grad(set_to_none=True); sc.scale(loss).backward(); sc.step(opt); sc.update(); sch.step()
    return m.eval()


@torch.no_grad()
def logits_of(m, rows):
    out, ys = [], []
    for x, y in DataLoader(DS(rows, False), batch_size=128, num_workers=4):
        with torch.autocast("cuda", enabled=DEV == "cuda"):
            out.append(m(x.to(DEV)).float().cpu())
        ys.append(y)
    return torch.cat(out), torch.cat(ys)


def fit_temperature(lg, y):
    t = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([t], lr=0.1, max_iter=200)

    def closure():
        opt.zero_grad(); loss = F.cross_entropy(lg / t.exp(), y); loss.backward(); return loss
    opt.step(closure)
    return float(t.exp())


def ece(p, y, bins=15):
    conf, pred = p.max(1), p.argmax(1)
    edges, e = np.linspace(0, 1, bins + 1), 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        sel = (conf > lo) & (conf <= hi)
        if sel.any():
            e += sel.mean() * abs((pred[sel] == y[sel]).mean() - conf[sel].mean())
    return float(e)


def scores(p, y, train_rows):
    pred, present = p.argmax(1), sorted(set(y.tolist()))
    order = np.argsort(-p.max(1)); correct = (pred == y)[order]
    cum = np.cumsum(correct) / np.arange(1, len(y) + 1)
    maj = CORE.index(Counter(it["label"] for it in train_rows).most_common(1)[0][0])
    return {"n": int(len(y)), "classes_present": [CORE[c] for c in present],
            "macro_f1": round(float(f1_score(y, pred, labels=present, average="macro", zero_division=0)), 4),
            "balanced_accuracy": round(float(balanced_accuracy_score(y, pred)), 4),
            "accuracy": round(float((pred == y).mean()), 4),
            "baseline_train_majority": {"accuracy": round(float((y == maj).mean()), 4),
                                        "macro_f1": round(float(f1_score(y, np.full_like(y, maj), labels=present, average="macro", zero_division=0)), 4)},
            "selective_accuracy_at_80pct": round(float(cum[int(0.8 * len(y)) - 1]), 4), "aurc": round(float((1 - cum).mean()), 4),
            "per_class_recall": {CORE[c]: round(float((pred[y == c] == c).mean()), 4) for c in present}}


def run_fold(name, train_rows, test_sets, recipe):
    tr, va = split_groups(train_rows)
    m = train(tr, recipe)
    lv, yv = logits_of(m, va); temp = fit_temperature(lv, yv)
    res = {"recipe": recipe, "train_n": len(tr), "val_n": len(va), "temperature": round(temp, 3),
           "train_domains": dict(Counter(it["domain"] for it in tr))}
    for tname, rows in test_sets.items():
        if not rows:
            continue
        lt, yt = logits_of(m, rows)
        raw, cal = F.softmax(lt, 1).numpy(), F.softmax(lt / temp, 1).numpy()
        res[tname] = {**scores(cal, yt.numpy(), tr), "ece_raw": round(ece(raw, yt.numpy()), 4), "ece_calibrated": round(ece(cal, yt.numpy()), 4)}
        log(name, recipe, tname, "macroF1", res[tname]["macro_f1"], "bal.acc", res[tname]["balanced_accuracy"],
            "baseline", res[tname]["baseline_train_majority"]["macro_f1"], "ECE", res[tname]["ece_raw"], "->", res[tname]["ece_calibrated"])
    RESULTS["folds"].setdefault(name, {})[recipe] = res
    save()
    return m, temp


# ---------------------------------------------------------------- leave-one-domain-out
domains = sorted({it["domain"] for it in items})
for held in [d for d in ("BD-A", "BD-C", "BD-D", "BD-E") if d in domains]:
    excluded = {"BD-A", "BD-B"} if held == "BD-A" else {held}
    train_rows = [it for it in items if it["domain"] not in excluded]
    tests = {held: [it for it in items if it["domain"] == held and it["label"] in {r["label"] for r in train_rows}]}
    if held == "BD-C":
        tests["BD-B (white background)"] = [it for it in items if it["domain"] == "BD-B"]
    for recipe in ("erm", "isp"):
        if time.time() - T0 < 9.0 * 3600:
            run_fold(f"hold-out {held}", train_rows, tests, recipe)

# leave-one-phone-out inside BD-E (same region and season, different phone)
devs = [d for d, n in Counter(it.get("device") for it in items if it["domain"] == "BD-E").items() if d and n >= 200]
if len(devs) >= 2:
    for dev in devs:
        train_rows = [it for it in items if not (it["domain"] == "BD-E" and it.get("device") == dev)]
        tests = {f"BD-E phone {dev}": [it for it in items if it["domain"] == "BD-E" and it.get("device") == dev]}
        for recipe in ("erm", "isp"):
            if time.time() - T0 < 9.0 * 3600:
                run_fold(f"hold-out phone {dev}", train_rows, tests, recipe)

# ---------------------------------------------------------------- summary + final model
summary = defaultdict(list)
for fold, by_recipe in RESULTS["folds"].items():
    for recipe, res in by_recipe.items():
        for k, v in res.items():
            if isinstance(v, dict) and "macro_f1" in v:
                summary[recipe].append(v["macro_f1"])
RESULTS["summary"] = {r: {"mean_macro_f1": round(float(np.mean(v)), 4), "worst": round(float(np.min(v)), 4), "n_tests": len(v)}
                      for r, v in summary.items()}
best = max(RESULTS["summary"], key=lambda r: RESULTS["summary"][r]["mean_macro_f1"]) if RESULTS["summary"] else "isp"
RESULTS["final_recipe"] = best
log("summary:", RESULTS["summary"], "final recipe:", best); save()

m, temp = run_fold("final (all domains)", items, {}, best)


class Calibrated(nn.Module):
    def __init__(s, m, t):
        super().__init__(); s.m, s.t = m, t

    def forward(s, x):
        return F.softmax(s.m(x) / s.t, 1)


net = Calibrated(m.cpu().float().eval(), temp).eval()
torch.onnx.export(net, torch.randn(1, 3, CROP, CROP), f"{OUT}/krishilens_v1_rice.onnx", input_names=["image"],
                  output_names=["probs"], opset_version=17, dynamic_axes={"image": {0: "b"}, "probs": {0: "b"}}, dynamo=False)
json.dump({"labels": CORE, "temperature": temp, "resize_short_side": SHORT_SIDE, "resample": "bilinear, antialiased (PIL)",
           "center_crop": CROP, "mean": MEAN, "std": STD, "color": "RGB", "layout": "NCHW", "exif_orientation": "applied",
           "output": "calibrated probabilities (softmax(logits / temperature))", "recipe": best,
           "training_data": "Dhan-Shomadhan, RiceyLeafDisease, RiceLeafDisease-BD5, RiceLeafDiseaseBD (all CC BY 4.0, Mendeley Data)"},
          open(f"{OUT}/preprocess.json", "w"), indent=2)
try:
    import onnxruntime as ort
    rows = random.sample(items, min(64, len(items)))
    x = torch.stack([DS(rows, False)[k][0] for k in range(len(rows))])
    with torch.no_grad():
        ref = net(x).numpy()
    got = ort.InferenceSession(f"{OUT}/krishilens_v1_rice.onnx", providers=["CPUExecutionProvider"]).run(None, {"image": x.numpy()})[0]
    RESULTS["onnx_check"] = {"max_abs_diff": float(np.abs(ref - got).max()), "top1_agreement": float((ref.argmax(1) == got.argmax(1)).mean()),
                             "mb": round(os.path.getsize(f"{OUT}/krishilens_v1_rice.onnx") / 1e6, 2)}
except Exception as e:
    RESULTS["onnx_check"] = {"error": str(e)[:200]}
RESULTS["finished_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
save(); log("DONE", json.dumps(RESULTS["summary"]), RESULTS.get("onnx_check"))
