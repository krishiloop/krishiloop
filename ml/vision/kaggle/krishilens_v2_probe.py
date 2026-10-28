"""KrishiLens v2 probe: do frozen foundation features, zero-shot text prompts or a few labelled photos from the new
domain fix the v1 cross-dataset collapse?

v1 (krishilens_v1_lodo.py -> artifacts/lodo.json): a fine-tuned MobileNetV4 reached macro-F1 0.12-0.35 on held-out
Bangladeshi rice domains (mean 0.27 over 4 folds), while colour statistics alone identified the source dataset at
99.4%. The v1 summary line (0.41) wrongly averaged in BD-B, which was in training for that fold; fixed here.

Experiments (same licence-clean CC BY 4.0 domains, same dedupe, same core classes as v1):
  E1 frozen backbone + linear probe, leave-one-domain-out (DINOv2-B/L, DINOv3-B, BioCLIP 2, SigLIP 2)
  E2 zero-shot text prompts (BioCLIP 2, SigLIP 2): no training on any source domain
  E3 few-shot adaptation: k labelled photos per class from the held-out domain (k = 1, 5, 10, 25; 3 draws);
     whole duplicate groups are kept apart from the test set
  E4 abstention: max-probability vs similarity-to-source (kNN) as the "can we trust this photo?" score, plus the
     product gate (top-1 >= 0.85): pass rate and precision
  E5 grey-world colour constancy before the backbone (DINOv2-B, BioCLIP 2)
  E6 leave-one-phone-out inside BD-E, if the metadata sheet lets us tell the phones apart
  E7 how well each backbone's features identify the source dataset (capture fingerprint)
Protocol: probe weight decay chosen on SOURCE validation (whole duplicate groups), temperature fitted on the same
source validation; nothing is tuned on a held-out domain.
Outputs (/kaggle/working): probe.json, meta.json, emb_<backbone>.npz (fp16 features, for local follow-ups).
Re-run the analysis locally on saved features: python krishilens_v2_probe.py --analyse <dir with meta.json + npz>
"""
import io, json, os, random, re, subprocess, sys, time, urllib.error, urllib.request, zipfile
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

ANALYSE_DIR = sys.argv[sys.argv.index("--analyse") + 1] if "--analyse" in sys.argv else None
if not ANALYSE_DIR:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-U", "timm>=1.0.20", "open_clip_torch"], check=False)   # DINOv3 needs timm 1.0.20+
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "imagehash", "rarfile", "openpyxl"], check=False)
    subprocess.run("(apt-get install -y -qq unar || apt-get install -y -qq unrar-free) > /dev/null 2>&1 || true", shell=True)

import warnings
import numpy as np
import torch
import torch.nn.functional as F
from sklearn.metrics import balanced_accuracy_score, f1_score, roc_auc_score

warnings.filterwarnings("ignore", message="y_pred contains classes not in y_true")
SEED = 7
random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
DEV = "cuda" if torch.cuda.is_available() else "cpu"
OUT = ANALYSE_DIR or "/kaggle/working"
RAW, CACHE = "/tmp/raw", "/tmp/cache"
T0 = time.time()
CORE = ["healthy", "blast", "brown_spot", "tungro", "sheath_blight"]
NC = len(CORE)
SHORT_SIDE = 256
RESULTS = {"started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "seed": SEED,
           "v1_reference": {"note": "fine-tuned MobileNetV4, artifacts/lodo.json; mean over the 4 held-out domains only",
                            "erm_mean_macro_f1": 0.2668, "isp_mean_macro_f1": 0.2436, "erm_worst": 0.1192}}


def log(*a):
    print(f"[{time.time() - T0:7.0f}s]", *a, flush=True)


def save():
    json.dump(RESULTS, open(f"{OUT}/probe.json", "w"), indent=2)


