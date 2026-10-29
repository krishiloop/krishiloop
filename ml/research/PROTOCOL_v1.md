# Study protocol v1 (pre-registered): Earned trust for plant-disease diagnosis in the wild

**Status:** pre-registered on 29 Oct 2026, **before any result on the new benchmark exists**. Any change after this commit is logged in `DEVIATIONS.md` with its date and reason. Negative results are reported.

**Aim:** a Q1-journal-quality study, e.g. for *Computers and Electronics in Agriculture* or *Plant Phenomics*. It builds on our earlier evidence in `ml/vision/MODEL_CARD.md`:
- leave-one-dataset-out (LODO) classification fails across Bangladeshi rice datasets (macro-F1 0.27);
- colour alone identifies the dataset;
- per-domain earned trust reached 99.6% automatic precision in one replay.

This protocol tests whether that holds at scale, against strong baselines, with uncertainty.

## Research questions
- **RQ1 (shift):** Under leave-one-domain-out, how much accuracy and calibration do frozen foundation backbones, fine-tuned models and zero-shot vision-language models lose on new field domains?
- **RQ2 (confidence is not enough):** Does a confidence threshold calibrated on the source domains keep the precision of automatic answers at or above the target on new domains? *Hypothesis: no, not reliably.*
- **RQ3 (earned trust):** Expert verdicts arrive one photo at a time. For each method we measure:
  - how many verdicts it takes before a per-domain gate can open;
  - what share is then automated;
  - with what precision;
  - with how many harmful (wrong) automatic answers.

  Earned trust is compared with:
  - (a) source-calibrated thresholding;
  - (b) online Mondrian conformal prediction per domain;
  - (c) out-of-distribution score abstention;
  - (d) a fine-tuned model with the same expert labels.
- **RQ4 (drift):** After an unannounced change of domain, how many harmful automatic answers does each method give before it stops automating?

## D. Benchmark
- **Sources:** the candidate lists in `D:\AI_congress\research\` (rice: `rice_datasets_dg_2026.md`; other crops: `plant_datasets_global_2026.md`, `plant_datasets_bd_2026.md`).
- **Inclusion:**
  - public and downloadable without credentials;
  - a licence that allows research use **and** redistribution of derived features (CC0, CC BY, CC BY-SA, MIT, Apache-2.0);
  - field or in-the-wild photos (a white-background set may enter only as an explicitly labelled "lab" domain);
  - at least 2 classes that map to the canonical ontology;
  - at least 100 images after de-duplication;
  - provenance recorded (DOI, version, date; device and place when stated).
- **Exclusion:**
  - NC/ND licences, unclear licences, competition-only terms (e.g. Paddy Doctor unless its terms are verified), and gated downloads;
  - augmented copies: detected and removed, and a dataset whose originals cannot be separated from its augmentations is excluded.
- **Domain:** dataset × capture setting (field / lab) × device, where recorded.
- **De-duplication**, within and across datasets:
  - exact match (SHA-256);
  - perceptual match (pHash, Hamming distance ≤ 6);
  - near-copy clusters (DINOv2-B cosine ≥ 0.95).

  A cluster never spans two splits.
- **Labels:** canonical `crop/condition` (healthy, or a disease or pest), mapped through a documented table using EPPO codes where available. Unmappable classes are dropped and logged.
- **Target:** at least 15 domains, at least 5 crops, at least 6 countries, if the licence screen allows. Rice gets the most domains (BD, IN, PH, TW).
- **Deliverables:** `benchmark/manifest.parquet` (one row per image: hash, dataset, domain, canonical label, licence, cluster id) and `benchmark/DATASETS.md` (a licence and provenance table that cites the creators).

## M. Models
**Frozen backbones,** only with a licence that permits our use, each recorded:
- BioCLIP 2 (current);
- SigLIP 2 (B/16, So400m);
- DINOv2 (B, L, G);
- EVA-02 L (MIT);
- Perception Encoder Core L, only if its licence permits.

DINOv3 enters only as a flagged comparison (licence under review). Its numbers are never used to pick the shipped model.

**Heads on frozen features:**
- **H1:** the text-anchored linear probe (protocol 2, λ = 0.3, unchanged);
- **H2:** a nearest-prototype classifier on the expert-confirmed photos;
- **H3:** logistic regression trained on the source domains.

**Fine-tuned:** LoRA (rank 16) on the best two backbones by source-validation macro-F1 (picked before any test result), per LODO fold, 3 seeds.

**Zero-shot vision-language models (baselines):** Qwen3-VL-8B (Apache-2.0) and Gemma 4, each with one fixed prompt listing the candidate labels. Free text is mapped to labels by exact match only.

## G. Gates (what decides to answer automatically)
- **G-conf:** a maximum-probability threshold after temperature scaling, set on source validation for 95% precision.
- **G-conformal:** online Mondrian split-conformal per domain, α = 0.05. It automates only when the prediction set is a single label; calibration uses expert-confirmed photos from that domain and needs at least 20 before it starts.
- **G-ood:** an energy-score or kNN-distance threshold set on the source domains.
- **G-earned (ours):** exactly `rules/policy/photo-trust.yaml` v1:
  - sure means at least 0.85;
  - a window of 50, with at least 30 sure answers;
  - it opens at a Wilson 95% lower bound of at least 0.85 and closes below 0.80;
  - it audits 10% of automatic answers.

Every comparison uses the same streams and the same expert-verdict budget.

## Protocol
- **The stream:** per domain, a random order (seeded). The expert (the dataset label stands in for an officer, and this is stated everywhere) confirms every photo until a gate opens.
- **After the gate opens:** confident suggestions are answered automatically and the rest go to the expert. Audited automatic answers count as verdicts.
- **Repeats:** at least 200 stream orders per domain, and 3 seeds for fine-tuned models.
- **Drift:** two domains are concatenated (A, then B) with no notice. Pairs are pre-drawn: same crop, different country or device.

## Metrics
- **Primary:**
  - precision of automatic answers (per domain, and the macro average);
  - harmful automatic answers per 1,000 photos.
- **Secondary:**
  - expert verdicts until the first automatic answer;
  - automatic share;
  - AURC (area under the risk–coverage curve);
  - ECE;
  - after drift: photos until automation stops, and harmful answers in between.
- **Uncertainty:** 95% intervals by bootstrap over stream orders (and seeds). Every domain is reported, failures included.

## Analysis plan (fixed now)
- **The primary comparison:** G-earned vs G-conformal vs G-conf at matched verdict budgets. Policies are never tuned on test domains.
- **Secondary:**
  - backbone effects;
  - fine-tuned vs frozen;
  - vision-language model zero-shot.
- **Ablations, all reported, none used to pick the shipped policy:**
  - window size 25, 50 and 100;
  - opening bound 0.80, 0.85 and 0.90;
  - audit rate 5%, 10% and 20%;
  - Wilson vs Clopper-Pearson.

## Reproducibility, compute, ethics
- **Compute:** one RTX 5090 (private lab PC, `infra/nbtc`).
- **Caching:** features cached per backbone and dataset (npz, outside git).
- **Code and outputs:** code in `ml/research/`, configs in YAML, fixed seeds. Results are JSON, and every figure is generated from the JSON.
- **Ethics and licences:** only permissive licences. Leaf photos carry no personal data; images that show people are excluded if found. Every dataset creator is cited.
- **Honesty:**
  - expert verdicts are simulated by dataset labels: a replay, not a field trial, and every claim says so;
  - there are no farmer users in this study.
