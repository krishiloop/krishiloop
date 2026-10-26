"""KrishiLoop rice leaf model: dedupe -> leakage-free split -> baseline -> calibration -> honest cross-dataset eval -> ONNX.

Runs as a Kaggle *script* kernel with GPU + internet, datasets attached:
  - alamshihab075/rice-leaf-disease-an-images-dataset  (train; MIT)
  - imbikramsaha/paddy-doctor                          (cross-dataset test; CC0)
Outputs (in /kaggle/working): metrics.json, dedupe_report.json, label_map.json, model.onnx, model_int8.onnx, confusion_*.csv
No numbers are reported anywhere unless they come from this script's output.
"""
import os, sys, json, time, glob, random, subprocess
from collections import Counter, defaultdict

subprocess.run([sys.executable, "-m", "pip", "install", "-q", "imagehash", "onnx", "onnxruntime", "onnxscript"], check=False)

import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from PIL import Image, ImageFile
import imagehash, timm
from sklearn.metrics import f1_score, recall_score, roc_auc_score, confusion_matrix

ImageFile.LOAD_TRUNCATED_IMAGES = True
SEED = 42; random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
OUT = "/kaggle/working"; CACHE = "/tmp/cache256"; os.makedirs(CACHE, exist_ok=True)
DEV = "cuda" if torch.cuda.is_available() else "cpu"
T0 = time.time()
def log(*a): print(f"[{time.time()-T0:7.0f}s]", *a, flush=True)

# ---------------- 1. discover images ----------------
EXT = (".jpg", ".jpeg", ".png", ".bmp", ".webp", ".JPG", ".JPEG", ".PNG")
def find_root(keyword):
    # Kaggle mounts datasets at /kaggle/input/<slug> or /kaggle/input/datasets/<owner>/<slug>; search a few levels.
    for depth in range(1, 5):
        for d in sorted(glob.glob("/kaggle/input/" + "/".join(["*"] * depth))):
            if os.path.isdir(d) and keyword in os.path.basename(d): return d
    raise SystemExit(f"dataset folder containing '{keyword}' not found: {glob.glob('/kaggle/input/**', recursive=True)[:30]}")

SYN = {  # normalised folder name -> shared label code
    "bacterial_blight": "bacterial_leaf_blight", "bacterial_leaf_blight": "bacterial_leaf_blight", "blb": "bacterial_leaf_blight",
    "brown_spot": "brown_spot", "brownspot": "brown_spot",
    "blast": "rice_blast", "leaf_blast": "rice_blast", "rice_blast": "rice_blast", "leafblast": "rice_blast",
    "healthy": "healthy", "normal": "healthy", "healthy_rice_leaf": "healthy",
    "tungro": "tungro", "hispa": "hispa", "bacterial_streak": "bacterial_leaf_streak", "bacterial_leaf_streak": "bacterial_leaf_streak",
    "narrow_brown_spot": "narrow_brown_spot", "leaf_scald": "leaf_scald", "sheath_blight": "sheath_blight",
    "false_smut": "false_smut", "bakanae": "bakanae", "leaf_smut": "leaf_smut", "dead_heart": "dead_heart",
    "downy_mildew": "downy_mildew", "bacterial_panicle_blight": "bacterial_panicle_blight", "neck_blast": "neck_blast",
}
def norm(name):
    k = name.strip().lower().replace("-", " ").replace("  ", " ").replace(" ", "_")
    return SYN.get(k, k)

def collect(root, skip_dirs=()):
    items = []
    for dirpath, _, files in os.walk(root):
        if any(s in dirpath for s in skip_dirs): continue
        imgs = [f for f in files if f.endswith(EXT)]
        if not imgs: continue
        label = norm(os.path.basename(dirpath))
        items += [(os.path.join(dirpath, f), label) for f in imgs]
    return items

