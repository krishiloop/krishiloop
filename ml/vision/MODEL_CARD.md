# Model cards: KrishiLens v1 (rice, licence-clean) and v0

## KrishiLens v1 (Oct 28, 2026): NOT fit for decisions
**Status:** measurement run. The photo gate stays closed: photos go to the officer, and this model is **not** wired into the app.
- **Model:** `mobilenetv4_conv_small.e2400_r224_in1k` fine-tuned for 12 epochs; 5 classes (healthy, blast, brown_spot, tungro, sheath_blight).
- **Data:** four CC BY 4.0 Mendeley sets, each a separate domain (its own phones and places):
  - BD-A/B: Dhan-Shomadhan, field and white background;
  - BD-C: RiceyLeafDisease;
  - BD-D: RiceLeafDisease-BD5;
  - BD-E: RiceLeafDiseaseBD.
- **Dedupe:** 20,694 images remain after a rotation/flip-invariant pHash dedupe. It dropped 8 cross-dataset duplicate groups (50 images) and 80 groups with conflicting labels.
- **Code:** `kaggle/krishilens_v1_lodo.py` (Kaggle `krishilens-v1-lodo`). Results are in `artifacts/lodo.json`.

**Leave-one-dataset-out results** (macro-F1 over the classes present; temperature fitted on source validation only):

| Held-out dataset | Images | ERM | ISP aug. | Train-majority baseline | Balanced acc. (ERM) | ECE raw → calibrated (ERM) |
|---|---|---|---|---|---|---|
| BD-A Dhan-Shomadhan field | 263 | 0.119 | 0.145 | 0.112 | 0.160 (chance 0.25) | 0.56 → 0.63 |
| BD-C RiceyLeafDisease | 997 | 0.350 | 0.267 | 0.000 | 0.270 (chance 0.25) | 0.52 → 0.57 |
| BD-D BD5 (Savar) | 2,630 | 0.291 | 0.276 | 0.000 | 0.279 (chance 0.25) | 0.27 → 0.33 |
| BD-E RiceLeafDiseaseBD (Gazipur) | 16,225 | 0.307 | 0.287 | 0.055 | 0.337 (chance 0.20) | 0.35 → 0.42 |
| **Mean of 4 held-out datasets** | | **0.267** | **0.244** | | | |

**What it means:**
- **On a photo from a dataset it never saw, the model is close to guessing.** Balanced accuracy is near chance on 3 of 4 held-out sets. On BD-A its accuracy (0.16) is below always answering the training majority class (0.29).
- **The model reads the dataset, not the disease.** Colour and image-size statistics alone identify which dataset a photo came from with 99.4% accuracy (chance 78%; diagnostic H2).
- **Confidence does not separate right from wrong.** Accuracy on the 80% most confident photos equals overall accuracy, and AURC is 0.65–0.82.
- **Source-fitted calibration does not transfer.** The temperature (0.76–0.83) sharpened the probabilities, and ECE got worse on every held-out set. A "top-1 ≥ 0.85" gate alone would pass confident wrong answers, so the API also requires `calibrated` and an OOD check.
- **Simulated phone cameras (ISP augmentation, G1/I1) did not help:** −0.023 mean macro-F1 vs ERM; better only on BD-A. This is a negative result, reported as such.
- **This matches, and is harsher than, the literature.** Paul 2026 reports 0.436 cross-dataset with only 2–3 shared classes; we test 4–5. PlantVillage → PlantDoc sits at 0.29–0.40.

**Errors in this run (fixed in v2, `kaggle/krishilens_v2_probe.py`):**
- The script's `summary` line (mean 0.41) averaged in BD-B (0.99), but BD-B was **in training** for that fold. That number is invalid; use the table above.
- The leave-one-phone-out split inside BD-E never ran: the metadata sheet has no device column, and the images carry no EXIF camera model. v2 tries the original file names (Pixel cameras write `PXL_…`).
- Label definitions may differ between datasets. The team relabel of about 100 cross-domain errors (H3) has not been done.