BACKBONES = [  # (name, kind, model id); a backbone that fails to load is skipped and logged
    ("dinov2_b", "timm", "vit_base_patch14_dinov2.lvd142m"),
    ("dinov2_l", "timm", "vit_large_patch14_dinov2.lvd142m"),
    ("dinov3_b", "timm", "vit_base_patch16_dinov3.lvd1689m"),
    ("bioclip2", "open_clip", ("hf-hub:imageomics/bioclip-2", None)),
    ("siglip2_b", "open_clip", ("ViT-B-16-SigLIP2", "webli")),
]
GREYWORLD = {"dinov2_b", "bioclip2"}
PROMPTS = {  # zero-shot class descriptions (experiment only; never shown to farmers)
    "healthy": ["a photo of a healthy rice leaf.", "a close-up photo of a healthy green rice leaf with no disease spots.",
                "a healthy leaf of Oryza sativa."],
    "blast": ["a photo of a rice leaf with rice blast disease.",
              "a close-up photo of a rice leaf with diamond-shaped grey lesions with brown borders.",
              "a leaf of Oryza sativa infected by Pyricularia oryzae."],
    "brown_spot": ["a photo of a rice leaf with brown spot disease.",
                   "a close-up photo of a rice leaf with many small oval brown spots.",
                   "a leaf of Oryza sativa infected by Bipolaris oryzae."],
    "tungro": ["a photo of a rice leaf with rice tungro disease.",
               "a photo of yellow-orange discoloured rice leaves on a stunted rice plant.",
               "a leaf of Oryza sativa infected by rice tungro virus."],
    "sheath_blight": ["a photo of a rice plant with sheath blight disease.",
                      "a close-up photo of rice with large oval greenish-grey lesions with brown margins.",
                      "Oryza sativa infected by Rhizoctonia solani."],
}

