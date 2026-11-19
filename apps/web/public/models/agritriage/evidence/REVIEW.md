# Code-review notes

What was checked, the design decisions a reviewer will ask about, and known limits.

## Verified in this build (synthetic data, CPU)

* `pytest`: 14 tests pass - conformal LAC/APS/RAPS reach nominal 90% coverage over 20 repeats,
  per-crop (Mondrian) coverage holds per group, small calibration sets fall back to full sets,
  triage policy, metrics, temperature scaling lowers NLL, Holm and paired bootstrap, finite losses
  and gradients, Jensen-Shannon disagreement, pHash near-duplicate search, group splits never
  straddle splits, cross-dataset duplicates are excluded from training, label normalisation.
* Full runs of P1 (all 10 models: MobileNetV3-S/L, EfficientNet-B0, MobileViT-S, GhostNetV2,
  ShuffleNetV2, KD baselines), P2, P3, P4, P4b, P6 (unknown classes + other crop), P7 (sweep),
  ablations A1, A3, A4, A5, A9 (teacher re-cache per policy), A11, A12 (init from P3), A13, severity,
  weather (offline mock), advisory, and every report.
* With the real pretrained DINOv2-B + CLIP-B/16 teacher and ImageNet student
  (`configs/smoke_pretrained.yaml`), teacher OOF accuracy and student val accuracy rise as expected,
  so distillation learns. The default timm names, including `vit_base_patch16_dinov3.lvd1689m`, load.
* ONNX export (TorchScript path and dynamo fallback) matches PyTorch to < 1e-6; INT8 static
  quantisation runs and its test accuracy is recorded.
* Training images reach 100% train accuracy, confirming labels, views and indices line up.

Not verified here: CUDA/bf16 numerics (no GPU in the build sandbox; `doctor` checks this on the
5090), real dataset layouts (use `inspect`), wall-clock times.

## Design decisions to defend

1. **Deterministic views.** The teacher runs once per (image, view); the student must see the
   same pixels, so each view is a pure function of (SHA-1, view id, policy, seed).
2. **Out-of-fold teacher targets.** Teacher heads predict training images they were not trained
   on (group K-fold); in-sample soft labels would be near one-hot and carry no uncertainty.
3. **Disagreement weighting.** D(x) = mean pairwise Jensen-Shannon divergence between the
   per-backbone heads; w(x) = exp(-kappa D(x)) down-weights imitation where the teacher is unsure.
   Whether this helps is a hypothesis tested by A3 - report it either way. First 3-seed P1 result:
   it does not (proposed 58.2 vs logit-only KD 58.7 vs logit+feature KD 59.1 macro-F1; paired
   bootstrap n.s. after Holm). Distillation itself gives +4.2 pts over CE (p < 0.01).
4. **Student head (changed after the first real runs).** The default is now a softmax head with
   T^2-scaled logit KD. On PlantWild val (seed 0, 60 epochs) softmax+KD reached macro-F1 0.584 vs 0.524
   for the evidential head (CE baseline 0.533): the evidential expected probabilities alpha/S are very
   flat with 89 classes, which slowed learning and inflated conformal sets (mean APS set 40 classes).
   The evidential head remains available (`student.head=evidential`) and is ablation A4. The number of
   cached views was raised from 5 to 20 on the same val evidence (0.598 vs 0.584). Test sets were not
   looked at for either choice.
5. **Calibration order.** Temperature scaling, conformal thresholds and the unknown threshold all
   use the `cal` split only; `val` only selects checkpoints; `test` is never used for choices.
6. **Shift.** Conformal guarantees need exchangeability. Shift sets report source-calibrated
   coverage (what happens if you deploy as is) and target-calibrated coverage (100 random 20/80
   splits of the target set). The gap is a result. Measured (3 seeds): web→web PlantDoc 90.6 %
   source-calibrated (holds); RiceLeafBD 80.4 % → 90.4 % with sets of 2.7; lab→field (PlantVillage-trained,
   99.8 % in-domain accuracy) 17.4 % accuracy on PlantDoc, coverage 23.2 % → 90.4 % only with sets of
   ~23 of 28 classes, and the gate refers 92 % of those photos. Local recalibration fixes coverage,
   not usefulness, under a large shift.
7. **Leakage.** Duplicate clusters (SHA-1 + pHash) define split groups; any training/val image
   that duplicates a test/cal image in any dataset is excluded; external test sets also drop images
   that duplicate the experiment's training rows; an optional embedding pass catches crops/resizes.
8. **Fair baselines.** Same data, views, schedule, early stopping and calibration for every model.
9. **Deployment numbers.** Parameters and MACs exclude the training-only feature projection;
   latency is ONNX Runtime on CPU (1 and 4 threads); GPU numbers are throughput only.
   The deployed file stores INT8 weights (per output channel) and computes in FP32
   (`efficiency.int8_mode: weights`, 1.65 MB, test accuracy equal to FP32). Full static INT8
   (QDQ activations) of MobileNetV3 fell from 62.7 % to 36.7 % val accuracy; the best static setting
   (pointwise convs only, percentile calibration) kept 61.0 % at 2.2 MB. Chosen on val (10 Nov 2026).
   Latencies were measured while other training jobs shared the CPU; treat them as upper bounds.