A_ROOT = find_root("rice-leaf-disease"); P_ROOT = find_root("paddy")
A = collect(A_ROOT)
P = collect(P_ROOT, skip_dirs=("test_images", ".ipynb_checkpoints"))
log("train-source images:", len(A), Counter(l for _, l in A).most_common())
log("cross-test images:", len(P), Counter(l for _, l in P).most_common())

# ---------------- 2. cache resized copies + perceptual hashes ----------------
from concurrent.futures import ThreadPoolExecutor
def prep(args):
    i, path = args
    out = f"{CACHE}/{i}.jpg"
    try:
        im = Image.open(path).convert("RGB")
        im.thumbnail((320, 320))
        h = str(imagehash.phash(im))
        if not os.path.exists(out): im.save(out, quality=92)
        return i, out, h
    except Exception as e:
        return i, None, None
allp = [p for p, _ in A] + [p for p, _ in P]
with ThreadPoolExecutor(8) as ex:
    res = list(ex.map(prep, enumerate(allp), chunksize=64))
cache = {i: o for i, o, h in res}; hashes = {i: h for i, o, h in res}
nA = len(A)
log("cached + hashed", sum(1 for v in cache.values() if v), "of", len(allp))

# ---------------- 3. near-duplicate detection (LSH on 8x8-bit bands, Hamming <= 6) ----------------
HD = 6
ints = {i: int(h, 16) for i, h in hashes.items() if h}
buckets = defaultdict(list)
for i, v in ints.items():
    for b in range(8):
        buckets[(b, (v >> (8 * b)) & 0xFF)].append(i)
parent = {i: i for i in ints}
def find(x):
    while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
    return x
pairs = 0
for key, ids in buckets.items():
    if len(ids) > 4000: ids = ids[:4000]  # guard against degenerate buckets
    for a in range(len(ids)):
        va = ints[ids[a]]
        for b in range(a + 1, len(ids)):
            if bin(va ^ ints[ids[b]]).count("1") <= HD:
                ra, rb = find(ids[a]), find(ids[b])
                if ra != rb: parent[ra] = rb; pairs += 1
groups = {i: find(i) for i in ints}
a_groups = {groups[i] for i in range(nA) if i in groups}
cross_dupe = [j for j in range(nA, len(allp)) if j in groups and groups[j] in a_groups]
log("near-duplicate unions:", pairs, "| cross-dataset duplicates removed from test:", len(cross_dupe))

# ---------------- 4. leakage-free split of the training source (by duplicate group) ----------------
labels_A = sorted({l for _, l in A})
L2I = {l: k for k, l in enumerate(labels_A)}
g_by_label = defaultdict(set)
for i, (_, l) in enumerate(A):
    if cache.get(i): g_by_label[l].add(groups.get(i, i))
val_groups = set()
for l, gs in g_by_label.items():
    gs = sorted(gs); random.shuffle(gs); val_groups |= set(gs[: max(1, int(0.15 * len(gs)))])
train_idx = [i for i in range(nA) if cache.get(i) and groups.get(i, i) not in val_groups]
val_idx = [i for i in range(nA) if cache.get(i) and groups.get(i, i) in val_groups]
shared = sorted(set(labels_A) & {l for _, l in P})
ood_labels = sorted({l for _, l in P} - set(labels_A))
cross_idx = [nA + k for k, (_, l) in enumerate(P) if cache.get(nA + k) and l in shared and (nA + k) not in set(cross_dupe)]
ood_idx = [nA + k for k, (_, l) in enumerate(P) if cache.get(nA + k) and l in ood_labels]
log("train", len(train_idx), "val", len(val_idx), "| shared labels", shared, "| cross-test", len(cross_idx), "| OOD", len(ood_idx), ood_labels)
json.dump({"near_dup_hamming": HD, "unions": pairs, "cross_dataset_duplicates_removed": len(cross_dupe),
           "train": len(train_idx), "val": len(val_idx), "cross_test": len(cross_idx), "ood": len(ood_idx),
           "shared_labels": shared, "ood_labels": ood_labels}, open(f"{OUT}/dedupe_report.json", "w"), indent=2)