# ================================================================ data + features (Kaggle only)
if not ANALYSE_DIR:
    import imagehash
    import timm
    import torchvision.transforms as T
    from PIL import Image, ImageOps
    from torch.utils.data import DataLoader, Dataset

    for d in (RAW, CACHE):
        os.makedirs(d, exist_ok=True)
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

    SOURCES = [  # (domain resolver, mendeley id, version, skip predicate) -- identical to v1
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
    log("downloads done")

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

    # BD-E phones: the metadata sheet maps New_Filename -> Original_Filename. Google Pixel cameras name files PXL_*.
    orig_name, orig_wh = {}, {}
    try:
        import pandas as pd
        for dp, _, fs in os.walk(ROOTS.get("munna", "/nonexistent")):
            for f in fs:
                if f.lower().endswith(".xlsx"):
                    df = pd.read_excel(os.path.join(dp, f), sheet_name="Image_Metadata")
                    for _, r in df.iterrows():
                        k = os.path.basename(str(r["New_Filename"])).lower()
                        orig_name[k] = str(r["Original_Filename"])
                        orig_wh[k] = f"{r['Original_Width_px']}x{r['Original_Height_px']}"
    except Exception as e:
        log("metadata parse failed", str(e)[:160])

    def device_of(it):
        o = orig_name.get(os.path.basename(it["path"]).lower())
        if not o:
            return None
        return "pixel (PXL_ filename)" if o.upper().startswith("PXL_") else "non-PXL filename"

    pattern = Counter(re.sub(r"[0-9]", "9", v)[:14] for v in orig_name.values())
    RESULTS["bd_e_device_evidence"] = {"metadata_rows": len(orig_name), "filename_patterns_top": pattern.most_common(8),
                                       "original_sizes_top": Counter(orig_wh.values()).most_common(8)}
    log("BD-E device evidence:", RESULTS["bd_e_device_evidence"])

    def prep(i_it):
        i, it = i_it
        out = f"{CACHE}/{i}.jpg"
        try:
            with Image.open(it["path"]) as im0:
                im = ImageOps.exif_transpose(im0).convert("RGB")
            w, h = im.size
            s = SHORT_SIDE / min(w, h)
            im = im.resize((max(SHORT_SIDE, round(w * s)), max(SHORT_SIDE, round(h * s))), Image.BILINEAR)
            im.save(out, quality=97)
            it["cache"] = out
            hs = [int(str(imagehash.phash(t)), 16) for t in (im, im.transpose(Image.FLIP_LEFT_RIGHT))
                  for t in (t, t.rotate(90, expand=True), t.rotate(180), t.rotate(270, expand=True))]
            it["phash"] = min(hs)   # D4-invariant: rotated or flipped copies hash the same
        except Exception:
            it["cache"] = None
        return it

    with ThreadPoolExecutor(8) as ex:
        items = [it for it in ex.map(prep, enumerate(items)) if it.get("cache")]
    for it in items:
        it["device"] = device_of(it) if it["domain"] == "BD-E" else None
    log("cached:", len(items))

    # dedupe exactly as v1: banded LSH, Hamming <= 6; drop cross-domain and label-conflict groups
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
    for ids in buckets.values():
        ids = np.array(ids)
        for s in range(0, len(ids), 256):
            a = ids[s:s + 256]
            x = H[a][:, None] ^ H[ids][None, :]
            dist = np.unpackbits(x.view(np.uint8).reshape(len(a), len(ids), 8), axis=2).sum(2)
            for ai, bj in zip(*np.nonzero(dist <= 6)):
                i, j = int(a[ai]), int(ids[bj])
                if i < j:
                    ri, rj = find(i), find(j)
                    if ri != rj:
                        parent[ri] = rj
    groups = [find(i) for i in range(len(items))]
    dom_of_group, lab_of_group = defaultdict(set), defaultdict(set)
    for it, g in zip(items, groups):
        dom_of_group[g].add(it["domain"] if it["domain"] not in ("BD-A", "BD-B") else "BD-AB")
        lab_of_group[g].add(it["label"])
    items = [dict(it, group=g) for it, g in zip(items, groups) if len(dom_of_group[g]) == 1 and len(lab_of_group[g]) == 1]
    items = [it for it in items if it["label"] in CORE]
    RESULTS["counts"] = {d: dict(Counter(it["label"] for it in items if it["domain"] == d)) for d in sorted({it["domain"] for it in items})}
    RESULTS["bd_e_devices"] = dict(Counter(it["device"] for it in items if it["domain"] == "BD-E"))
    log("counts:", RESULTS["counts"], "BD-E devices:", RESULTS["bd_e_devices"]); save()
    json.dump({"core": CORE, "fields": ["domain", "label", "group", "device"],
               "rows": [[it["domain"], it["label"], int(it["group"]), it["device"]] for it in items]},
              open(f"{OUT}/meta.json", "w"))

    def greyworld(im):
        a = np.asarray(im, dtype=np.float32)
        m = a.reshape(-1, 3).mean(0)
        return Image.fromarray(np.clip(a * (m.mean() / (m + 1e-6)), 0, 255).astype(np.uint8))

    class EmbDS(Dataset):
        def __init__(s, rows, tf, grey):
            s.rows, s.tf, s.grey = rows, tf, grey

        def __len__(s):
            return len(s.rows)

        def __getitem__(s, k):
            im = Image.open(s.rows[k]["cache"]).convert("RGB")
            return s.tf(greyworld(im) if s.grey else im)

    @torch.no_grad()
    def embed(encode, tf, grey):
        out = []
        for x in DataLoader(EmbDS(items, tf, grey), batch_size=128, num_workers=4):
            with torch.autocast("cuda", enabled=DEV == "cuda"):
                out.append(encode(x.to(DEV)).float().cpu())
        return torch.cat(out).numpy()

    RESULTS["backbones"] = {}
    for name, kind, mid in BACKBONES:
        try:
            t = time.time(); text = {}
            if kind == "timm":
                try:   # pretrained cfg says 518 for DINOv2; run every backbone at 224 for a like-for-like comparison
                    m = timm.create_model(mid, pretrained=True, num_classes=0, img_size=224); size = 224
                except Exception:
                    m = timm.create_model(mid, pretrained=True, num_classes=0); size = None
                m = m.to(DEV).eval()
                cfg = timm.data.resolve_model_data_config(m)
                size = size or cfg["input_size"][-1]
                tf = T.Compose([T.Resize(size, antialias=True), T.CenterCrop(size), T.ToTensor(), T.Normalize(cfg["mean"], cfg["std"])])
                encode = m
            else:
                import open_clip
                arch, pt = mid
                m, _, tf = open_clip.create_model_and_transforms(arch, pretrained=pt) if pt else open_clip.create_model_and_transforms(arch)
                m = m.to(DEV).eval()
                tok = open_clip.get_tokenizer(arch)
                with torch.no_grad():
                    for c in CORE:
                        e = m.encode_text(tok(PROMPTS[c]).to(DEV)).float()
                        text[c] = F.normalize(F.normalize(e, dim=-1).mean(0), dim=0).cpu().numpy()
                encode = m.encode_image
            for grey in ([False, True] if name in GREYWORLD else [False]):
                X = embed(encode, tf, grey)
                key = name + ("_grey" if grey else "")
                payload = {"X": X.astype(np.float16)}
                if text:
                    payload["T"] = np.stack([text[c] for c in CORE]).astype(np.float32)
                np.savez_compressed(f"{OUT}/emb_{key}.npz", **payload)
                RESULTS["backbones"][key] = {"model": str(mid), "dim": int(X.shape[1]), "zero_shot": bool(text),
                                             "seconds": round(time.time() - t)}
                log("embedded", key, X.shape)
            del m; torch.cuda.empty_cache()
        except Exception as e:
            RESULTS["backbones"][name] = {"model": str(mid), "error": str(e)[:300]}
            log("BACKBONE FAILED", name, str(e)[:300])
        save()

# ================================================================ analysis (Kaggle or local)
meta = json.load(open(f"{OUT}/meta.json"))
DOM = np.array([r[0] for r in meta["rows"]]); LAB = np.array([CORE.index(r[1]) for r in meta["rows"]])
GRP = np.array([r[2] for r in meta["rows"]]); DEVICE = np.array([r[3] or "" for r in meta["rows"]])
ALL = np.arange(len(DOM))
FEATS = {f[4:-4]: f for f in sorted(os.listdir(OUT)) if f.startswith("emb_") and f.endswith(".npz")}
log("features:", list(FEATS))


def l2n(X):
    return X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-8)


