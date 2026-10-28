"""KrishiLoop rice vision v3: why did v2 collapse cross-dataset, and what generalises?

Experiments (all on perceptual-hash-deduplicated data, shared labels only for cross tests):
  E1  MobileNetV4-small fine-tune, NO class weights (v2 used inverse-frequency weights)   A->P
  E2  DINOv2 ViT-S/14 frozen features + logistic regression (linear probe)               A->P and P->A
  E3  DINOv2 probe trained on the UNION (A + P-train), tested on held-out groups of both  (deployment candidate)
  E4  MobileNetV4-small fine-tuned on the UNION (balanced sampling), same held-out groups  (on-device candidate)
A = alamshihab075/rice-leaf-disease-an-images-dataset (MIT), P = imbikramsaha/paddy-doctor train_images (CC0).
Outputs: experiments.json, label_map_union.json, mnv4_union.onnx, dinov2_probe_union.onnx (+ int8 if possible).
"""
import os, sys, json, time, glob, random, subprocess
from collections import Counter, defaultdict
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "imagehash", "onnx", "onnxruntime", "onnxscript"], check=False)
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from PIL import Image, ImageFile
import imagehash, timm
import torchvision.transforms as T
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, recall_score

ImageFile.LOAD_TRUNCATED_IMAGES = True
SEED = 42; random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
OUT = "/kaggle/working"; CACHE = "/tmp/cache256"; os.makedirs(CACHE, exist_ok=True)
DEV = "cuda" if torch.cuda.is_available() else "cpu"; T0 = time.time()
def log(*a): print(f"[{time.time()-T0:7.0f}s]", *a, flush=True)
RESULTS = {}
def save(): json.dump(RESULTS, open(f"{OUT}/experiments.json", "w"), indent=2)

# ---------- data discovery (same as v2) ----------
EXT = (".jpg", ".jpeg", ".png", ".bmp", ".webp", ".JPG", ".JPEG", ".PNG")
def find_root(k):
    for depth in range(1, 5):
        for d in sorted(glob.glob("/kaggle/input/" + "/".join(["*"] * depth))):
            if os.path.isdir(d) and k in os.path.basename(d): return d
    raise SystemExit(f"not found: {k}")
SYN = {"bacterial_blight": "bacterial_leaf_blight", "blb": "bacterial_leaf_blight", "brownspot": "brown_spot", "blast": "rice_blast",
       "leaf_blast": "rice_blast", "leafblast": "rice_blast", "normal": "healthy", "healthy_rice_leaf": "healthy", "bacterial_streak": "bacterial_leaf_streak"}
def norm(n):
    k = n.strip().lower().replace("-", " ").replace("  ", " ").replace(" ", "_"); return SYN.get(k, k)
def collect(root, skip=()):
    out = []
    for dp, _, fs in os.walk(root):
        if any(s in dp for s in skip): continue
        out += [(os.path.join(dp, f), norm(os.path.basename(dp))) for f in fs if f.endswith(EXT)]
    return out
A = collect(find_root("rice-leaf-disease")); P = collect(find_root("paddy"), ("test_images", ".ipynb_checkpoints"))
paths = [p for p, _ in A] + [p for p, _ in P]; labels = [l for _, l in A] + [l for _, l in P]
src = np.array([0] * len(A) + [1] * len(P)); nA = len(A)
log("A", len(A), "P", len(P))

# ---------- cache + pHash + dedupe groups ----------
from concurrent.futures import ThreadPoolExecutor
def prep(a):
    i, p = a; o = f"{CACHE}/{i}.jpg"
    try:
        im = Image.open(p).convert("RGB"); im.thumbnail((320, 320)); h = int(str(imagehash.phash(im)), 16)
        if not os.path.exists(o): im.save(o, quality=92)
        return i, o, h
    except Exception: return i, None, None
with ThreadPoolExecutor(8) as ex: res = list(ex.map(prep, enumerate(paths), chunksize=64))
cache = {i: o for i, o, h in res}; H = {i: h for i, o, h in res if h is not None}
parent = {i: i for i in H}
def find(x):
    while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
    return x
bk = defaultdict(list)
for i, v in H.items():
    for b in range(8): bk[(b, (v >> 8 * b) & 255)].append(i)
for ids in bk.values():
    ids = ids[:4000]
    for a in range(len(ids)):
        for b in range(a + 1, len(ids)):
            if bin(H[ids[a]] ^ H[ids[b]]).count("1") <= 6:
                ra, rb = find(ids[a]), find(ids[b])
                if ra != rb: parent[ra] = rb