**Export:** `artifacts/krishilens_v1_rice.onnx` (9.97 MB, single file) with calibrated probabilities, plus `preprocess.json`.
- In the kernel it matched PyTorch on 64 images: largest difference 2e-6, top-1 agreement 100%.
- A local onnxruntime smoke test passes.
- It is kept for the record and for parity tests only.

## KrishiLens v2 probe (Oct 28, 2026): what fixes it?
**Setup:**
- **Code:** `kaggle/krishilens_v2_probe.py` (Kaggle `krishilens-v2-probe`); results in `artifacts/probe.json`.
- **Splits and dedupe:** the same 20,694 images, splits and dedupe as v1.
- **Backbones:** frozen, run at 224 px: DINOv2-B/L, DINOv3-B, BioCLIP 2, SigLIP 2-B.
- **Tuning rule:** probe weight decay and temperature are chosen on source validation only; nothing is tuned on a held-out set.
- **Features:** saved as `emb_*.npz` (git-ignored) for local re-analysis (`--analyse`).

**Mean macro-F1 over the same 4 held-out datasets** (BD-A / BD-C / BD-D / BD-E):

| Method | Uses photos from the new dataset? | Mean | Per held-out set |
|---|---|---|---|
| v1 fine-tuned MobileNetV4 (reference) | no | 0.267 | 0.12 / 0.35 / 0.29 / 0.31 |
| Frozen DINOv2-B + grey-world + linear probe (best probe) | no | 0.356 | 0.15 / 0.41 / 0.56 / 0.30 |
| Frozen BioCLIP 2 + probe | no | 0.345 | 0.18 / 0.33 / 0.55 / 0.32 |
| **Zero-shot SigLIP 2 (text prompts only, no training at all)** | no | **0.414** | 0.26 / 0.52 / 0.56 / 0.31 |
| DINOv2-B grey probe + **1** confirmed photo per disease | yes | 0.438 | 0.25 / 0.49 / 0.65 / 0.36 |
| … + **5** per disease | yes | 0.557 | 0.45 / 0.59 / 0.73 / 0.45 |
| … + **10** per disease | yes | 0.613 | 0.49 / 0.68 / 0.79 / 0.49 |
| … + **25** per disease | yes | **0.701** | 0.63 / 0.77 / 0.84 / 0.57 |

In the few-shot rows, the shots are whole duplicate groups held apart from the test set, averaged over 3 random draws (std ≤ 0.05). The shots carry 25% of the training weight, fixed in advance.

**Findings:**
1. **Frozen foundation features help only a little** (+0.03 to +0.09 over v1), and the worst held-out set stays at 0.15–0.23. Bigger is not better: DINOv2-L scores 0.301 vs 0.342 for DINOv2-B. Grey-world colour correction is inconsistent (+0.014 for DINOv2-B, −0.027 for BioCLIP 2).
2. **Zero-shot text prompts beat every model trained on the other Bangladeshi datasets** (SigLIP 2: 0.414). Training on other datasets teaches their shortcuts. The prompts were written once, before the run, and never tuned.
3. **The dataset fingerprint lives inside foundation features too.** A linear probe on any of them identifies the source dataset at 99.6–99.98% (chance 79%). This matches "Invisible Shortcuts" (ECCV 2026).
4. **A confidence threshold alone is unsafe.** Without target photos, "top-1 ≥ 0.85" passes 32–63% of photos, with only 15–63% of those correct. kNN similarity to the training photos does not fix this (AUROC 0.43–0.77). This is why the API also demands `calibrated` and keeps the gate closed.
5. **A few confirmed photos from the new dataset are the strongest lever:**
   - 25 per disease lift the mean from 0.36 to **0.70**;
   - at that point the 0.85 gate passes 42–71% of photos, with **72–92%** of them correct (BD-E 0.72, BD-A 0.78, BD-C 0.88, BD-D 0.92);
   - this is still below a spray-decision bar on 2 of 4 sets.

   Nearest-class-mean on the shots alone gives a similar 0.68–0.72.