def balance_weights(idx):
    cell = Counter(zip(DOM[idx], LAB[idx])); dom = Counter(DOM[idx])
    w = np.array([1 / np.sqrt(cell[(DOM[i], LAB[i])]) / np.sqrt(dom[DOM[i]]) for i in idx])
    return w / w.mean()


def split_groups(idx, frac=0.15):
    gs = sorted(set(GRP[idx].tolist())); random.Random(SEED).shuffle(gs)
    val = set(gs[:max(1, int(frac * len(gs)))])
    m = np.array([g in val for g in GRP[idx]])
    return idx[~m], idx[m]


def fit_linear(X, y, w, wd):
    """Weighted multinomial logistic regression, full-batch LBFGS."""
    Xt = torch.tensor(X, dtype=torch.float32, device=DEV); yt = torch.tensor(y, device=DEV)
    wt = torch.tensor(w / w.sum(), dtype=torch.float32, device=DEV)
    W = torch.zeros(X.shape[1], NC, device=DEV, requires_grad=True); b = torch.zeros(NC, device=DEV, requires_grad=True)
    opt = torch.optim.LBFGS([W, b], lr=1, max_iter=300, history_size=20, line_search_fn="strong_wolfe")

    def closure():
        opt.zero_grad()
        loss = (F.cross_entropy(Xt @ W + b, yt, reduction="none") * wt).sum() + wd * (W * W).sum()
        loss.backward(); return loss
    opt.step(closure)
    return W.detach().cpu().numpy(), b.detach().cpu().numpy()


def softmax(z):
    z = z - z.max(1, keepdims=True); e = np.exp(z); return e / e.sum(1, keepdims=True)