## Known limits (say them in the paper)

* Weather fusion is a case study: images carry no per-photo timestamps or GPS, so a site-level
  prior is applied. The rules in `weather_rules.yaml` are unverified starting values.
* Severity = lesion share of the image (PlantSeg has no leaf masks), not of the leaf.
* The advisory corpus must be built from registered guidance; generation is template-based and
  quotes retrieved passages. Faithfulness needs the two-judge sheet.
* Few-shot (1 shot) teacher targets are in-sample (no folds possible); flagged in the log.
* MC-dropout uses the single dropout layer before the classifier, so its variance is modest.
* P5 needs site metadata that the public datasets may not provide.
* Yield gain and input savings are not measurable offline; present a field-pilot plan instead.

## Claims to avoid

Raising yield or cutting inputs; PlantVillage accuracy as field performance; weather fusion
improving diagnosis (unless dated, geotagged photos show it); "guaranteed" coverage under shift.
Disagreement weighting improving accuracy (A3 says no); "INT8 model" without saying weight-only.
"Local calibration solves lab→field shift" (it restores coverage with ~23-disease lists); the
evidential head as the default (A4: 54.1 vs 58.2 macro-F1). "MobileNetV3-S is the best small
student": plain ShuffleNetV2 (59.9) beats our MobileNetV3-S student (58.2); the same recipe on
ShuffleNetV2 gives 63.4 (+3.5, p < 0.01) and matches plain MobileNetV3-L (63.2, p = 0.75). Distillation
gains hold on three backbones (+4.2 / +3.5 / +5.1, all p < 0.01; reports p1_indomain,
p1_indomain__ref_shufflenet, p1_indomain__ref_large). Every shift / unknown / triage experiment
uses the MobileNetV3-S student, so it stays the reference model.

## Final teacher and foundation-distilled students (11-12 Nov 2026; p1f, p2uf, p2f, crop_known)

* Teacher = frozen DINOv2-L/14 @448 + CLIP-L/14 @336 + PE-Core-L/14 @336 (924 M params) with the same
  MLP fusion head: 82.38 ± 0.29 % accuracy on PlantWild test (3 seeds), above the best published
  80.23 % (El Karch et al., Front. Plant Sci. 2026) and the PlantWild paper's 76.18 %. Our test set is
  stricter (14 duplicated images dropped, training copies of 214 test images removed), so the comparison
  is not in our favour; the published numbers are on the original split.
* Deployed student = TinyViT-11M (`tiny_vit_11m_224.dist_in22k_ft_in1k`): 77.07 ± 0.71 %, 11.0 MB
  INT8 weights, 19 ms on one CPU thread (ONNX Runtime), about 130 ms in a browser with 4 threads.
* **Claim to avoid: "distillation makes TinyViT beat PlantWild".** Plain fine-tuned TinyViT already reaches
  76.19 ± 0.16 % (= the PlantWild paper). Distillation adds +0.87 pts (95 % CI 0.30-1.41, Holm p = 0.004);
  the backbone choice is most of the gain. The plain TinyViT also has tighter conformal sets (4.4 vs 7.9)
  and lower ECE after TS (1.5 vs 4.5 %). Say "the right pre-trained backbone + the teacher".
* Crop-known mode (scripts/crop_known.py; mask to the photo's crop, renormalise, refit APS on masked cal):
  TinyViT 77.1 → 88.2 % accuracy, answers alone 54 → 74 %, 94.0 % right when it does, refers 11 %,
  coverage 89.6 % (3 seeds). Needs the user to name the crop correctly.
* Combined system on PlantDoc (p2uf: new teacher + TinyViT + unlabelled PlantDoc train/val/cal photos):
  71.33 ± 1.36 % on the held-out PlantDoc test split (236 photos), teacher 74.15 ± 1.12 % (difference
  not significant, p = 0.44); source-calibrated coverage on all PlantDoc 92.1 %.
* Controls (p2f_web2web, same teacher and student, no unlabelled photos): KD-only TinyViT 72.46 ± 0.85 % on
  the PlantDoc test split, CE-only (no teacher) 70.34 ± 1.53 %. On all 2,261 PlantDoc photos (unseen by
  both) KD 70.84 vs CE 69.32 %: +1.52 pts, 95 % CI 0.69-2.30, Holm p < 0.001. **Claim to avoid:
  "unlabelled PlantDoc photos help TinyViT"** (72.5 -> 71.3 %, within noise). Unlabelled-field
  distillation helped the weak MobileNetV3-S (lab -> field +15.7 pts) but not a student already within
  ~2 pts of its teacher. The poster's "ours" on PlantDoc is the KD-only model.
* Shift, unknown-disease and rice-recalibration results still come from the MobileNetV3-S student of
  the earlier 172 M teacher; label them that way.