json.dump({"labels": labels_A}, open(f"{OUT}/label_map.json", "w"), indent=2)

# ---------------- 5. data ----------------
import torchvision.transforms as T
MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)
tf_train = T.Compose([T.RandomResizedCrop(224, scale=(0.5, 1.0)), T.RandomHorizontalFlip(), T.RandomVerticalFlip(),
                      T.ColorJitter(0.3, 0.3, 0.3, 0.05), T.RandomApply([T.GaussianBlur(5)], p=0.2), T.ToTensor(), T.Normalize(MEAN, STD)])
tf_eval = T.Compose([T.Resize(256), T.CenterCrop(224), T.ToTensor(), T.Normalize(MEAN, STD)])
all_labels = [l for _, l in A] + [l for _, l in P]
class DS(Dataset):
    def __init__(s, idx, tf): s.idx, s.tf = idx, tf
    def __len__(s): return len(s.idx)
    def __getitem__(s, k):
        i = s.idx[k]; return s.tf(Image.open(cache[i]).convert("RGB")), L2I.get(all_labels[i], -1)
dl = lambda idx, tf, sh: DataLoader(DS(idx, tf), batch_size=64, shuffle=sh, num_workers=4, pin_memory=True, drop_last=sh)

# ---------------- 6. model ----------------
model = None
for name in ["mobilenetv4_conv_small.e2400_r224_in1k", "mobilenetv3_large_100.ra_in1k", "efficientnet_b0.ra_in1k"]:
    try: model = timm.create_model(name, pretrained=True, num_classes=len(labels_A)); MODEL_NAME = name; break
    except Exception as e: log("model unavailable:", name, str(e)[:80])
model = model.to(DEV); log("model:", MODEL_NAME)
counts = Counter(all_labels[i] for i in train_idx)
w = torch.tensor([1.0 / max(1, counts[l]) for l in labels_A]); w = (w / w.mean()).to(DEV)
EPOCHS = 10
opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=0.05)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=1e-3, total_steps=EPOCHS * len(dl(train_idx, tf_train, True)))
scaler = torch.cuda.amp.GradScaler(enabled=DEV == "cuda")
train_loader = dl(train_idx, tf_train, True)
for ep in range(EPOCHS):
    model.train(); tot = 0
    for x, y in train_loader:
        x, y = x.to(DEV, non_blocking=True), y.to(DEV, non_blocking=True)
        with torch.autocast(device_type="cuda", enabled=DEV == "cuda"):
            loss = F.cross_entropy(model(x), y, weight=w, label_smoothing=0.05)
        opt.zero_grad(set_to_none=True); scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); sched.step()
        tot += loss.item()
    log(f"epoch {ep+1}/{EPOCHS} loss {tot/len(train_loader):.4f}")

@torch.no_grad()
def logits_of(idx):
    model.eval(); outs, ys = [], []
    for x, y in dl(idx, tf_eval, False):
        with torch.autocast(device_type="cuda", enabled=DEV == "cuda"):
            outs.append(model(x.to(DEV)).float().cpu())
        ys.append(y)
    return torch.cat(outs), torch.cat(ys)

# ---------------- 7. calibration (temperature on val) + metrics ----------------
lv, yv = logits_of(val_idx)
temp = torch.ones(1, requires_grad=True)
o = torch.optim.LBFGS([temp], lr=0.1, max_iter=200)
def closure():
    o.zero_grad(); l = F.cross_entropy(lv / temp.clamp(min=0.05), yv); l.backward(); return l
o.step(closure); T_opt = float(temp.clamp(min=0.05))
def ece(probs, y, bins=15):
    conf, pred = probs.max(1); acc = (pred == y).float(); e = torch.zeros(1)
    edges = torch.linspace(0, 1, bins + 1)
    for a, b in zip(edges[:-1], edges[1:]):
        m = (conf > a) & (conf <= b)
        if m.any(): e += m.float().mean() * (conf[m].mean() - acc[m].mean()).abs()
    return float(e)