def macro_f1(y, pred):
    return float(f1_score(y, pred, labels=sorted(set(y.tolist())), average="macro", zero_division=0))


class Probe:
    """Standardise on source-train, choose weight decay on source validation, fit temperature on the same validation."""

    def __init__(s, X, tr, va, extra=None, extra_weight=0.25):
        s.mu, s.sd = X[tr].mean(0), X[tr].std(0) + 1e-6
        Z = lambda idx: (X[idx] - s.mu) / s.sd
        w = balance_weights(tr); xs, ys = Z(tr), LAB[tr]
        if extra is not None and len(extra):   # few-shot target photos carry extra_weight of the total weight
            xs = np.vstack([xs, Z(extra)]); ys = np.concatenate([ys, LAB[extra]])
            w = np.concatenate([w, np.full(len(extra), extra_weight * w.sum() / len(extra))])
        best = None
        for wd in (1e-4, 1e-3, 1e-2):
            W, b = fit_linear(xs, ys, w, wd)
            f = macro_f1(LAB[va], (Z(va) @ W + b).argmax(1))
            if best is None or f > best[0]:
                best = (f, wd, W, b)
        s.val_f1, s.wd, s.W, s.b = best
        lv = Z(va) @ s.W + s.b
        temps = np.exp(np.linspace(np.log(0.05), np.log(20), 120))
        s.T = float(temps[np.argmin([-np.log(softmax(lv / t)[np.arange(len(va)), LAB[va]] + 1e-12).mean() for t in temps])])
        s.Z = Z

    def proba(s, idx):
        return softmax((s.Z(idx) @ s.W + s.b) / s.T)


def knn_sim(Xn, query, ref, k=10):
    R = Xn[ref]; out = np.empty(len(query), np.float32)
    for s in range(0, len(query), 2048):
        S = Xn[query[s:s + 2048]] @ R.T
        out[s:s + 2048] = np.partition(S, -k, axis=1)[:, -k:].mean(1)
    return out


def ece(P, y, bins=15):
    conf, pred = P.max(1), P.argmax(1); edges, e = np.linspace(0, 1, bins + 1), 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        sel = (conf > lo) & (conf <= hi)
        if sel.any():
            e += sel.mean() * abs((pred[sel] == y[sel]).mean() - conf[sel].mean())
    return float(e)


def nanmean(v):
    return round(float(np.nanmean(v)), 4) if np.isfinite(v).any() else None


def auroc(correct, score):
    return round(float(roc_auc_score(correct, score)), 4) if 0 < correct.mean() < 1 else None


