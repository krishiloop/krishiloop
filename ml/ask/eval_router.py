"""Evaluate the Ask router on SYNTHETIC seed questions and fix one retrieval threshold per mode on a dev split.

The seed set (ml/ask/questions.seed.jsonl) was written by the team's coding agent from the rule texts. Every item is
labelled synthetic, and so is this report: replace or verify the questions with real farmer questions before quoting
any number from it.
- Labels are checked against the rule engine first: an "answer" item's rule must apply in its context, and none of an
  in-scope "abstain" item's rules may. A mislabelled item stops the run instead of skewing it.
- Weather is a fixed synthetic forecast per item (no network), so the numbers reproduce.
- Items are split deterministically (sha256 of the id, stratified by category, expected outcome and language) into
  DEV (about 40%) and TEST. Each mode's threshold is fixed on DEV only (most correct outcomes; ties go to the higher,
  safer threshold). TEST numbers use that threshold; DEV numbers are shown too, labelled as such.
- Reported outcomes come from the real LangGraph pipeline (Router.ask). The threshold search replays the same
  decision functions on retrieval results, and the run reports whether the replay agrees with the pipeline.
- A mode whose model is not installed is reported as not run, never estimated.

    .venv/Scripts/python ml/ask/eval_router.py [--models DIR] [--write-thresholds]
Writes ml/ask/eval_report.json; with --write-thresholds also the runtime modes' thresholds in rules/ask/router.yaml.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import statistics
import sys
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
HERE = Path(__file__).resolve().parent
SEED = HERE / "questions.seed.jsonl"
REPORT = HERE / "eval_report.json"
CONFIG = ROOT / "rules" / "ask" / "router.yaml"
DEFAULT_MODELS = ROOT.parent.parent / "models" / "ask"
DEV_SHARE = 0.4
# SYNTHETIC 7-day forecasts, one per item (every day the same), chosen to exercise each rule's weather conditions.
WEATHER = {
    "calm": {"rh_mean_pct": 55, "tmin_c": 14, "tmax_c": 24, "precip_mm": 0.0},
    "humid_potato": {"rh_mean_pct": 95, "tmin_c": 12, "tmax_c": 20, "precip_mm": 1.0},
    "humid_rice": {"rh_mean_pct": 88, "tmin_c": 24, "tmax_c": 31, "precip_mm": 2.0},
    "heavy_rain": {"rh_mean_pct": 75, "tmin_c": 18, "tmax_c": 26, "precip_mm": 30.0},
    "missing": None,
}
CAVEAT = ("SYNTHETIC evaluation: all questions were written by the team's coding agent from the rule texts, and the "
          "weather is a synthetic forecast. These numbers measure the router against its own authors' questions, not "
          "real farmers. Replace or verify the seed set with real farmer questions before quoting any of them.")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def snapshot(name: str, today: date) -> dict:
    now, day = _now(), WEATHER[name]
    days = [] if day is None else [{"date": (today + timedelta(days=i)).isoformat(), **day} for i in range(7)]
    return {"snapshot_id": f"snap-synthetic-{name}", "field_id": "eval", "mode": "sample",
            "location": {"precision": "sample_location"}, "created_at": now,
            "forecast": {"source": "synthetic:eval", "issued_at": now, "days": days}}


def context(item: dict) -> tuple[dict, dict]:
    c = item["context"]
    field_ = {"field_id": f"EVAL-{item['id']}", "pack_id": c["pack_id"], "crop": c["crop"], "stage": c["stage"],
              "country": c["country"], "precision": "sample_location", "label": "synthetic evaluation context"}
    return field_, {"farmer_profile_id": f"eval-{item['id']}", **c["profile"]}


def load_items() -> list[dict]:
    items = [json.loads(line) for line in SEED.read_text(encoding="utf-8").splitlines() if line.strip()]
    for it in items:
        if it.get("synthetic") is not True:
            raise SystemExit(f"{it.get('id')}: every seed item must say synthetic: true")
    if len({it["id"] for it in items}) != len(items):
        raise SystemExit("duplicate item ids")
    return items


def dev_ids(items: list[dict]) -> set[str]:
    strata: dict[tuple, list[dict]] = {}
    for it in items:
        strata.setdefault((it["category"], it["expect"]["outcome"], it["lang"]), []).append(it)
    dev: set[str] = set()
    for group in strata.values():
        group = sorted(group, key=lambda it: hashlib.sha256(it["id"].encode()).hexdigest())
        dev |= {it["id"] for it in group[: round(DEV_SHARE * len(group))]}
    return dev


def check_labels(items, router, store, today, dec, evaluate) -> list[str]:
    problems = []
    for it in items:
        field_, profile = context(it)
        snap = snapshot(it["context"]["weather"], today)
        facts, _ = dec.field_facts(field_, profile, snap, today)
        plan = None

        def applies(rid: str) -> bool:
            nonlocal plan
            r = router.index.rules[rid]
            if r["action"]["kind"] == "input_decision":
                plan = plan or dec.plan_decision(field_, profile, store, snap, today)
                return plan["status"] == "ok" and any(a["receipt"]["rule_refs"][0]["rule_id"] == rid
                                                      for a in plan["actions"] if a["kind"] == "input_decision")
            return evaluate(r, facts)[0] is True
        for rid in it["relevant"] + it["expect"].get("rules", []):
            if rid not in router.index.rules or router.index.rules[rid]["pack_id"] != field_["pack_id"]:
                problems.append(f"{it['id']}: {rid} is not a rule of {field_['pack_id']}")
        if problems:
            continue
        if it["expect"]["outcome"] == "answer" and not any(applies(r) for r in it["expect"]["rules"]):
            problems.append(f"{it['id']}: labelled 'answer' but none of {it['expect']['rules']} applies in its context")
        if it["expect"]["outcome"] == "abstain" and it["category"] == "in_scope" and any(applies(r) for r in it["relevant"]):
            problems.append(f"{it['id']}: labelled 'abstain' but one of {it['relevant']} applies in its context")
    return problems


def is_correct(item: dict, outcome: tuple[str, str]) -> bool:
    if item["expect"]["outcome"] == "answer":
        return outcome[0] == "answer" and outcome[1] in item["expect"]["rules"]
    return outcome[0] == "abstain"


def metrics(items: list[dict], outcomes: dict, hits: dict) -> dict:
    rel = [it for it in items if it["relevant"]]
    should_abstain = {it["id"] for it in items if it["expect"]["outcome"] == "abstain"}
    abstained = {it["id"] for it in items if outcomes[it["id"]][0] == "abstain"}
    answered = [it for it in items if outcomes[it["id"]][0] == "answer"]
    right = sum(is_correct(it, outcomes[it["id"]]) for it in answered)
    should_answer = len(items) - len(should_abstain)

    def r(x):
        return None if x is None else round(x, 3)
    return {
        "items": len(items),
        "accuracy@1": r(sum(any(h.rule_id in it["relevant"] for h in hits[it["id"]][:1]) for it in rel) / len(rel)) if rel else None,
        "accuracy@3": r(sum(any(h.rule_id in it["relevant"] for h in hits[it["id"]][:3]) for it in rel) / len(rel)) if rel else None,
        "retrieval_items": len(rel),
        "abstention_precision": r(len(should_abstain & abstained) / len(abstained)) if abstained else None,
        "abstention_recall": r(len(should_abstain & abstained) / len(should_abstain)) if should_abstain else None,
        "abstained": len(abstained), "should_abstain": len(should_abstain),
        "answered": len(answered), "answered_right_rule": right, "wrong_answers": len(answered) - right,
        "coverage": r(right / should_answer) if should_answer else None,
        "outcome_accuracy": r(sum(is_correct(it, outcomes[it["id"]]) for it in items) / len(items)),
    }


def write_thresholds(fitted: dict, selected: dict) -> None:
    """Replace only the `selected_mode:` and `thresholds:` blocks at the end of rules/ask/router.yaml."""
    text = CONFIG.read_text(encoding="utf-8")
    head = re.split(r"(?m)^(?:selected_mode|thresholds):.*$", text)[0]
    block = yaml.safe_dump({"selected_mode": selected, "thresholds": fitted}, sort_keys=False, allow_unicode=True, width=120)
    CONFIG.write_bytes((head + block).encode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--models", type=Path, default=Path(os.environ.get("KRISHILOOP_ASK_MODELS") or DEFAULT_MODELS))
    ap.add_argument("--write-thresholds", action="store_true", help="store the dev-split thresholds in rules/ask/router.yaml")
    args = ap.parse_args()
    if args.models.exists():
        os.environ["KRISHILOOP_ASK_MODELS"] = str(args.models)
    else:
        os.environ.pop("KRISHILOOP_ASK_MODELS", None)
    from services.ask import decide as dec
    from services.ask.graph import ABLATION_MODES, MODES, Router
    from services.engine.rules import evaluate
    from services.trust.store import TrustStore

    items = load_items()
    dev = dev_ids(items)
    today = date.today()
    t0 = time.time()
    router = Router(thresholds={})
    build_s = round(time.time() - t0, 1)
    print(f"router built in {build_s}s; embedder {'yes' if router.embedder else 'no'}, reranker {'yes' if router.reranker else 'no'}")
    with tempfile.TemporaryDirectory() as tmp:
        # a throwaway store signed with a fixed TEST key: nothing here is ever served
        store = TrustStore("https://eval.invalid", "did:web:eval.invalid", "11" * 32, data_dir=Path(tmp) / "trust")
        inbox_dir = Path(tmp) / "inbox"
        problems = check_labels(items, router, store, today, dec, evaluate)
        if problems:
            print("\n".join(problems))
            raise SystemExit("seed labels disagree with the rule engine; fix them first")
        k, margin = router.walk_settings()
        plans: dict[str, dict] = {}

        def replay(it, hits, tau):
            field_, profile = context(it)
            snap = snapshot(it["context"]["weather"], today)
            q = router.lex.analyse(it["question"])
            if dec.gate(q, field_, tau):
                return ("abstain", "question_unanswered")
            facts, _ = dec.field_facts(field_, profile, snap, today)
            cands = dec.candidates(hits, router.index.rules, tau, k)
            d = dec.walk(cands, facts, store, lambda: plans.setdefault(
                it["id"], dec.plan_decision(field_, profile, store, snap, today)), margin, q.input_intent)
            return ("answer", d["rule_id"]) if d["kind"] == "answer" else ("abstain", d["code"])

        report_modes, fitted = {}, {}
        for mode, stages in ABLATION_MODES.items():
            if not router._available(stages):
                report_modes[mode] = {"run": False, "reason": "model not installed on this machine"}
                print(f"{mode}: not run (model not installed)")
                continue
            hits = {}
            for it in items:
                field_, _ = context(it)
                hits[it["id"]] = router.rank(it["question"], it["lang"], field_, stages)
            dev_items = [it for it in items if it["id"] in dev]
            taus = sorted({round(h.conf, 6) for it in dev_items for h in hits[it["id"]][:k]} | {0.0, 1.000001})
            scored = [(sum(is_correct(it, replay(it, hits[it["id"]], t)) for it in dev_items), t) for t in taus]
            best_dev, tau = max(scored)           # ties: the higher (safer) threshold
            outcomes, lat, disagree, rows = {}, [], [], []
            for it in items:
                field_, profile = context(it)
                snap = snapshot(it["context"]["weather"], today)
                t1 = time.perf_counter()
                res = router.ask(it["question"], it["lang"], field_, profile, store, inbox_dir=inbox_dir, snap=snap,
                                 today=today, stages=stages, threshold=tau)
                lat.append(1000 * (time.perf_counter() - t1))
                got = ("answer", res["answer"]["rule_id"]) if res["status"] == "ok" else ("abstain", res["abstention"]["reason_code"])
                outcomes[it["id"]] = got
                if replay(it, hits[it["id"]], tau) != got:
                    disagree.append(it["id"])
                rows.append({"id": it["id"], "split": "dev" if it["id"] in dev else "test", "lang": it["lang"],
                             "expected": it["expect"]["outcome"] + (f" {'|'.join(it['expect']['rules'])}" if it["expect"].get("rules") else ""),
                             "got": " ".join(got), "correct": is_correct(it, got),
                             "top3": [[h.rule_id, round(h.conf, 3)] for h in hits[it["id"]][:3]]})
            split = {"dev": [it for it in items if it["id"] in dev], "test": [it for it in items if it["id"] not in dev]}
            report_modes[mode] = {
                "run": True, "stages": list(stages), "threshold": round(tau, 6),
                "threshold_fixed_on": f"dev split ({len(split['dev'])} items): {best_dev} correct outcomes",
                "test": metrics(split["test"], outcomes, hits), "dev (threshold fitted here)": metrics(split["dev"], outcomes, hits),
                "latency_ms_median": round(statistics.median(lat)), "latency_ms_p90": round(sorted(lat)[int(0.9 * (len(lat) - 1))]),
                "replay_agrees_with_pipeline": not disagree, **({"replay_disagreements": disagree} if disagree else {}),
                "items": rows}
            t = report_modes[mode]["test"]
            print(f"{mode:14s} tau={tau:.4f} | test acc@1 {t['accuracy@1']} acc@3 {t['accuracy@3']} | abstain P {t['abstention_precision']} "
                  f"R {t['abstention_recall']} | wrong answers {t['wrong_answers']}/{t['answered']} | coverage {t['coverage']} | "
                  f"{report_modes[mode]['latency_ms_median']} ms")
            if mode in MODES:
                fitted[mode] = {"value": round(tau, 6),
                                **({"embedder_sha256": router.embedder.sha256} if "dense" in stages else {}),
                                **({"reranker_sha256": router.reranker.sha256} if "rerank" in stages else {}),
                                "fixed_on": f"dev split ({len(split['dev'])} items) of ml/ask/questions.seed.jsonl (SYNTHETIC)",
                                "fitted_at": _now(), "lexicon_sha256": router.lex.sha256,
                                "registry_sha256": router.index.registry_sha256}
    report = {
        "synthetic": True, "caveat": CAVEAT, "generated_at": _now(),
        "seed": {"file": "ml/ask/questions.seed.jsonl", "sha256": hashlib.sha256(SEED.read_bytes()).hexdigest(),
                 "items": len(items), "in_scope": sum(it["category"] == "in_scope" for it in items),
                 "out_of_scope": sum(it["category"] == "out_of_scope" for it in items),
                 "should_answer": sum(it["expect"]["outcome"] == "answer" for it in items),
                 "should_abstain": sum(it["expect"]["outcome"] == "abstain" for it in items),
                 "languages": {lang: sum(it["lang"] == lang for it in items) for lang in sorted({it["lang"] for it in items})},
                 "label_check": "passed: every label agrees with the rule engine in its context"},
        "split": {"method": "sha256(id) order within each (category, expected outcome, language) stratum; first 40% = dev",
                  "dev": len(dev), "test": len(items) - len(dev)},
        "weather": {"synthetic": True, "presets": WEATHER},
        "definitions": {
            "accuracy@k": "share of items with relevant rules whose top-k retrieved rules include one of them (retrieval only)",
            "abstention_precision": "of the questions the router sent to the officer, the share that should have gone",
            "abstention_recall": "of the questions that should go to the officer, the share that did",
            "wrong_answers": "answers whose rule is not an expected one, including answers to questions that should abstain",
            "coverage": "share of answerable questions answered with an expected rule",
            "outcome_accuracy": "share of questions with the right outcome (expected rule, or abstention when expected)"},
        "router": {"build_seconds": build_s, "index": router.index.stats(), "lexicon_sha256": router.lex.sha256,
                   "decide_top_k": k, "prefer_margin": margin,
                   "models": {"embedder": router.embedder.describe() if router.embedder else None,
                              "reranker": router.reranker.describe() if router.reranker else None}},
        "modes": report_modes,
    }
    # the server's mode is chosen on DEV only: best outcome accuracy, then fewest wrong answers, then lowest latency
    runtime = [m for m in fitted if report_modes[m].get("run")]
    pick = max(runtime, key=lambda m: (report_modes[m]["dev (threshold fitted here)"]["outcome_accuracy"],
                                       -report_modes[m]["dev (threshold fitted here)"]["wrong_answers"],
                                       -report_modes[m]["latency_ms_median"])) if runtime else None
    selected = {"mode": pick, "chosen_on": "dev split (SYNTHETIC): best outcome accuracy, then fewest wrong answers, "
                                          "then lowest latency, among the modes run on this machine",
                "chosen_at": _now()}
    report["selected_mode"] = selected
    REPORT.write_bytes((json.dumps(report, indent=1, ensure_ascii=False) + "\n").encode("utf-8"))   # LF on every OS
    print(f"wrote {REPORT.relative_to(ROOT)}; selected mode on dev: {pick}")
    if args.write_thresholds:
        write_thresholds(fitted, selected)
        print(f"thresholds for {sorted(fitted)} and the selected mode written to {CONFIG.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