6. **The few-shot gains are not near-copy leakage** (`analysis/nearcopy_check.py`). Dropping test photos whose DINOv2 cosine similarity to any shot is ≥ 0.95 changes scores by ≤ 0.02. BD-C, where 13% of test photos are near-copies at k=25, loses 0.014–0.022. Even dropping up to half the test set (cosine ≥ 0.90) costs ≤ 0.09.
7. **Exploratory, post-hoc:** a Tip-Adapter run (zero-shot prior + shots, paper defaults, `analysis/tip_adapter.py`) reaches 0.62–0.64 at k=25. It answers far less often (gate pass 5–57%), but with 71–96% precision when it does. This is a candidate for "abstain unless sure"; it needs a pre-registered re-test.
8. **No phone split is possible in BD-E.** The metadata covers 60% of images and shows at least 4 filename conventions (the dataset text says 2 phones), and there is no EXIF. Only 85 `PXL_` (Pixel) files exist. Device evidence must come from G2, our own multi-phone set.

**Caveats:**
- one training seed;
- 3 shot draws;
- no bootstrap confidence intervals yet;
- BD-A is small (263 images);
- label definitions across datasets are unaudited (H3).

**Product consequence: trust is earned per domain.**
- A new region or phone cohort starts with the photo gate closed; photos go to the officer.
- Each officer-confirmed photo becomes a labelled shot for that domain. This is a probe or prototype update on frozen features, with no retraining.
- The gate for that domain opens only when its own held-out confirmed photos show the target precision.
- The receipt states the evidence, e.g. "N confirmed photos from your area, measured precision X".
- If a domain's measured precision drops, that model version is recalled for that domain through the same status-list mechanism.

**Deployment gap:** DINOv2-B (86 M parameters) is too big for a phone browser. Next to test: small frozen backbones (DINOv2-S, MobileNetV4) and teacher→student distillation, or server-side features in sovereign mode (the photo would then leave the phone, so the privacy text must change).

---

## v0: rice leaf triage (MobileNetV4-small, "union", Oct 26–27)

**Status:** v0 baseline, used to measure the problem. Cross-domain and cross-device generalisation is the research problem we are solving; see `D:\AI_congress\plan\VISION_RESEARCH_PLAN.md` for the method.
- In the product, a diagnosis at or above the calibrated threshold becomes a fact for the planner (photo → receipted decision).
- Below the threshold, the case goes to the officer.
- The receipt shows the model version and the datasets it was tested on, with scores.

## What it is
- `timm` `mobilenetv4_conv_small.e2400_r224_in1k`, fine-tuned for 10 epochs on the union of two public datasets (sqrt-balanced sampling, label smoothing 0.05, seed 42).
- 21 classes (`artifacts/label_map_union.json`).
- **Input:** `image` float32 [1, 3, 224, 224]. Preprocessing: resize the short side to 256, centre-crop 224, scale to 0–1, then normalise with the ImageNet mean/std.
- **Output:** `probs` [1, 21] (softmax inside the graph).
- **Shipped file:** `artifacts/mnv4_union_fp16w.onnx` (5.3 MB). Weights are stored as fp16 and computed in fp32. Top-1 agreement with fp32 was 100% on a 120-image sample; the largest probability difference was 0.002.
- **Training code:** `kaggle/rice_experiments.py` (Kaggle GPU kernel `krishiloop-rice-experiments`, private for now; it goes **public before submission**). Packing and quantization: `pack_onnx.py`; its report is in `artifacts/onnx_pack_report.json`.

## Data
| Code | Dataset | Licence | Images used |
|---|---|---|---|
| A | `alamshihab075/rice-leaf-disease-an-images-dataset` (field + controlled capture, multi-source) | MIT | 29,363 |
| P | `imbikramsaha/paddy-doctor` (Paddy Doctor benchmark, Kaggle mirror) | CC0 | 10,407 |

- **Deduplication:** a perceptual hash (8×8 pHash) over 8 bands; images at Hamming distance ≤ 6 go into one group.
  - 399 Paddy Doctor images that duplicated dataset A were removed from the cross-dataset tests.
  - Splits are by group, so near-duplicates never straddle train and test.
- **Caveat:** rotated or flipped augmented copies can evade pHash, so held-out scores on dataset A may still be optimistic.