def metrics(P, idx, knn=None):
    y = LAB[idx]; pred = P.argmax(1); conf = P.max(1); correct = (pred == y)
    order = np.argsort(-conf); cum = np.cumsum(correct[order]) / np.arange(1, len(y) + 1)
    gate = conf >= 0.85
    out = {"n": int(len(y)), "classes_present": [CORE[c] for c in sorted(set(y.tolist()))],
           "macro_f1": round(macro_f1(y, pred), 4), "balanced_accuracy": round(float(balanced_accuracy_score(y, pred)), 4),
           "accuracy": round(float(correct.mean()), 4), "ece": round(ece(P, y), 4),
           "selective_accuracy_at_50pct": round(float(cum[max(0, len(y) // 2 - 1)]), 4),
           "aurc": round(float((1 - cum).mean()), 4), "auroc_correct_vs_wrong_msp": auroc(correct, conf),
           "gate_085": {"pass_rate": round(float(gate.mean()), 4),
                        "precision": round(float(correct[gate].mean()), 4) if gate.any() else None},
           "per_class_recall": {CORE[c]: round(float((pred[y == c] == c).mean()), 4) for c in sorted(set(y.tolist()))}}
    if knn is not None:
        out["auroc_correct_vs_wrong_knn"] = auroc(correct, knn)
        kgate = gate & (knn >= np.quantile(knn, 0.5))
        out["gate_085_and_knn_top_half"] = {"pass_rate": round(float(kgate.mean()), 4),
                                            "precision": round(float(correct[kgate].mean()), 4) if kgate.any() else None}
    return out


def folds():
    for held in ("BD-A", "BD-C", "BD-D", "BD-E"):
        excluded = {"BD-A", "BD-B"} if held == "BD-A" else {held}
        src = ALL[~np.isin(DOM, list(excluded))]
        tests = {held: ALL[DOM == held]}
        if held == "BD-A":   # BD-B shares BD-A's phone but is excluded from training here, so it is a fair test
            tests["BD-B (white background)"] = ALL[DOM == "BD-B"]
        yield held, src, tests


X_CACHE = {}


def load(key):
    if key not in X_CACHE:
        z = np.load(f"{OUT}/{FEATS[key]}")
        X_CACHE[key] = (l2n(z["X"].astype(np.float32)), z["T"] if "T" in z.files else None)
    return X_CACHE[key]


# E1 + E4 + E5: leave-one-domain-out linear probes
RESULTS["e1_lodo"] = {}
for key in FEATS:
    try:
        X, _ = load(key); res = {}
        for held, src, tests in folds():
            tr, va = split_groups(src)
            p = Probe(X, tr, va)
            res[held] = {"weight_decay": p.wd, "temperature": round(p.T, 3), "source_val_macro_f1": round(p.val_f1, 4)}
            for tname, idx in tests.items():
                res[held][tname] = metrics(p.proba(idx), idx, knn_sim(X, idx, tr))
        held_f1 = [res[h][h]["macro_f1"] for h in res]
        res["summary"] = {"mean_heldout_macro_f1": round(float(np.mean(held_f1)), 4), "worst": round(float(np.min(held_f1)), 4),
                          "per_fold": dict(zip(res, held_f1))}
        RESULTS["e1_lodo"][key] = res
        log("E1", key, res["summary"])
    except Exception as e:
        RESULTS["e1_lodo"][key] = {"error": str(e)[:300]}; log("E1 FAILED", key, str(e)[:300])
    save()

# E2: zero-shot text prompts, every domain
RESULTS["e2_zero_shot"] = {}
for key in FEATS:
    X, Tm = load(key)
    if Tm is None:
        continue
    P = softmax(100.0 * X @ l2n(Tm).T)
    RESULTS["e2_zero_shot"][key] = {str(d): metrics(P[ALL[DOM == d]], ALL[DOM == d]) for d in sorted(set(DOM))}
    log("E2", key, {d: v["macro_f1"] for d, v in RESULTS["e2_zero_shot"][key].items()})
save()

# E7: does the frozen feature space identify the source dataset? (group split, linear probe on domain labels)
RESULTS["e7_domain_id"] = {}
for key in FEATS:
    X, _ = load(key)
    tr, va = split_groups(ALL, 0.2)
    doms = sorted(set(DOM)); yd = np.array([doms.index(d) for d in DOM])
    mu, sd = X[tr].mean(0), X[tr].std(0) + 1e-6
    NCd = len(doms)
    Xt = torch.tensor((X[tr] - mu) / sd, dtype=torch.float32, device=DEV); yt = torch.tensor(yd[tr], device=DEV)
    W = torch.zeros(X.shape[1], NCd, device=DEV, requires_grad=True); b = torch.zeros(NCd, device=DEV, requires_grad=True)
    opt = torch.optim.LBFGS([W, b], lr=1, max_iter=200, line_search_fn="strong_wolfe")

    def closure():
        opt.zero_grad(); loss = F.cross_entropy(Xt @ W + b, yt) + 1e-3 * (W * W).sum(); loss.backward(); return loss
    opt.step(closure)
    pred = (((X[va] - mu) / sd) @ W.detach().cpu().numpy() + b.detach().cpu().numpy()).argmax(1)
    RESULTS["e7_domain_id"][key] = {"accuracy": round(float((pred == yd[va]).mean()), 4),
                                    "balanced_accuracy": round(float(balanced_accuracy_score(yd[va], pred)), 4),
                                    "chance_majority": round(float(Counter(yd[va]).most_common(1)[0][1] / len(va)), 4)}
log("E7", RESULTS["e7_domain_id"]); save()

# E3: few-shot adaptation with k labelled photos per class from the held-out domain (top-2 backbones by E1)
ranked = sorted((k for k in RESULTS["e1_lodo"] if "summary" in RESULTS["e1_lodo"][k]),
                key=lambda k: -RESULTS["e1_lodo"][k]["summary"]["mean_heldout_macro_f1"])
RESULTS["e3_few_shot"] = {"protocol": "k photos per class from distinct duplicate groups; those groups are removed from the "
                                      "test set; shots carry 25% of the training weight; 3 random draws; 'ncm' = nearest "
                                      "class mean of the shots alone", "backbones": ranked[:2]}
for key in ranked[:2]:
    X, _ = load(key); res = {}
    for held, src, tests in folds():
        tr, va = split_groups(src); tgt = tests[held]; res[held] = {}
        for k in (1, 5, 10, 25):
            runs = []
            for draw in range(3):
                rng = np.random.RandomState(1000 * draw + k)
                shots = []
                for c in sorted(set(LAB[tgt].tolist())):
                    gs = sorted(set(GRP[tgt][LAB[tgt] == c].tolist())); rng.shuffle(gs)
                    for g in gs[:k]:
                        shots.append(int(rng.choice(tgt[(GRP[tgt] == g) & (LAB[tgt] == c)])))
                shots = np.array(shots); test = tgt[~np.isin(GRP[tgt], GRP[shots])]
                p = Probe(X, tr, va, extra=shots)
                m = metrics(p.proba(test), test, knn_sim(X, test, np.concatenate([tr, shots])))
                cls = sorted(set(LAB[shots].tolist()))
                protos = np.stack([l2n(X[shots][LAB[shots] == c].mean(0, keepdims=True))[0] for c in cls])
                ncm = np.array(cls)[(X[test] @ protos.T).argmax(1)]
                runs.append((m["macro_f1"], macro_f1(LAB[test], ncm), m["gate_085"]["pass_rate"], m["gate_085"]["precision"] if m["gate_085"]["precision"] is not None else np.nan,
                             m["auroc_correct_vs_wrong_msp"] if m["auroc_correct_vs_wrong_msp"] is not None else np.nan))
            r = np.array(runs)
            res[held][f"k={k}"] = {"probe_macro_f1": [round(float(r[:, 0].mean()), 4), round(float(r[:, 0].std()), 4)],
                                   "ncm_macro_f1": [round(float(r[:, 1].mean()), 4), round(float(r[:, 1].std()), 4)],
                                   "gate_085_pass_rate": round(float(r[:, 2].mean()), 4), "gate_085_precision": nanmean(r[:, 3]),
                                   "auroc_msp": nanmean(r[:, 4])}
        log("E3", key, held, {kk: v["probe_macro_f1"][0] for kk, v in res[held].items()})
    RESULTS["e3_few_shot"][key] = res
    save()

# E6: leave-one-phone-out inside BD-E (phone told apart by original filename; see bd_e_device_evidence)
RESULTS["e6_phone"] = {}
phones = [d for d, n in Counter(DEVICE[DOM == "BD-E"]).items() if d and n >= 200]
if len(phones) >= 2:
    for key in ranked[:2]:
        X, _ = load(key); res = {}
        for ph in phones:
            test = ALL[(DOM == "BD-E") & (DEVICE == ph)]
            src = ALL[~((DOM == "BD-E") & (DEVICE == ph)) & ~np.isin(GRP, GRP[test])]
            tr, va = split_groups(src)
            res[str(ph)] = metrics(Probe(X, tr, va).proba(test), test)
        RESULTS["e6_phone"][key] = res
        log("E6", key, {ph: v["macro_f1"] for ph, v in res.items()})
else:
    RESULTS["e6_phone"]["skipped"] = f"phones with >= 200 images: {phones}"
RESULTS["finished_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
save(); log("DONE")