grp = np.array([find(i) if i in H else i for i in range(len(paths))])
ok = np.array([cache.get(i) is not None for i in range(len(paths))])
a_grp = set(grp[:nA][ok[:nA]])
cross_dup = np.array([i >= nA and grp[i] in a_grp for i in range(len(paths))])
log("cached", ok.sum(), "| cross-dup in P:", cross_dup.sum())
shared = sorted(set(labels[:nA]) & set(labels[nA:]))
RESULTS["data"] = {"A": len(A), "P": len(P), "shared_labels": shared, "cross_duplicates_removed": int(cross_dup.sum())}

# group-level holdout (20%) inside each source, for union experiments
rng = np.random.RandomState(SEED)
ug = np.unique(grp); hold = set(rng.choice(ug, size=int(0.2 * len(ug)), replace=False))
is_hold = np.array([g in hold for g in grp])

MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)
tf_eval = T.Compose([T.Resize(256), T.CenterCrop(224), T.ToTensor(), T.Normalize(MEAN, STD)])
tf_train = T.Compose([T.RandomResizedCrop(224, scale=(0.35, 1.0)), T.RandomHorizontalFlip(), T.RandomVerticalFlip(),
                      T.ColorJitter(0.4, 0.4, 0.4, 0.08), T.RandomApply([T.GaussianBlur(5)], p=0.3), T.RandomGrayscale(0.05),
                      T.ToTensor(), T.Normalize(MEAN, STD)])
class DS(Dataset):
    def __init__(s, idx, y, tf): s.idx, s.y, s.tf = idx, y, tf
    def __len__(s): return len(s.idx)
    def __getitem__(s, k): return s.tf(Image.open(cache[s.idx[k]]).convert("RGB")), s.y[k]

def scores(y, p, names):
    return {"n": int(len(y)), "macro_f1": float(f1_score(y, p, average="macro")), "accuracy": float((np.array(y) == np.array(p)).mean()),
            "per_class_recall": {names[k]: float(r) for k, r in enumerate(recall_score(y, p, average=None, labels=range(len(names)), zero_division=0))}}

# ---------- E2/E3: DINOv2 features ----------
dino = timm.create_model("vit_small_patch14_dinov2.lvd142m", pretrained=True, num_classes=0, img_size=224).to(DEV).eval()
@torch.no_grad()
def embed(idx):
    dl = DataLoader(DS(idx, [0] * len(idx), tf_eval), batch_size=128, num_workers=4)
    out = []
    for x, _ in dl:
        with torch.autocast("cuda", enabled=DEV == "cuda"): out.append(F.normalize(dino(x.to(DEV)).float(), dim=1).cpu())
    return torch.cat(out).numpy()
all_idx = [i for i in range(len(paths)) if ok[i]]
E = np.zeros((len(paths), 384), dtype=np.float32); E[all_idx] = embed(all_idx); log("embedded", len(all_idx))

def probe(train_idx, test_idx, names, tag):
    L = {n: k for k, n in enumerate(names)}
    ytr = [L[labels[i]] for i in train_idx]; yte = [L[labels[i]] for i in test_idx]
    clf = LogisticRegression(max_iter=3000, C=2.0); clf.fit(E[train_idx], ytr)
    RESULTS[tag] = scores(yte, clf.predict(E[test_idx]), names); log(tag, {k: round(v, 3) for k, v in RESULTS[tag].items() if k != "per_class_recall"}); save()
    return clf
A_sh = [i for i in range(nA) if ok[i] and labels[i] in shared]
P_sh = [i for i in range(nA, len(paths)) if ok[i] and labels[i] in shared and not cross_dup[i]]
probe(A_sh, P_sh, shared, "E2_dinov2_probe_A_to_P")
probe([i for i in range(nA, len(paths)) if ok[i] and labels[i] in shared], [i for i in A_sh if not grp[i] in set(grp[nA:])], shared, "E2_dinov2_probe_P_to_A")

union_names = sorted(set(labels[i] for i in all_idx))
U_tr = [i for i in all_idx if not is_hold[i]]; U_te_A = [i for i in all_idx if is_hold[i] and src[i] == 0]; U_te_P = [i for i in all_idx if is_hold[i] and src[i] == 1]
clf_u = probe(U_tr, U_te_A + U_te_P, union_names, "E3_dinov2_probe_union_heldout_all")
Lu = {n: k for k, n in enumerate(union_names)}
for tag, te in (("E3_union_heldout_A_only", U_te_A), ("E3_union_heldout_P_only", U_te_P)):
    RESULTS[tag] = scores([Lu[labels[i]] for i in te], clf_u.predict(E[te]), union_names); save()
json.dump({"labels": union_names}, open(f"{OUT}/label_map_union.json", "w"), indent=2)

