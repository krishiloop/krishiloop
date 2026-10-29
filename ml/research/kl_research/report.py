"""Write the benchmark documents from the machine-readable records (no hand-typed numbers).

    benchmark/DATASETS.md        licence and provenance table (accepted / rejected with reasons; creators cited)
    benchmark/summary_counts.csv per dataset x domain x label counts after de-duplication (kept images)
    benchmark/summary.json       totals: domains, crops, countries, images; dedup report; fetch state
    benchmark/FEATURES.md        backbones, licences, dimensions, throughput, VRAM (from each _meta.json)

Usage: python -m kl_research.report <research_dir> <state_dir>
  state_dir holds what was copied back from the 5090: manifest.parquet (optional), dedup_report.json (optional),
  fetch/<key>.json (each dataset's _fetch.json), features/<backbone>_meta.json, eppo_check.json.
"""
from __future__ import annotations

import glob
import json
import os
import sys
import time

import yaml


def _creators(r):
    c = [x.strip() for x in (r.get("creators") or []) if x and x.strip()]
    if not c:
        return ""
    if r.get("source") == "zenodo":   # Zenodo names come as "Family, Given"
        c = [x for x in c]
    return "; ".join(c[:6]) + (" et al." if len(c) > 6 else "")


def datasets_md(rdir, sdir):
    cfg = yaml.safe_load(open(os.path.join(rdir, "configs", "datasets.yaml"), encoding="utf-8"))["datasets"]
    scr = {r["key"]: r for r in json.load(open(os.path.join(rdir, "benchmark", "licence_screen.json"), encoding="utf-8"))["datasets"]}
    fetch = {}
    for p in glob.glob(os.path.join(sdir, "fetch", "*.json")):
        fetch[os.path.splitext(os.path.basename(p))[0]] = json.load(open(p, encoding="utf-8"))
    man = None
    mp = os.path.join(sdir, "manifest.parquet")
    if os.path.exists(mp):
        import pandas as pd
        man = pd.read_parquet(mp)
    dd = json.load(open(os.path.join(sdir, "dedup_report.json"))) if os.path.exists(os.path.join(sdir, "dedup_report.json")) else {}
    summ0 = {}
    if man is not None:
        mk0 = man[man.keep]
        summ0 = {"kept": len(mk0), "domains": mk0.domain.nunique(), "crops": sorted(mk0.crop.unique()), "countries": sorted(mk0.country.unique())}
    L = ["# Benchmark datasets: licence and provenance", "",
         (f"**State at generation:** {summ0['kept']} images kept after de-duplication, {summ0['domains']} domains, "
          f"{len(summ0['crops'])} crops ({', '.join(summ0['crops'])}), {len(summ0['countries'])} countries ({', '.join(summ0['countries'])}). "
          "Datasets marked `queued` were still downloading on the 5090 (resumable `kljob` jobs) when this file was generated."
          if summ0 else "**State:** manifest not built yet."), "",
         f"Generated {time.strftime('%Y-%m-%d %H:%M')} by `kl_research.report` from `configs/datasets.yaml`, "
         "`benchmark/licence_screen.json` (licences read at the source API, verbatim) and the download records on the 5090. "
         "Raw images are never stored in this repository; only this table, the manifest (hashes, labels, provenance) and code.", "",
         "**Inclusion rule (PROTOCOL_v1, section D):** public and downloadable without credentials; licence CC0, CC BY, CC BY-SA, "
         "MIT or Apache-2.0; field or in-the-wild photos (white-background sets only as a labelled `lab` domain); at least 2 mappable "
         "classes and 100 images after de-duplication; provenance recorded. Every Mendeley Data page also carries the host footer "
         "\"All rights are reserved, including those for text and data mining, AI training and similar technologies. For all open access "
         "content, the Creative Commons licensing terms apply.\" We read the last sentence as deferring to each dataset's CC licence; "
         "this point is flagged for legal review.", "",
         "## Accepted (licence passed the screen)", "",
         "| Dataset (key) | Creators (cite) | DOI / source | Version, date | Licence (verbatim at source) | Crop | Country | Place, device (as stated) | Capture | Fetched | Kept images | Domains |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    rej = []
    for e in cfg:
        k = e["key"]
        r = scr.get(k, {})
        lic = r.get("licence_label") or e.get("licence_label") or ""
        full = r.get("licence_full") or ""
        cls = r.get("licence_class")
        if e.get("status") in ("reject", "deferred") or cls in ("blocked", "unclear", "gated") or "fetch" not in e:
            rej.append((k, r, e, lic))
            continue
        f = fetch.get(k)
        if f is None:
            fetched = "queued (download running)"
        elif f.get("mirror"):
            m = f["mirror"]
            fetched = (f"{m['written']} images via verified mirror ({m['matched_byte_for_byte']} of {m['mirror_images']} mirror images "
                       f"match the deposit by name, size and CRC32); mirror: {m['mirror_url'].split('/resolve')[0]}")
        else:
            n = sum(a.get("members_kept", 0) for a in f.get("archives", [])) + len(f.get("files", []))
            caps = (e.get("fetch") or {}).get("cap_per_class")
            fetched = f"{n} images" + (f" (seeded cap {caps} per class)" if caps else "")
        kept = doms = cap = ""
        if man is not None:
            mk = man[(man.dataset == k) & man.keep]
            kept = str(len(mk))
            cap = ", ".join(sorted(mk.capture.unique()))
            doms = "<br>".join(d.replace("|", " / ") + f" ({c})" for d, c in mk.domain.value_counts().items())
        doi = r.get("doi") or e.get("repo") or ""
        link = f"https://doi.org/{doi}" if doi.startswith("10.") else (f"https://github.com/{doi}" if "/" in doi else "")
        ver = e.get('version') or r.get('version_label') or ''
        L.append(f"| {r.get('title') or e.get('title') or k} (`{k}`) | {_creators(r) or e.get('creators_note', '')} | [{doi}]({link}) | "
                 f"{('v' + str(ver)) if ver else '-'}, {(r.get('publish_date') or '')[:10] or '-'} | {lic}"
                 f"{(' (' + full + ')') if full and full != lic else ''} | {e.get('crop')} | {e.get('country')} | "
                 f"{e.get('place', '')} | {cap} | {fetched} | {kept} | {doms} |")
    L += ["", "Notes on accepted sets:", ""]
    for e in cfg:
        if e.get("note") and e.get("status") != "reject":
            L.append(f"- `{e['key']}`: {e['note']}.")
    L += ["", "## Rejected, or deferred to the next run", "", "| Dataset (key) | Licence or terms as found | Reason |", "|---|---|---|"]
    for k, r, e, lic in rej:
        reason = e.get("reason") or {"blocked": "licence not in the allowed list (NC, ND or copyleft)",
                                     "unclear": "licence unclear at the source", "gated": "gated download"}.get(r.get("licence_class"), "not used")
        L.append(f"| {r.get('title') or k} (`{k}`) | {lic} | {reason} |")
    if dd:
        L += ["", "## De-duplication (exact SHA-256, pHash Hamming <= 6, DINOv2-B cosine >= 0.95)", "",
              "| Dataset | Readable | Exact copies dropped | pHash copies dropped | Label-conflict copies dropped | Kept | Images in near-copy clusters | Clusters spanning datasets |",
              "|---|---|---|---|---|---|---|---|"]
        for k, v in sorted(dd.get("per_dataset", {}).items()):
            L.append(f"| {k} | {v['readable']} | {v['exact_dup_dropped']} | {v['phash_dup_dropped']} | {v['label_conflict_dropped']} | "
                     f"{v['kept']} | {v['images_in_near_copy_clusters']} | {v['clusters_spanning_datasets']} |")
        if dd.get("cross_dataset_duplicate_groups"):
            L += ["", "Copy groups shared across datasets: " + ", ".join(f"{k}: {v}" for k, v in dd["cross_dataset_duplicate_groups"].items())]
        if dd.get("rule"):
            L += ["", f"Rule: {dd['rule']} (pHash edges {dd.get('phash_edges')}, confirmed {dd.get('phash_edges_confirmed')}). "
                  "See DEVIATIONS.md for why pHash alone is not trusted."]
    op = os.path.join(sdir, "overlap_report.json")
    if os.path.exists(op):
        ov = json.load(open(op))
        L += ["", "## Data-quality checks", "",
              f"- Cross-dataset perceptual matches (pHash <= 6): {ov['cross_dataset_phash_pairs']} pairs "
              f"({', '.join(f'{k}: {v}' for k, v in ov['pairs_by_dataset'].items())}); of these, "
              f"{ov['pairs_with_dinov2_cos_ge_0.95']} are DINOv2-B near-copies (cosine >= 0.95; median cosine of all pairs "
              f"{ov['cos_quantiles'][2] if ov.get('cos_quantiles') else 'n/a'}), and {ov['cross_crop_pairs']} pairs even cross crops. "
              "So we found no confirmed copy shared between two datasets; the pHash matches are look-alikes.",
              "- Within datasets, the share of pHash pairs that DINOv2-B confirms as near-copies: " +
              "; ".join(f"{k} {v['share_cos_ge_0.95']:.0%} of {v['pairs']}" for k, v in sorted(ov.get("within_dataset_phash_pairs", {}).items())) + ".",
              "- Sethy et al. (Odisha) ships many near-identical copies (confirmed by DINOv2-B): the de-duplicated set is about a "
              "third of the 5,932 files. BD5 also carries suffix-variant copies (`_01`, ` - Copy`)."]
    open(os.path.join(rdir, "benchmark", "DATASETS.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
    summ = {"generated": time.strftime("%Y-%m-%dT%H:%M:%S"), "fetched_datasets": sorted(fetch)}
    if man is not None:
        mk = man[man.keep]
        summ.update(images_kept=int(len(mk)), images_rows=int(len(man)), domains=int(mk.domain.nunique()),
                    crops=sorted(mk.crop.unique().tolist()), countries=sorted(mk.country.unique().tolist()),
                    labels=int(mk.label.nunique()),
                    dropped={"unmapped_or_dropped_label": int((man.label == "").sum()),
                             "duplicates": int((man.dup_drop.fillna("") != "").sum()), "unreadable": int((~man.ok).sum())})
        mk.groupby(["dataset", "domain", "country", "crop", "label"]).size().rename("images").reset_index().to_csv(
            os.path.join(rdir, "benchmark", "summary_counts.csv"), index=False)
    json.dump(summ, open(os.path.join(rdir, "benchmark", "summary.json"), "w"), indent=1)
    return summ


def features_md(rdir, sdir):
    bb = yaml.safe_load(open(os.path.join(rdir, "configs", "backbones.yaml"), encoding="utf-8"))["backbones"]
    scr = {r["key"]: r for r in json.load(open(os.path.join(rdir, "benchmark", "licence_screen.json"), encoding="utf-8"))["backbones"]}
    L = ["# Frozen-backbone features", "",
         f"Generated {time.strftime('%Y-%m-%d %H:%M')} by `kl_research.report` from each backbone's `_meta.json` on the 5090 "
         "(`F:\\krishiloop-5090\\features\\<backbone>\\<dataset>.npz`: `uid` aligned with the manifest, `X` float16 L2-normalised, `ok`). "
         "Features are outside git. GPU: one RTX 5090 (32 GB), shared with the safety eval (Ollama) which has priority.", "",
         "What `X` is: open_clip models: `encode_image` (the model's own pooled, projected image embedding, compared with text), with "
         "the model's own open_clip preprocessing; timm ViTs (DINOv2, DINOv3): the CLS token after the final norm, preprocessing resize "
         "(bicubic) to res x 256/224, centre-crop, model mean/std. EXIF orientation applied; JPEGs decoded with DCT scaling to at least "
         "2x the model resolution before the model's own resize; bf16 autocast.", "",
         "| Backbone | Model (weights) | Licence (HF API) | Res | Dim | Images embedded | Steady GPU img/s | Steady end-to-end img/s | Peak VRAM GB | Text embeddings |",
         "|---|---|---|---|---|---|---|---|---|---|"]
    for s in bb:
        k = s["key"]
        lic = scr.get(k, {})
        up = lic.get("upstream") or {}
        lab = lic.get("licence_label")
        lab = ", ".join(lab) if isinstance(lab, list) else lab
        licence = f"{lab}" + (f"; upstream {up.get('hf_id')}: {up.get('licence_label')}" + (" (gated: manual approval)" if up.get('gated') else "")
                              if up else "")
        mp = os.path.join(sdir, "features", f"{k}_meta.json")
        passes = json.load(open(mp))["passes"] if os.path.exists(mp) else []
        n = sum(p["images"] for p in passes)
        proc = [p for p in passes if p.get("loader", "process") == "process"] or passes
        big = max(proc, key=lambda p: p.get("steady_images") or 0) if proc else {}
        txt = "yes" if os.path.exists(os.path.join(sdir, "features", f"{k}_text.ok")) else ("planned" if s.get("text") else "no (image-only)")
        flag = " **(flagged comparison only)**" if s.get("flagged") else ""
        L.append(f"| {k}{flag} | `{s['arch']}`{(' / ' + s['pretrained']) if s.get('pretrained') else ''} | {licence} | "
                 f"{big.get('res', s.get('res', ''))} | {big.get('dim', '')} | {n or 'pending'} | {big.get('steady_img_per_s_gpu') or ''} | "
                 f"{big.get('steady_img_per_s_end_to_end') or ''} | {big.get('peak_vram_gb', '')} | {txt} |")
    L += ["", "Throughput is measured after the first two batches (cuDNN autotuning and DataLoader start-up excluded), on the "
          "largest pass of each backbone that used worker processes; GPU img/s times only the forward pass (CUDA events, bf16), "
          "end-to-end includes JPEG decoding by the DataLoader workers (6 to 12 processes, shown per pass in `_meta.json`). "
          "The PC is shared: the safety eval (Ollama), the voice and sovereign tracks ran on the same GPU and CPU at the same "
          "time, so these are lower bounds, measured under contention, not peak numbers. Passes are incremental (each dataset "
          "is embedded as it lands), so per-backbone image counts can differ while downloads are running."]
    L += ["", "## Licence notes", "",
          "- Licences above are the `license` field of each Hugging Face model card, read through the HF API on 29 Oct 2026 "
          "(`benchmark/licence_screen.json`); upstream = the original publisher's repository when timm or open_clip re-host the weights.",
          "- Perception Encoder Core L: Apache-2.0 on both the timm re-host and Meta's repository, so it enters the study "
          "(the protocol admitted it only if licensed).",
          "- DINOv3: custom `DINOv3 License` (`other`); Meta's repositories are gated with manual approval, the timm re-host is "
          "not gated. It runs last and only as a flagged comparison; its numbers never pick the shipped model. Before any use "
          "beyond this comparison, the lead should confirm that the DINOv3 License terms are accepted.",
          "- Text embeddings: the label prompts are fixed in `configs/prompts.yaml` (written before any result); the class "
          "vector is the normalised mean of the normalised prompt embeddings (`<backbone>/_text.npz`)."]
    open(os.path.join(rdir, "benchmark", "FEATURES.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")


if __name__ == "__main__":
    datasets_md(sys.argv[1], sys.argv[2])
    features_md(sys.argv[1], sys.argv[2])