pv_raw, pv_cal = F.softmax(lv, 1), F.softmax(lv / T_opt, 1)
pred_v = pv_cal.argmax(1)
metrics = {"model": MODEL_NAME, "epochs": EPOCHS, "temperature": T_opt, "labels": labels_A,
  "in_dataset_val": {"n": len(val_idx), "macro_f1": float(f1_score(yv, pred_v, average="macro")),
                     "accuracy": float((pred_v == yv).float().mean()),
                     "per_class_recall": dict(zip(labels_A, map(float, recall_score(yv, pred_v, average=None, labels=range(len(labels_A)), zero_division=0)))),
                     "ece_before": ece(pv_raw, yv), "ece_after": ece(pv_cal, yv)}}
np.savetxt(f"{OUT}/confusion_val.csv", confusion_matrix(yv, pred_v, labels=range(len(labels_A))), fmt="%d", delimiter=",")

# cross-dataset: shared labels only, logits restricted to shared classes
if cross_idx:
    lc, _ = logits_of(cross_idx)
    sh_ids = [L2I[l] for l in shared]
    yc = torch.tensor([sh_ids.index(L2I[all_labels[i]]) for i in cross_idx])
    pc = F.softmax(lc[:, sh_ids] / T_opt, 1); pred_c = pc.argmax(1)
    metrics["cross_dataset_shared_labels"] = {"n": len(cross_idx), "labels": shared,
        "macro_f1": float(f1_score(yc, pred_c, average="macro")), "accuracy": float((pred_c == yc).float().mean()),
        "per_class_recall": dict(zip(shared, map(float, recall_score(yc, pred_c, average=None, labels=range(len(shared)), zero_division=0)))),
        "ece": ece(pc, yc)}
    np.savetxt(f"{OUT}/confusion_cross.csv", confusion_matrix(yc, pred_c, labels=range(len(shared))), fmt="%d", delimiter=",")
# OOD: max-softmax confidence, in-distribution val vs unseen paddy classes
if ood_idx:
    lo, _ = logits_of(ood_idx)
    s_in = F.softmax(lv / T_opt, 1).max(1).values.numpy(); s_out = F.softmax(lo / T_opt, 1).max(1).values.numpy()
    yy = np.r_[np.ones_like(s_in), np.zeros_like(s_out)]
    metrics["ood_max_softmax"] = {"n_in": len(s_in), "n_out": len(s_out), "auroc": float(roc_auc_score(yy, np.r_[s_in, s_out])),
                                  "ood_labels": ood_labels}
    for thr in (0.5, 0.6, 0.7, 0.8):
        metrics.setdefault("abstain_thresholds", {})[str(thr)] = {
            "in_dist_abstain_rate": float((s_in < thr).mean()), "ood_caught_rate": float((s_out < thr).mean())}
log(json.dumps(metrics, indent=2)[:3000])
json.dump(metrics, open(f"{OUT}/metrics.json", "w"), indent=2)

# ---------------- 8. export ONNX (+ int8) ----------------
model.eval().cpu()
class WithT(nn.Module):
    def __init__(s, m, t): super().__init__(); s.m, s.t = m, t
    def forward(s, x): return F.softmax(s.m(x) / s.t, dim=1)
torch.onnx.export(WithT(model, T_opt), torch.randn(1, 3, 224, 224), f"{OUT}/model.onnx", input_names=["image"],
                  output_names=["probs"], opset_version=17, dynamic_axes={"image": {0: "batch"}, "probs": {0: "batch"}})
try:
    from onnxruntime.quantization import quantize_dynamic, QuantType
    quantize_dynamic(f"{OUT}/model.onnx", f"{OUT}/model_int8.onnx", weight_type=QuantType.QInt8)
except Exception as e: log("int8 quantization failed:", e)
torch.save(model.state_dict(), f"{OUT}/model_state.pt")
log("done; sizes MB:", {f: round(os.path.getsize(f"{OUT}/{f}") / 1e6, 2) for f in os.listdir(OUT) if f.endswith((".onnx", ".pt"))})
