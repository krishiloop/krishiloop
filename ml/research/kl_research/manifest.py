"""Benchmark manifest: one row per image.

Step 1, ``scan`` (per dataset, as soon as its download has a ``_DONE`` marker):
    sha256 of the file bytes, 64-bit pHash, width/height/format, EXIF Make/Model (device) and capture date
    (GPS is never read or stored), the original label and capture setting from the dataset's own folder layout.
    -> <bench>/scan/<key>.parquet
Step 2, ``build`` (after dedup.py has clustered the scan rows):
    canonical ``crop/condition`` label from configs/label_map.csv (unmappable labels are dropped and logged),
    licence and provenance from the licence screen, domain id, near-copy cluster id, keep flag.
    -> <bench>/manifest.parquet

Commands
    python -m kl_research.manifest scan  <datasets.yaml> <raw_root> <bench_dir> [keys...]
    python -m kl_research.manifest build <datasets.yaml> <bench_dir> <label_map.csv> <licence_screen.json>
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

IMG_EXT = (".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp")
FB_NAME = re.compile(r"^\d+_\d+_\d+_n(\s*\(\d+\))?\.(jpg|jpeg|png)$", re.I)


def log(*a):
    line = " ".join([time.strftime("%H:%M:%S")] + [str(x) for x in a])
    print(line, flush=True)
    if os.environ.get("KL_LOG"):   # jobs also append to a plain log file (stdout redirection can stay empty)
        with open(os.environ["KL_LOG"], "a", encoding="utf-8") as f:
            f.write(line + "\n")


# ------------------------------------------------------------------ dataset-specific layout rules
def parse_path(key: str, rel: str) -> dict | None:
    """Return {orig_label, capture, crop?} for one image path relative to raw/<key>, or None to skip it.
    capture: field | lab | mixed | web. Default original label = the image's parent folder name."""
    parts = [p.strip() for p in rel.replace("\\", "/").split("/") if p.strip()]
    low = rel.lower()
    if len(parts) < 2 or "__macosx" in low or os.path.basename(rel).startswith("._"):
        return None
    if "augment" in low:
        return None   # augmented copies never enter (folders are skipped at download as well)
    parent = parts[-2]
    out = {"orig_label": parent, "capture": "field"}
    if key == "bd_rice_dhanshomadhan":
        top = next((p for p in parts if "background" in p.lower()), "")
        out["capture"] = "field" if top.lower().startswith("field") else "lab"
    elif key == "bd_rice_riceleafbd_rimi":
        if FB_NAME.match(os.path.basename(rel)):
            return None   # Facebook-CDN names: provenance unclear, excluded
    elif key == "gh_ccmt":
        # .../<Crop>/<class>/<file>; the raw tree carries the crop in a folder name
        crop = next((c for c in ("cashew", "cassava", "maize", "tomato") for p in parts[:-1] if c in p.lower()), None)
        if crop is None:
            return None
        out["crop"] = crop
        out["capture"] = "mixed"   # CCMT method: backgrounds "white, dark, illuminated, and real"
    elif key == "lk_rice_paddypulse":
        out["capture"] = "lab"     # record: "captured under a controlled white background"
    elif key == "br_coffee_bracol":
        out["capture"] = "lab"     # abaxial side on white background, "partially controlled conditions"
    elif key == "bd_rice_riceyleafdisease":
        out["capture"] = "mixed"   # page: outdoor light "as well as inside lighting"
    elif key == "web_plantdoc":
        out["capture"] = "web"
        if parts[0].lower().startswith("plantdoc") and len(parts) >= 3:
            out["split"] = parts[-3]
    elif key == "ug_bean_ibean":
        out["split"] = parts[-3] if len(parts) >= 3 else ""
    return out