## Results (macro-F1; source: `artifacts/experiments.json`)
| Experiment | Train → test | MobileNetV4 | DINOv2 ViT-S probe (frozen) |
|---|---|---|---|
| **Cross-dataset**, 7 shared labels | A → P | **0.18** | **0.20** |
| **Cross-dataset**, 7 shared labels | P → A | — | **0.19** |
| Union, held-out groups, all | A+P → A+P | 0.95 | 0.81 |
| Union, held-out groups, Paddy Doctor part only | A+P → P | 0.90 | 0.66 |

**What this tells us (corrected Oct 27 after the independent ML review, `plan/reviews/review_ml_2026-10-27.md`):**
- **The cross-dataset test was not independent.** Dataset A is an unsourced compilation that contains Paddy Doctor images: 218 of P's 380 bacterial-leaf-streak photos are near-duplicates of A, and 11 duplicate groups join images with *different* labels. So A→P is confounded, and 0.19 must not be quoted as a clean cross-domain number.
- **I wrongly wrote "class weighting is not the cause".** Removing the class weights tripled macro-F1 (v2 ≈ 0.06 → E1 0.185), and E1 changed other settings at the same time. The cause is not established. The v2 baseline (0.06) belongs in the table.
- **MobileNetV4 P→A was never run.** Only the DINOv2 probe was tested in both directions.
- **Held-out 0.95 / 0.90 are likely optimistic.** Rotated or flipped augmented copies evade pHash, so near-duplicates can sit on both sides of the split.
- **Macro-F1 for the "A only" / "P only" rows** is averaged over a prediction-dependent label set, so those rows are not comparable with each other (E3 "A only" is ≈ 0.85 over the classes actually present).
- **Licences:** the Kaggle labels (MIT for A, CC0 for the P mirror) do not establish rights. The Paddy Doctor competition rules forbid redistribution. **This v0 model must not be shipped commercially.** v1 trains on clean CC BY field sets (`research/rice_datasets_dg_2026.md`, `plant_datasets_*_2026.md`).
- What still stands: models trained on one capture protocol fail on another. That is the research problem (`plan/VISION_RESEARCH_PLAN.md`), to be measured again on independent, licence-clean domains.

## Product gate (corrected Oct 27)
- A raw softmax ≥ 0.6 is **not** a safe gate. The model is uncalibrated, has no OOD check, and its cross-dataset accuracy (0.21) is below always answering "healthy" (0.23).
- A diagnosis may feed the planner only after:
  - calibration on held-out *domains*;
  - an OOD check;
  - a singleton prediction set.
- Until then, photo results are shown, but the decision comes from the rules plus weather. Unsure photos go to the officer.
- This is a gating rule, not a scope cut: v1's job is to pass this gate.
- Preprocessing differs between training (torchvision), `pack_onnx.py` (PIL) and the browser. Parity is still to fix.

## Quantization notes (honest)
- The dynamic and min-max int8 runs (agreement 0.42) were scratch experiments; their numbers are not in an artifact. The percentile run (0.867) is in `onnx_pack_report.json`. Agreement was measured on images that may overlap training.
- **Dynamic int8:** broke the model (fp32/int8 agreement 0.42).
- **Static QDQ per-channel:**
  - min-max or entropy calibration: 0.42;
  - percentile calibration: 0.87;
  - with the head kept in fp32: 0.95, but 7.0 MB.
- **We ship fp16-stored weights instead** (5.3 MB, agreement 1.00).
- Next: quantization-aware training if size becomes critical.

## Latency
- Laptop CPU (onnxruntime 1.23, batch 1): 3–8 ms per image depending on load.
- Phone-browser latency is **not yet measured**. The target is < 1.5 s on a mid-range Android.

## Not done yet (planned on the RTX 5090; MASTER_PLAN §6)
1. Temperature scaling + ECE + OOD AUROC on the held-out groups. The v2 baseline had these; this run did not.
2. **External test on Bangladeshi field images:** Dhan-Shomadhan (Mendeley, CC BY 4.0, 1,106 images, 5 diseases; licence to re-check). This is the number that matters for the BD demo.
3. Domain generalisation: full DINOv2 fine-tuning with heavy augmentation, distilled to MobileNetV4; compare on Dhan-Shomadhan.
4. Grad-CAM heat-map in the browser.
5. Make the Kaggle kernels public.
