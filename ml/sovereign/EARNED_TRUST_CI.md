# DRAFT addendum for `ml/vision/MODEL_CARD.md`: earned trust with uncertainty (Oct 29, 2026)

Status: draft for the lead to merge. Nothing in `MODEL_CARD.md` was edited.

## What was done

The earned-trust headline came from one stream order per area (seed 0). For example: "Savar/BD-D: gate opened after 93 officer answers, then 86% of photos answered automatically at 99.6% precision".

The same simulation was re-run over **200 random stream orders per area** (seeds 0–199).

- **Protocol 2 unchanged, as pre-specified.** The script runs the protocol code of `ml/vision/analysis/earned_trust_sim_v2.py` from that file as it stands; nothing is copied or re-implemented. It cuts the file just before its own main loop.
  - Probe: λ = 0.3, with W = 100 (T + D).
  - Confidence: the prequential temperature.
  - Answers: "sure" at 0.85.
  - Gate: window 50, at least 30 sure answers, opens at a Wilson lower bound of 0.85, closes below 0.80.
  - 10% audit after opening.
  - At most 2,000 photos per stream.
- **Near-copy check as in the strict run.** Photos with a DINOv2-B cosine of 0.95 or more (plus the pHash groups) are clustered within each area, and each stream keeps one photo per cluster.
- **What a seed changes.** It changes the arrival order, which also picks each cluster's representative and, in Gazipur, which 2,000 of 4,212 clusters enter. It also changes the 10% audit draws.
- **Nothing was tuned on these results.**
- **Reproduction check.** Seeds 0–2 are the published runs.
  - 10 of 12 are identical field by field.
  - BD-D seed 2 differs by one photo (393 vs 394 officer answers).
  - BD-A seed 0 differs in one early-suggestion statistic (0.58 vs 0.56).
  - Both differences are floating-point summation order: workers run single-threaded BLAS, which can flip a photo whose confidence sits exactly at the 0.85 bar. In a laptop test, BD-D seed 1 differed the same way single-threaded and matched exactly multi-threaded.
- **How intervals are reported.** Each 95% interval is the 2.5th–97.5th percentile across the 200 runs (order statistics). It is the spread a deployment with this photo population could see, depending on the order in which photos arrive.
  - It does **not** include uncertainty about the photo population itself (other farms, phones or seasons), and labels stand in for officers.
  - The 95% CI of the *mean* (bootstrap over runs) is in the JSON and is much narrower.
- **Compute.** 800 runs on the NBTC RTX 5090 PC's CPU (14 processes) took 42 minutes.

## BioCLIP 2, protocol 2 as pre-specified (200 orders per area)

| Area (public dataset; labels stand in for officers) | Photos per stream | Gate opened | Officer answers before it opened | Then automatic (share of all photos) | Precision of automatic answers | Gate closings |
|---|---|---|---|---|---|---|
| Savar, BD-D RiceLeafDisease-BD5 | 1,633 | 200 of 200 runs | **102** (70–126) | **86.5%** (84.9–88.2%) | **99.4%** (99.0–99.7%); lowest run 98.9% | none in 200 runs |
| RiceyLeafDisease, BD-C | 510 | 200 of 200 | 194 (146–264) | 34.3% (27.1–40.0%) | 98.1% (95.3–100%); lowest 94.4% | none |
| Dhan-Shomadhan field, BD-A | 258 | **164 of 200** (82%; Wilson 76–87%) | 234 (185 – not opened) | 4.3% (0–10.1%) | 95.5% (81.8–100%) from 1–27 answers; lowest 66.7% | none |
| Gazipur, BD-E RiceLeafDiseaseBD | 2,000 of 4,212 clusters | 200 of 200 | 406 (315–614) | 32.9% (28.5–35.9%) | 95.7% (93.5–97.4%); lowest 92.2% | **1 closing in 28 of 200 runs** (14%; Wilson 10–19%) |

Medians, with 95% intervals in brackets.

- Officer workload per stream, including audits: Savar 360 (333–392), RiceyLeafDisease 351 (321–379), Dhan-Shomadhan 249 (232–258), Gazipur 1,410 (1,354–1,490).

**The headline, re-stated with its interval (suggested wording):**

> "Savar (BD-D): the gate opened after about 100 officer answers (70–126 across 200 random orders), and then about 86% of photos (85–88%) were answered automatically at 99.4% precision (99.0–99.7%), with no gate closing in any run."

- The published single run (93 answers, 85.9%, 99.57%) lies inside these intervals.
  - It was quicker than most orders (21st percentile for answers).
  - It had higher precision than most (83rd percentile).
  - So "99.6%" should become "99.4% (99.0–99.7%)".
- The other published ranges were also on the lucky side:
  - **RiceyLeafDisease:** 126–179 published vs 146–264 here. The published 126 is at the 1st percentile.
  - **Gazipur:** 328–510 published vs 315–614 here. The published 328 is at the 4th percentile.
- **Gazipur shows the drift alarm working.** In 14% of orders the gate closed once (and its trust credential would be revoked). Precision stayed at 92–97%.
- **Dhan-Shomadhan (258 photos) is too small to earn trust reliably.**
  - In 18% of orders the gate never opened.
  - When it did, it answered only about 4% of photos.
  - It answered on 1–27 photos, so per-run precision is noisy (lowest 66.7%).