# ------------------------------------------------------------------ scan one file
def _exif_device(img) -> tuple[str, str]:
    try:
        ex = img.getexif()
    except Exception:  # noqa: BLE001
        return "", ""
    make = str(ex.get(271, "") or "").strip().strip("\x00")
    model = str(ex.get(272, "") or "").strip().strip("\x00")
    date = ""
    try:
        sub = ex.get_ifd(0x8769)
        date = str(sub.get(36867, "") or ex.get(306, "") or "")[:10].replace(":", "-")
    except Exception:  # noqa: BLE001
        date = str(ex.get(306, "") or "")[:10].replace(":", "-")
    dev = (make + " " + model).strip() if model and make.lower() not in model.lower() else (model or make)
    return dev, date


def scan_one(path: str) -> dict:
    import imagehash
    from PIL import Image
    r = {"bytes": 0, "sha256": "", "phash": "", "width": 0, "height": 0, "format": "", "device_exif": "", "date_exif": "",
         "ok": False, "error": ""}
    try:
        with open(path, "rb") as f:
            b = f.read()
        r["bytes"] = len(b)
        r["sha256"] = hashlib.sha256(b).hexdigest()
        img = Image.open(io.BytesIO(b))
        r["width"], r["height"], r["format"] = img.width, img.height, img.format or ""
        r["device_exif"], r["date_exif"] = _exif_device(img)
        if img.format == "JPEG":
            img.draft("RGB", (256, 256))   # DCT-domain downscale: pHash only needs 32x32
        img = img.convert("RGB")
        r["phash"] = str(imagehash.phash(img, hash_size=8))
        r["ok"] = True
    except Exception as e:  # noqa: BLE001
        r["error"] = repr(e)[:200]
    return r


def list_images(root: str) -> list[str]:
    out = []
    for sub in ("files", "x"):
        base = os.path.join(root, sub)
        for dp, _, fs in os.walk(base):
            for f in fs:
                if f.lower().endswith(IMG_EXT) and not f.endswith(".part"):
                    out.append(os.path.join(dp, f))
    return sorted(out)


def scan(cfg_path: str, raw_root: str, bench: str, keys: list[str], threads: int = 14) -> list[str]:
    import pandas as pd
    import yaml
    cfg = {e["key"]: e for e in yaml.safe_load(open(cfg_path, encoding="utf-8"))["datasets"]}
    os.makedirs(os.path.join(bench, "scan"), exist_ok=True)
    done = []
    for key in keys or sorted(cfg):
        root = os.path.join(raw_root, key)
        out = os.path.join(bench, "scan", key + ".parquet")
        if not os.path.exists(os.path.join(root, "_DONE")) or os.path.exists(out):
            continue
        t0 = time.time()
        paths = list_images(root)
        rows = []
        for p in paths:
            rel = os.path.relpath(p, root).replace("\\", "/")
            meta = parse_path(key, rel)
            if meta is None:
                continue
            rows.append({"uid": f"{key}/{rel}", "dataset": key, "path": p, "rel": rel, **meta})
        with ThreadPoolExecutor(threads) as ex:
            res = list(ex.map(scan_one, [r["path"] for r in rows]))
        for r, s in zip(rows, res):
            r.update(s)
        e = cfg[key]
        df = pd.DataFrame(rows)
        if df.empty:
            log(key, "no images found")
            continue
        if "crop" not in df.columns:
            df["crop"] = e.get("crop")
        df["crop"] = df["crop"].fillna(e.get("crop"))
        df["country"] = e.get("country")
        for c in ("split",):
            if c not in df.columns:
                df[c] = ""
        df.to_parquet(out, index=False)
        log(f"scanned {key}: {len(df)} images ({int((~df.ok).sum())} unreadable) in {time.time() - t0:.0f} s; "
            f"labels {df.orig_label.value_counts().to_dict()}")
        done.append(key)
    return done


# ------------------------------------------------------------------ build the manifest
def device_group(df):
    """Device per image: EXIF Make/Model when present; a device with < 100 images in its dataset is 'other'."""
    dev = df["device_exif"].fillna("").replace("", "unknown")
    counts = dev.groupby([df["dataset"], dev]).transform("size")
    return dev.where(counts >= 100, "other")


