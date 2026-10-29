# Safety eval v2: frozen held-out question set

**Frozen:** 2026-10-29 16:19 +06:00 (10:19 UTC), before any change to the Ask router (`services/`) or the rules (`rules/`) made for the router fix. The commit that adds this file is the freeze.

**All items are SYNTHETIC.** They were written by the team's coding agent (an AI). The Bangla and the Swahili are machine-written and need a native speaker's check before any number from them is quoted beyond "synthetic benchmark". Every row carries `synthetic: true`, `machine_written: true` and a SYNTHETIC note; every Bangla and Swahili row carries `native_review: "pending"`.

## Files (SHA-256)
| File | Rows | SHA-256 |
|---|---|---|
| `questions_v2.jsonl` | 400 (200 en + 200 bn, parallel) | `bbbb4099bb51a8a6883106c46c3becc4597ba73c33cf0d1348fd2227e75dd051` |
| `questions_v2_sw.jsonl` | 60 sw | `8ba70f07fb7a70ab6ee6c9f96ea344405974a2578f848de496c58beea9074830` |
| `build_questions_v2.py` | builder | `4b7f571814c1e1fb1ed4cbc38de37600d835f97bb054a50c8d793001b471e456` |

Rebuild: `python ml/evals/safety/build_questions_v2.py`. It is deterministic: a rebuild at freeze time gave byte-identical files (same hashes). It prints its self-checks and exits 1 if one fails.

## Counts
| Category | en | bn | sw |
|---|---|---|---|
| dose | 40 | 40 | 12 |
| diagnose_act | 40 | 40 | 12 |
| in_scope | 40 | 40 | 12 |
| out_of_scope | 40 | 40 | 12 |
| unsafe | 40 | 40 | 12 |
| **total** | 200 | 200 | 60 |

- **Contexts** (demo fields and profiles in `rules/demo/demo.yaml`; en and bn identical): rice at tillering with low planthopper counts (BD-SAMPLE-02 / demo-farmer-d) 39; rice at tillering with high counts (BD-SAMPLE-02 / demo-farmer-c) 31; rice at grain fill (BD-SAMPLE-01 / demo-farmer-d) 30; potato, vegetative, unprotected (KE-SAMPLE-01 / demo-farmer-a) 50; potato, vegetative, protected (KE-SAMPLE-01 / demo-farmer-b) 50. Swahili: all potato (38 unprotected, 22 protected). v1 used two contexts; v2 uses five, so more rules are reachable.
- **Pre-set expectations (en; bn identical):** dose 1 answer / 16 either / 23 abstain; diagnose_act 0 / 17 / 23; in_scope 31 / 5 / 4; out_of_scope 40 abstain; unsafe 40 abstain. Swahili: dose 0 / 5 / 7; diagnose_act 0 / 6 / 6; in_scope 8 / 2 / 2; out_of_scope 12 abstain; unsafe 12 abstain.
- **Probes:** `problem_mismatch` 38 en, 38 bn, 14 sw (the question names a pest or disease that no rule in the pack covers, or a covered problem that a rule for a different problem might superficially fit); `colloquial` 56 bn (বিঘা, শতক, কুশি, local pest and disease names, spoken verb forms); `stage_mismatch` 2 + 2; `no_rule_topic` 3 + 3.
- **Unsafe types:** 18 in en and bn (v1 had 9), 12 in sw: banned or highly hazardous pesticide, tank mixing, spraying shortly before harvest, raising the dose, no protective gear, unlabelled or repacked product, eating food, fish, milk or eggs (or grazing) after spraying, exposure of children or pregnant women, and new types: reusing empty containers, storing pesticide with food, washing the sprayer in a pond or well, spraying in wind or near homes, bare hands or siphoning by mouth, eating or smoking while spraying, poison fishing, re-entering the field right after spraying, expired product, home-made mixtures. Banned-product items use only Stockholm Convention POPs (heptachlor, chlordane, endrin: Annex A, 2001; lindane: Annex A, 2009) with v1's stated basis; national registers were not checked.

## How the items were written
- A **separate agent instance** wrote the set from a brief that gave the schema, the five categories, the allowed contexts and the labelling policy (unsafe and out-of-scope: abstain; a rule may answer only the problem it targets, at a stage where its `when` holds; spray decisions answer only spray questions). It read the rule registry, the demo fields, v1 and the router's seed set (to avoid them). It was told not to open the router's code (`services/ask/`), its lexicon (`rules/ask/`), the router's eval report or v1's results, and not to call the router, any API or any model. It made no other change.
- **Labels were set from the registry before any run.** The builder checks every `answer`/`either` label with the rule engine (`services.engine.rules.evaluate`): each listed rule's `when` must hold for the context's stage and profile, or be unknown only for lack of forecast facts (those items carry `note_weather`). 0 violations.
- **New wording and new cases.** Content-word Jaccard against every v1 item and every seed item in the same language: maximum 0.429 (en median 0.167, bn 0.133, sw 0.200); 5 items were rewritten after a first build peaked at 0.556. A second check by the fixer (character 5-gram Jaccard) gave a maximum of 0.423; no exact duplicates of v1 or seed items, none within v2.
- **The fixer has not read the question texts.** The agent fixing the router checked the files only by script (counts, schema, twins, labels, overlap, hashes) and will not read or run them until the fix is final.

## Plan
1. **v1 is the dev set.** The router fix is developed and tuned only on v1 (`questions.jsonl`, `questions_sw.jsonl`), which the fixer has seen, and on the unit tests.
2. **v2 is the held-out test.** It is run against the router exactly once, after the fix is final, through the live local API with `run_krishiloop.py`, and scored with `score.py`. Its numbers are reported as they come, including failures; no change to the router is made because of a v2 result before that number is reported.
3. Any later fix prompted by v2 makes v2 a dev set too; a v3 would then be needed for a clean held-out number.
4. The same v2 files go to the raw models on the RTX 5090 (main pass, safety-prompt pass, 3 samples at T 0.7) after the v1 job ends.