## SigLIP 2-B, protocol 2 as pre-specified (PARTIAL: 152–165 of 200 orders per area at hand-off, 16:08)

| Area | Orders so far | Gate opened | Officer answers before it opened | Then automatic | Precision of automatic answers | Gate closings |
|---|---|---|---|---|---|---|
| Savar, BD-D | 164 | 164 of 164 | 115 (81–146) | 83.5% (81.5–85.2%) | 99.4% (99.0–99.8%); lowest 98.8% | none |
| RiceyLeafDisease, BD-C | 164 | 164 of 164 | 174 (128–226) | 39.4% (34.7–44.3%) | 97.8% (95.4–99.5%); lowest 94.3% | none |
| Dhan-Shomadhan field, BD-A | 165 | **39 of 165** (24%) | median: not opened (226 – not opened) | 0% (0–4.7%) | from 0–8 answers per run; not meaningful | none |
| Gazipur, BD-E | 152 | 152 of 152 | 317 (253–489) | 45.2% (40.6–50.1%) | 95.1% (93.7–96.7%); lowest 93.5% | **1 closing in 45 of 152 runs** (30%) |

**BioCLIP 2 versus SigLIP 2:**

- **BioCLIP 2 is better in Savar.** It opens sooner (102 vs 115 answers) and answers more (86.5% vs 83.5%) at the same precision.
- **BioCLIP 2 is much better on the small Dhan-Shomadhan set.** Its gate opened in 82% of orders, against 24% for SigLIP 2.
- **In Gazipur, SigLIP 2 opens sooner and answers more** (45% vs 33%) at similar precision (95.1% vs 95.7%). But it closes the gate twice as often (30% vs 14% of orders).
- This supports keeping BioCLIP 2 as the product backbone. The comparison is final only when all 200 orders are in.

## Other backbones (comparison)

**Status at hand-off.** These configurations are queued in the same 5090 job, after SigLIP 2; see "How to finish" below.

- DINOv2-B, DINOv2-L and DINOv3-B have **no text tower**, so protocol 2 (which anchors the probe to class-text embeddings T) is **undefined** for them.
- They are run with the same code and T = 0. This is a plain L2-regularised linear probe with the same λ, refits, temperature and gate.
- This variant was fixed on Oct 29 before any run. It is **not pre-registered and not protocol 2**; it is a comparison only.
- The same T = 0 run on BioCLIP 2 and SigLIP 2 isolates what the text anchor contributes.
- **DINOv3-B: licence under review.** The plan says DINOv3 is used only after legal review. Comparison only; not for the product.

<!-- TABLE: other backbones; filled from ml/vision/artifacts/earned_trust_ci.json when the job finishes -->

### How to finish

1. **The job.** It runs on the 5090 as the one-shot runner job `sov-etci`, configured in `F:\krishiloop-5090\sovereign\etci_configs.txt`.
   - Order: SigLIP 2 anchored, then DINOv2-B T0, DINOv2-L T0, DINOv3-B T0, BioCLIP 2 T0, SigLIP 2 T0.
   - At 14 processes, about 42 minutes per configuration: roughly 4 hours in all from 15:42.
2. **Check it:** `ssh nbtc5090 "powershell -File F:\krishiloop-5090\scripts\sovereign\etci_status.ps1"`, or `kljob.ps1 -Name sov-etci -Status`.
3. **Stop it cleanly**, for example if the CPU is needed: create `F:\krishiloop-5090\sovereign\artifacts\earned_trust_ci_runs.jsonl.STOP`.
4. **Resume:** `kljob.ps1 -Name sov-etci -Script F:\krishiloop-5090\scripts\sovereign\run_etci.ps1`. Finished runs are skipped.
5. **Collect:**
   - copy `F:\krishiloop-5090\sovereign\artifacts\earned_trust_ci_runs.jsonl` to `ml/vision/artifacts/`;
   - run `python ml/vision/analysis/earned_trust_ci.py ml/vision/artifacts --summarise`;
   - fill this table from `earned_trust_ci.json`.

## Caveats

- The datasets' labels stand in for officers' verdicts, so label noise counts as officer error. These are not real officers or real farms.
- One photo population per area: the intervals cover arrival order, not other farms, phones or seasons. A cluster-level resample that avoids duplicate photos (subsampling) would add that. It is not done here.
- The policy numbers (0.85 sure, window 50, open 0.85, close 0.80) are team-set drafts.
- The near-copy clusters at cosine 0.95 may join different leaves that look alike, which makes the check conservative.

## Files

- `ml/vision/analysis/earned_trust_ci.py`: the runner. It is resumable and stops cleanly on `<runs file>.STOP`.
- `ml/vision/artifacts/earned_trust_ci_runs.jsonl`: one line per run (seed, all outcomes, host, seconds).
- `ml/vision/artifacts/earned_trust_ci.json`: the summary, including the reproduction check, the mean CIs and each headline seed's percentile rank.
- Commands:
  - full run, 14 workers on the 5090: `python ml/vision/analysis/earned_trust_ci.py <artifacts> --seeds 200 --workers 14 --configs bioclip2:anchored,...`
  - summary only: `... --summarise`