# ---------- E1 / E4: MobileNetV4 fine-tunes (no inverse-frequency weights) ----------
def finetune(train_idx, names, epochs=8, balanced=False):
    L = {n: k for k, n in enumerate(names)}; y = [L[labels[i]] for i in train_idx]
    m = timm.create_model("mobilenetv4_conv_small.e2400_r224_in1k", pretrained=True, num_classes=len(names)).to(DEV)
    if balanced:
        c = Counter(y); w = [1.0 / np.sqrt(c[t]) for t in y]  # sqrt-balanced sampling, mild
        dl = DataLoader(DS(train_idx, y, tf_train), batch_size=64, sampler=WeightedRandomSampler(w, len(w)), num_workers=4, drop_last=True)
    else:
        dl = DataLoader(DS(train_idx, y, tf_train), batch_size=64, shuffle=True, num_workers=4, drop_last=True)
    opt = torch.optim.AdamW(m.parameters(), lr=1e-3, weight_decay=0.05)
    sch = torch.optim.lr_scheduler.OneCycleLR(opt, 1e-3, total_steps=epochs * len(dl)); sc = torch.amp.GradScaler("cuda", enabled=DEV == "cuda")
    for ep in range(epochs):
        m.train()
        for x, t in dl:
            x, t = x.to(DEV), t.to(DEV)
            with torch.autocast("cuda", enabled=DEV == "cuda"): loss = F.cross_entropy(m(x), t, label_smoothing=0.05)
            opt.zero_grad(set_to_none=True); sc.scale(loss).backward(); sc.step(opt); sc.update(); sch.step()
        log("epoch", ep + 1, "loss", round(loss.item(), 3))
    return m.eval()
@torch.no_grad()
def predict(m, idx, restrict=None):
    out = []
    for x, _ in DataLoader(DS(idx, [0] * len(idx), tf_eval), batch_size=128, num_workers=4):
        with torch.autocast("cuda", enabled=DEV == "cuda"): lg = m(x.to(DEV)).float().cpu()
        out.append(lg[:, restrict] if restrict is not None else lg)
    return torch.cat(out).argmax(1).numpy()

names_A = sorted(set(labels[i] for i in range(nA) if ok[i]))
m1 = finetune([i for i in range(nA) if ok[i]], names_A, epochs=8)
sh_ids = [names_A.index(n) for n in shared]
RESULTS["E1_mnv4_noweights_A_to_P"] = scores([shared.index(labels[i]) for i in P_sh], predict(m1, P_sh, sh_ids), shared); save()
log("E1", RESULTS["E1_mnv4_noweights_A_to_P"]["macro_f1"])
del m1; torch.cuda.empty_cache()

m4 = finetune(U_tr, union_names, epochs=10, balanced=True)
for tag, te in (("E4_mnv4_union_heldout_all", U_te_A + U_te_P), ("E4_mnv4_union_heldout_A_only", U_te_A), ("E4_mnv4_union_heldout_P_only", U_te_P)):
    RESULTS[tag] = scores([Lu[labels[i]] for i in te], predict(m4, te), union_names); save()
log("E4", RESULTS["E4_mnv4_union_heldout_all"]["macro_f1"])

# ---------- export deployment candidates ----------
m4.cpu().eval()
class Soft(nn.Module):
    def __init__(s, m): super().__init__(); s.m = m
    def forward(s, x): return F.softmax(s.m(x), 1)
torch.onnx.export(Soft(m4), torch.randn(1, 3, 224, 224), f"{OUT}/mnv4_union.onnx", input_names=["image"], output_names=["probs"],
                  opset_version=17, dynamic_axes={"image": {0: "b"}, "probs": {0: "b"}})
class DinoProbe(nn.Module):
    def __init__(s, d, W, b): super().__init__(); s.d = d; s.lin = nn.Linear(W.shape[1], W.shape[0]); s.lin.weight.data = torch.tensor(W, dtype=torch.float32); s.lin.bias.data = torch.tensor(b, dtype=torch.float32)
    def forward(s, x): return F.softmax(s.lin(F.normalize(s.d(x), dim=1)), 1)
dp = DinoProbe(dino.cpu().float().eval(), clf_u.coef_, clf_u.intercept_).eval()
torch.onnx.export(dp, torch.randn(1, 3, 224, 224), f"{OUT}/dinov2_probe_union.onnx", input_names=["image"], output_names=["probs"],
                  opset_version=17, dynamic_axes={"image": {0: "b"}, "probs": {0: "b"}})
try:
    from onnxruntime.quantization import quantize_dynamic, QuantType
    for f in ("mnv4_union", "dinov2_probe_union"): quantize_dynamic(f"{OUT}/{f}.onnx", f"{OUT}/{f}_int8.onnx", weight_type=QuantType.QInt8)
except Exception as e: log("quantize failed", e)
RESULTS["files_mb"] = {f: round(os.path.getsize(f"{OUT}/{f}") / 1e6, 2) for f in os.listdir(OUT) if f.endswith(".onnx")}
save(); log("DONE", json.dumps({k: (v.get("macro_f1") if isinstance(v, dict) and "macro_f1" in v else v) for k, v in RESULTS.items()}, indent=1))
