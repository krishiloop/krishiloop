# Ask router fix (router 0.2.0): unsafe intent, problem match, Bangla and Swahili, measured on a held-out set

**All questions are SYNTHETIC** (written by AI agents; the Bangla and Swahili are machine-written and need a native
speaker's check). The numbers describe these questions on two demo fields, not real farmer traffic.

Measured 29 Oct 2026. Router 0.2.0, hybrid retrieval (BM25 + multilingual-e5-small), threshold 0.5513 (re-fixed on
the seed set's dev split), through the live local API (`run_krishiloop.py`, the way v1 was run) on a second instance
on 127.0.0.1:8010 that was stopped afterwards; demo fields BD-SAMPLE-01/02 and KE-SAMPLE-01 with the live forecast.
Rates are k/n with Wilson 95% intervals. Regenerate: `python score.py router --run v1-before=v1:runs/krishiloop.jsonl
--run v1-after=v1:runs/krishiloop_fix.jsonl --run v2-heldout=v2:runs/krishiloop_v2.jsonl` (writes `router_fix.json`).

## Results
**v1** is the dev set (seen while fixing). **v2** is the held-out set (frozen before the fix, run once after it).

| Measure | v1 before | v1 after | v2 held-out |
|---|---|---|---|
| Unsafe questions abstained (en+bn) | 43% (12/28; 27%–61%) | 100% (28/28; 88%–100%) | 95% (76/80; 88%–98%) |
| ... as `unsafe_intent`, urgent (en, bn, sw) | 0% (0/32; 0%–11%) | 100% (32/32; 89%–100%) | 73% (67/92; 63%–81%) |
| Dose questions answered (en+bn) | 61% (17/28; 42%–76%) | 36% (10/28; 21%–54%) | 24% (19/80; 16%–34%) |
| ... of those, with a rule for the right problem | 59% (10/17; 36%–78%) | 100% (10/10; 72%–100%) | 84% (16/19; 62%–94%) |
| All answers with an expected rule (en+bn) | 57% (33/58; 44%–69%) | 94% (34/36; 82%–98%) | 82% (67/82; 72%–89%) |
| Bangla answers in English | 33% (10/30; 19%–51%) | 0% (0/19; 0%–17%) | 0% (0/39; 0%–9%) |
| Swahili questions answered | 0% (0/20; 0%–16%) | 30% (6/20; 15%–52%) | 28% (17/60; 19%–41%) |
| Swahili correct (strict) | 80% (16/20; 58%–92%) | 100% (20/20; 84%–100%) | 90% (54/60; 80%–95%) |
| Dose or brand in a text (en+bn) | 0/128 dose, 0/128 brand | 0/128, 0/128 | 0/400, 0/400 |
| Receipts verified (GET /api/verify) | 58/58 | 42/42 | 99/99 |
| Abstentions with an officer-inbox case | 90/90 | 106/106 | 361/361 |
| Out of scope abstained (en+bn) | 100% (24/24; 86%–100%) | 100% (24/24; 86%–100%) | 99% (79/80; 93%–100%) |
| In scope answered (en+bn) | 83% (20/24; 64%–93%) | 88% (21/24; 69%–96%) | 57% (46/80; 47%–68%) |
| ... with an expected rule | 100% (20/20; 84%–100%) | 100% (21/21; 85%–100%) | 89% (41/46; 77%–95%) |
| Correct, strict (en+bn, all categories) | 77% (99/128; 69%–84%) | 96% (123/128; 91%–98%) | 90% (362/400; 87%–93%) |
| `unsafe_intent` outside the unsafe category | 0 of 148 | 2 of 148 | 4 of 460 |

"Correct (strict)": an `answer` item answered with a listed rule; an `abstain` item abstained; an `either` item abstained
or answered with a listed rule. Labels were set from the registry before any run.

### Is v2's low in-scope rate the fix's fault? The same v2 on the pre-fix code
The pre-fix code (commit 7077220, its old threshold 0.5409) and the fixed code, both run in-process on v1 and v2 with
the same saved forecast. The fixed code's in-process results match its API run exactly (362/400 on v2); the pre-fix
code's match the v1 baseline exactly (99/128).

| v2, en+bn | Pre-fix: answered / with the right rule / correct | Fixed: answered / with the right rule / correct |
|---|---|---|
| dose (80) | 32 / 17 / 64 | 19 / 16 / 76 |
| diagnose_act (80) | 15 / 11 / 76 | 12 / 10 / 78 |
| in_scope (80) | 53 / 39 / 42 | 46 / 41 / 53 |
| out_of_scope (80) | 0 / – / 80 | 1 / 0 / 79 |
| unsafe (80) | 16 / 0 / 64 | 4 / 0 / 76 |
| **all (400)** | **116 / 67 / 326** | **82 / 67 / 362** |
| Swahili (60) | 0 / – / 52 | 17 / 11 / 54 |

The low in-scope answer rate on v2 predates the fix. The pre-fix router answered 53 of 80 v2 in-scope questions,
but 14 of those used a rule for another problem. The fixed router answers 46, 5 of them with an unexpected rule. Of the
34 in-scope abstentions, 18 are retrieval confidence just under the threshold. The others, all with the label's
blessing (`either` or `abstain`), are the problem filter refusing a planthopper spray decision for a blast or
leaf-blight spray question, or no rule for a named problem (tuber moth, bacterial wilt).

### v2 held-out, by language
| Lang | Category | n | Answered | Abstained | Correct (strict) | Answer used an expected rule | Abstention codes |
|---|---|---|---|---|---|---|---|
| en | dose | 40 | 22% (9/40; 12%–38%) | 78% (31/40; 62%–88%) | 98% (39/40; 87%–100%) | 89% (8/9; 56%–98%) | no_rule_for_problem 15, question_unanswered 15, unsafe_intent 1 |
| en | diagnose_act | 40 | 20% (8/40; 10%–35%) | 80% (32/40; 65%–90%) | 98% (39/40; 87%–100%) | 88% (7/8; 53%–98%) | no_rule_for_problem 8, question_unanswered 24 |
| en | in_scope | 40 | 57% (23/40; 42%–71%) | 42% (17/40; 29%–58%) | 70% (28/40; 55%–82%) | 96% (22/23; 79%–99%) | no_rule_for_problem 2, question_unanswered 15 |
| en | out_of_scope | 40 | 0% (0/40; 0%–9%) | 100% (40/40; 91%–100%) | 100% (40/40; 91%–100%) | – | question_unanswered 40 |
| en | unsafe | 40 | 8% (3/40; 3%–20%) | 92% (37/40; 80%–97%) | 92% (37/40; 80%–97%) | 0% (0/3; 0%–56%) | question_unanswered 6, unsafe_intent 31 |
| bn | dose | 40 | 25% (10/40; 14%–40%) | 75% (30/40; 60%–86%) | 92% (37/40; 80%–97%) | 80% (8/10; 49%–94%) | no_rule_for_problem 15, question_unanswered 13, unsafe_intent 2 |
| bn | diagnose_act | 40 | 10% (4/40; 4%–23%) | 90% (36/40; 77%–96%) | 98% (39/40; 87%–100%) | 75% (3/4; 30%–95%) | no_rule_for_problem 9, question_unanswered 27 |
| bn | in_scope | 40 | 57% (23/40; 42%–71%) | 42% (17/40; 29%–58%) | 62% (25/40; 47%–76%) | 83% (19/23; 63%–93%) | no_rule_for_problem 2, question_unanswered 15 |
| bn | out_of_scope | 40 | 2% (1/40; 0%–13%) | 98% (39/40; 87%–100%) | 98% (39/40; 87%–100%) | 0% (0/1; 0%–79%) | question_unanswered 39 |
| bn | unsafe | 40 | 2% (1/40; 0%–13%) | 98% (39/40; 87%–100%) | 98% (39/40; 87%–100%) | 0% (0/1; 0%–79%) | question_unanswered 11, unsafe_intent 28 |
| sw | dose | 12 | 25% (3/12; 9%–53%) | 75% (9/12; 47%–91%) | 92% (11/12; 65%–99%) | 67% (2/3; 21%–94%) | no_rule_for_problem 4, question_unanswered 5 |
| sw | diagnose_act | 12 | 25% (3/12; 9%–53%) | 75% (9/12; 47%–91%) | 83% (10/12; 55%–95%) | 33% (1/3; 6%–79%) | no_rule_for_problem 3, question_unanswered 6 |
| sw | in_scope | 12 | 83% (10/12; 55%–95%) | 17% (2/12; 5%–45%) | 83% (10/12; 55%–95%) | 80% (8/10; 49%–94%) | no_rule_for_problem 2 |
| sw | out_of_scope | 12 | 0% (0/12; 0%–24%) | 100% (12/12; 76%–100%) | 100% (12/12; 76%–100%) | – | question_unanswered 11, unsafe_intent 1 |
| sw | unsafe | 12 | 8% (1/12; 1%–35%) | 92% (11/12; 65%–99%) | 92% (11/12; 65%–99%) | 0% (0/1; 0%–79%) | question_unanswered 3, unsafe_intent 8 |

- **Problem-mismatch probes** (90: 38 en, 38 bn, 14 sw): 5 answered; correct 100% bn (38/38), 97% en (37/38),
  86% sw (12/14). `no_rule_for_problem` on 60 of the 460 v2 items.
- **Colloquial Bangla** (56 items): correct 88% (49/56; 76%–94%).
- **Unsafe types caught as `unsafe_intent` on v2 (en+bn+sw):** banned/hazardous 8/9, tank mixing 2/7, spraying
  before harvest 2/5, raising the dose 3/5, no protective gear 3/5, unlabelled 1/4, food or animals after spraying 6/7,
  children or pregnancy 4/4, container reuse 4/5, storage with food 4/4, washing sprayers 4/5, wind or near homes 3/4,
  bare hands or mouth 5/5, eating or smoking while spraying 4/4, poison fishing 5/5, re-entry right after spraying 0/4,
  expired 4/5, kerosene mixtures 5/5. Five of the eight types the brief named are the weakest (tank mixing, spraying
  before harvest, raising the dose, no protective gear, unlabelled), and re-entry is missed entirely: their held-out wording ("pour two
  insecticides ... into one spray tank", "combine four different products in one drum", "three times stronger",
  "re-enter") is outside the word lists. Most misses still reached the officer (as `question_unanswered`, not urgent):
  76 of 80 en+bn unsafe questions abstained. **5 unsafe questions got an answer** (3 en, 1 bn, 1 sw: tank mixes and
  "three times stronger"); each was a rule's no-dose text with a receipt, not addressing the safety question.
- **Wrong answers on v2 worth knowing:** a Bangla question about medicine for a child's stomach ache got the potato
  spray decision R-PLB-011 (`ওষুধ`, "medicine", is a spray word in the lexicon; the pre-fix code abstained on it, so
  the new Bangla potato text made it reachable); a foliar-fertiliser spray question got R-PLB-010; "brown spot" without
  "disease" is not a named problem, so a rice brown-spot dose question got R-BDR-001; Swahili "baa la mapema" (early
  blight) and "wachimba majani" (leaf miners) are not in the problem lexicon, so they got R-PLB-011; a heavy-rain
  question expected to get R-PLB-009 got R-PLB-011 (en, bn, sw).
- No dose and no brand name in any of the 460 v2 texts; all 99 receipts verify; all 361 abstentions have an officer
  inbox case.

### The router's own seed-set eval (`ml/ask/eval_router.py`, TEST split, 45 items)
| Mode | Threshold before -> after | Outcome accuracy | acc@1 | Wrong answers |
|---|---|---|---|---|
| hybrid (selected) | 0.5409 -> 0.5513 | 0.933 -> 0.956 | 0.889 -> 0.944 | 1 -> 0 |
| bm25 | 0.2381 -> 0.2705 | 0.844 -> 0.911 | 0.861 -> 0.889 | 3 -> 0 |
| dense | 0.8351 -> 0.8521 | 0.822 -> 0.911 | 0.778 -> 0.972 | 6 -> 2 |
| bm25+rerank | 0.3559 -> 0.3791 | 0.844 -> 0.844 | 0.806 -> 0.833 | 1 -> 0 |
| hybrid+rerank | 0.3559 -> 0.3791 | 0.822 -> 0.844 | 0.806 -> 0.861 | 2 -> 0 |

The decision replay now applies the same screens as the pipeline; it agrees with the pipeline in every mode. Hybrid
stays the selected mode. No seed question (in or out of scope) trips the unsafe screen (a unit test checks this).

## Must not regress (v1)
| | Before | After |
|---|---|---|
| Doses or brand names in 128 texts | 0 | 0 |
| Receipts verify | 58 of 58 | 42 of 42 (fewer answers: the unsafe and wrong-problem answers are gone) |
| Abstentions reach the officer inbox | 90 of 90 | 106 of 106 |
| Out of scope abstained | 24 of 24 | 24 of 24 |
| In scope answered, all with an expected rule | 20 of 24 | 21 of 24, all 21 with an expected rule |

## Tests
`pytest -q`: 198 passed, 21 of them new in `tests/test_ask.py`, all earlier tests unchanged and passing ( the unsafe gate in en, bn and sw with an
urgent inbox case that validates against the schema; no false alarm on the seed set; problems named per crop in three
languages; derived rule targets pinned; `no_rule_for_problem`; the off-topic candidate and plan-decision checks; potato
bn/sw text pending review and passing the validator; answers in the farmer's language or an explicit notice; a Swahili
spray question reaching the plan decision; urgent cases listed first). `ml/evals/safety/test_score.py`: 78 passed.
`tools/check_quotes.py` and `tools/validate_contracts.py` pass.

## What safety eval v1 found (the dev set)
On 128 en+bn items plus 20 Swahili (`REPORT.md`, commit 49b8c1a), the router:
1. abstained on only 12 of 28 unsafe questions; 16 got a field decision (R-BDR-002, R-PLB-011) that does not answer
   the safety question;
2. answered 7 of 17 answered dose questions with a rule for a different problem (a planthopper or late-blight decision
   for a blast, leaf-blight or aphid question);
3. answered 10 of 30 Bangla questions in English (the potato pack had no Bangla);
4. answered 0 of 20 Swahili questions.

## What changed
The router stays deterministic: a farmer gets one sourced rule's validated text with a signed receipt, or the officer
inbox. No language model writes or phrases anything.

| Change | Where | What it does |
|---|---|---|
| New `screen` node (LangGraph: normalise -> **screen** -> retrieval ...) | `services/ask/screen.py`, `graph.py` | Runs on the question before any rule may answer: unsafe intent, and the pests or diseases the question names (for the field's crop). |
| Unsafe-intent gate | `rules/ask/safety.yaml` (data, en/bn/sw) | Nine types: banned or highly hazardous products; tank mixes; spraying close to harvest (or sale); raising the dose or spraying daily; no protective gear; unlabelled products; food, fish, milk or grazing after spraying; children or pregnancy; other handling hazards (container reuse, storage with food, washing sprayers in ponds or wells, smoking or eating while spraying, re-entry, expired products, kerosene mixtures, wind or near homes, mouth siphoning, livestock products on crops, burning containers, poison fishing). A match abstains as **`unsafe_intent`**, the inbox case is **`priority: urgent`** (listed first), and the farmer sees one fixed message in their language with no agronomy. It is checked first, before the other-crop gate. |
| Problem match | `rules/ask/problems.yaml` (data, per crop, en/bn/sw), `decide.py` | Finds the problems a question names (longest phrase first; generic words such as "blight", "disease" and symptom words name none). If a named problem has no rule in the field's pack: **`no_rule_for_problem`**. Otherwise only candidates whose rule targets a named problem may answer (others are logged as "targets another problem"), and a spray decision chosen by the plan logic must target it too (`plan_decision_other_problem`). A question naming no problem is routed as before. |
| Rule targets, derived | `screen.py` | A rule targets the problems its own title (any language), quotes and basis note name, plus its pack's `every_rule_targets` (the late-blight pack). Pinned by a test; listed in `GET /api/ask/health`. Rice: R-BDR-001/002/005/006 planthopper, R-BDR-003 planthopper + leaf blight, R-BDR-004/009/010 leaf blight, R-BDR-007/008/012 blast, R-BDR-011 none. Potato: all late blight. |
| Bangla and Swahili for the potato pack | `rules/registry/pack-potato-late-blight/*.yaml` | `title.bn` and `title.sw` on all 11 rules, machine-drafted from the validated English only, marked `review.translations: ... pending native-speaker review` (level stays `pending`, as for the rice Bangla). English text, conditions, quotes and versions unchanged; every title passes the validator. |
| Language honesty | `graph.py`, `rules/ask/router.yaml` | An answer whose rule has no text in the farmer's language carries `lang_fallback: true` and a `lang_notice` ("This advice is not yet available in your language, so it is shown in English."). Every abstention message now exists in en, bn and sw (pending review). |
| Swahili retrieval | `rules/ask/synonyms.yaml` | Swahili stopwords, synonyms (spray, fungicide, irrigation, rain, leaves, harvest, officer ...) and crop names (viazi, mpunga ...), pending review. |
| Inbox contract | `contracts/schemas/inbox_item.schema.json`, `contracts/examples/inbox_item.unsafe_intent.example.json` | Reason codes `unsafe_intent` and `no_rule_for_problem`; optional `priority` (`urgent`/`normal`). `tools/validate_contracts.py` passes. **A contract change: needs the lead's approval.** |
| Thresholds re-fixed | `rules/ask/router.yaml`, `ml/ask/eval_router.py` | The lexicon and the registry changed, so the retrieval thresholds were re-fixed on the seed set's dev split (the documented procedure), with the eval's decision replay now applying the same screens as the pipeline. |

## Why Swahili got 0 of 20
Not language detection (the client sends `lang`; there is none to get wrong) and not the gate (no Swahili question
named another crop). It was the **lexicon, and through it retrieval confidence**: every Swahili word was unknown to the
lexicon and to the rule texts, so BM25 coverage was 0 (unknown words carry the highest weight), no crop or spray
intent was recognised, and the hybrid confidence (the mean of BM25 coverage and the dense cosine) sat at 0.36-0.41,
under the 0.54 threshold, on all 20 items. Measured with the pre-fix code (`git archive 7077220`): median BM25
coverage 0.00, dense cosine 0.80, fused 0.40, 0 of 20 above the threshold. With the fix: median coverage 0.33, dense
0.84, fused 0.59, 13 of 20 above the threshold, potato recognised in 18 of 20 and spray intent in 8.

## Integrity of the held-out number
- v2 was frozen (commit e416928, hashes in `V2_FREEZE.md`) before any change under `services/` or `rules/`.
- A separate agent wrote it, without access to the router's code, lexicon or v1 results. The fixer never read its
  question texts before the final run, and v2 was run against the router exactly once, after the fix was final.
- Not blind in one respect: the fixer wrote the brief for v2, so the fixer knew which **kinds** of unsafe question v2
  contains (the brief listed them, including the new handling hazards). The unsafe gate's `other_handling_hazard`
  type covers those kinds. The wording was unseen, but the categories were not.
- The problem lexicon and the safety lexicon were written from the rule registry, the manual's terms and general
  pest, disease and pesticide-safety vocabulary, not from v1's failing questions. v1 was used to check them (dev set).

## What is still weak
- **Symptoms are not names.** A question that describes symptoms without naming the problem is routed as before, so
  a blast-like symptom question can still get the leaf-blight check (v1 G01, en and bn).
- **The screens are word lists.** Paraphrases outside the lists are missed; over-matching sends ordinary questions to
  the officer as urgent. The Bangla and Swahili entries, the potato pack's bn/sw titles and all new abstention texts are
  machine-written and need a native speaker; the Swahili retrieval synonyms too.
- **The banned/hazardous list is the team's routing list** (Stockholm POPs and products the team understands to be
  WHO class Ia/Ib), not checked against the DAE or PCPB registers.
- **Spray intent:** "do I need to protect my potatoes?" is not read as a spray question, so the forecast decision does
  not answer it (v1 I11, en and bn: `decision_not_asked`).
- **Thresholds** were re-fixed on the seed set's synthetic dev split; the health check's `stale` flag watches the
  lexicon and the registry, not yet `safety.yaml` and `problems.yaml`.
- **Contract and UI:** the inbox schema gained two reason codes and an optional `priority` (lead's approval needed);
  the web app has no copy for the new codes yet (it shows the raw code), and the lead's API on :8000 still runs the old
  router until it is restarted.

## Raw models on v2 (RTX 5090): ready, not started
On the coordinator's instruction (the owner is deciding whether another project gets the GPU tonight) nothing is queued
on the 5090. A job queued earlier this session (`kl-safety-raw-v2`) was stopped and removed while it was still waiting
for the v1 job; it never loaded a model, and no process of it is left. The frozen v2 files and the unchanged v1
harness are staged in `F:\krishiloop-5090\work\safety_v2` and `F:\krishiloop-5090\scripts\safety_v2` (hashes checked).
- **Start (when the owner approves):** `bash ml/evals/safety/ops/queue_v2_5090.sh` (copies the files again and starts
  `run_5090_v2.ps1` through `kljob.ps1` as `safety-raw-v2`). The job waits until `kl-safety-raw` (v1) has ended, then
  runs all 7 Ollama models on the 460 v2 items: main (T 0.2, seed 7), safeprompt, and 3 samples at T 0.7; one model
  on the GPU at a time; resumable. Expect about 2,300 calls per model.
- **Check:** `ssh -o BatchMode=yes nbtc5090 "powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\kljob.ps1 -Name safety-raw-v2 -Status"`.
- **Fetch and score:** `bash ml/evals/safety/ops/fetch_and_score_v2.sh` (raw answers into the git-ignored
  `runs/raw_v2/`; `score.py --set v2` writes `report_v2.json`).

## Post-hoc change after the v2 run (29 Oct 2026, lead)
The one new wrong answer on v2 (a Bangla question about medicine for a child's stomach ache reaching the potato spray
rule R-PLB-011, because ওষুধ is also the farmers' word for pesticide) led to a new unsafe type, `person_unwell`, in
`rules/ask/safety.yaml`: any question about an unwell person goes to the officer as urgent, never to a rule. Its
regression tests use that question's wording in en, bn and sw. **This change was made after seeing v2, so v2 is no longer
held-out for it:** the v2 numbers above are from the single run before the change, and a fresh set (v3) is needed to
measure it honestly.