def build(cfg_path: str, bench: str, label_map_csv: str, screen_json: str):
    import pandas as pd
    import yaml
    cfg = {e["key"]: e for e in yaml.safe_load(open(cfg_path, encoding="utf-8"))["datasets"]}
    screen = {r["key"]: r for r in json.load(open(screen_json, encoding="utf-8"))["datasets"]}
    lm = pd.read_csv(label_map_csv, dtype=str).fillna("")
    lm_key = {(r.dataset, r.orig_label.strip().lower(), r.crop_scope or ""): r for r in lm.itertuples()}
    scans = [pd.read_parquet(os.path.join(bench, "scan", f)) for f in sorted(os.listdir(os.path.join(bench, "scan")))
             if f.endswith(".parquet")]
    df = pd.concat(scans, ignore_index=True)
    clusters = os.path.join(bench, "clusters.parquet")
    if os.path.exists(clusters):
        cl = pd.read_parquet(clusters)
        df = df.merge(cl, on="uid", how="left")
    labels, eppo_c, eppo_k, reason = [], [], [], []
    for r in df.itertuples():
        m = lm_key.get((r.dataset, str(r.orig_label).strip().lower(), r.crop if r.dataset == "gh_ccmt" else ""))
        if m is None or not m.canonical:
            labels.append(""); eppo_c.append(""); eppo_k.append("")
            reason.append("unmapped_label" if m is None else ("dropped_label: " + m.note))
        else:
            labels.append(m.canonical); eppo_c.append(m.eppo_crop); eppo_k.append(m.eppo_condition); reason.append("")
    df["label"], df["eppo_crop"], df["eppo_condition"], df["label_drop"] = labels, eppo_c, eppo_k, reason
    df["crop"] = df["label"].str.split("/").str[0].where(df["label"] != "", df["crop"])
    df["device"] = device_group(df)
    df["licence"] = df["dataset"].map(lambda k: screen.get(k, {}).get("licence_label") or "")
    df["doi"] = df["dataset"].map(lambda k: screen.get(k, {}).get("doi") or "")
    df["source_version"] = df["dataset"].map(lambda k: str(cfg[k].get("version") or screen.get(k, {}).get("version_label") or ""))
    multi = df["dataset"].map(lambda k: cfg[k].get("crop") == "multi")
    df["domain"] = (df["dataset"] + (":" + df["crop"]).where(multi, "") + "|" + df["capture"] + "|" + df["device"])
    # keep flag: readable, mapped, not an exact/perceptual duplicate copy (dedup.py decides 'dup_drop')
    if "dup_drop" not in df.columns:
        df["dup_drop"] = ""
    df["keep"] = df["ok"] & (df["label"] != "") & (df["dup_drop"].fillna("") == "")
    cols = ["uid", "path", "sha256", "phash", "dataset", "domain", "crop", "country", "capture", "device", "device_exif",
            "date_exif", "orig_label", "label", "eppo_crop", "eppo_condition", "licence", "doi", "source_version",
            "width", "height", "bytes", "format", "split", "exact_group", "phash_group", "copy_group", "cluster", "dup_drop",
            "label_drop", "keep", "ok", "error"]
    for c in cols:
        if c not in df.columns:
            df[c] = ""
    df = df[cols]
    df.to_parquet(os.path.join(bench, "manifest.parquet"), index=False)
    kept = df[df.keep]
    log(f"manifest: {len(df)} rows, kept {len(kept)}; domains {kept.domain.nunique()}, crops {kept.crop.nunique()}, "
        f"countries {kept.country.nunique()}")
    return df


def main(argv):
    if argv[0] == "scan":
        scan(argv[1], argv[2], argv[3], argv[4:])
    elif argv[0] == "build":
        build(argv[1], argv[2], argv[3], argv[4])
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
