"""Hand-check of the detectors: a stratified random sample of raw-model answers, labelled BLIND.

  python handcheck.py sample [--per-stratum 2] [--per-stratum-extra 1] [--sw-per-category 1] [--seed 20261029] [--force]
      For every model whose main, safeprompt and t07x3 passes are complete (or --force): per (en|bn x category)
      stratum, draw --per-stratum main-pass answers and --per-stratum-extra answers from safeprompt + t07x3 pooled,
      plus --sw-per-category Swahili main answers per category: 35 per model by default. Seeded; a model added later
      gets its own draw and earlier draws never change, so the call is safe to repeat. Writes
        handcheck/sample.jsonl       sample_id, lang, category, question, answer   (BLIND: no model, no detectors)
        handcheck/sample_key.jsonl   sample_id -> model, item, detector outputs    (do not open while labelling)
        runs/human_review.csv        the same blind sheet for the team, with empty label columns (Y/N)
  python handcheck.py show --start 0 --count 15
      Prints blind sample items for labelling.
Labels go to handcheck/labels.jsonl: one JSON object per sample_id with a boolean per detector (see LABEL_FIELDS) and
an optional "note". score.py turns them into precision and recall.

The answers are evidence (doses, brand names): runs/human_review.csv is for the team only, never for the site.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from detectors import detect  # noqa: E402

LABEL_FIELDS = ["gives_dose", "pesticide_dose", "names_active_ingredient", "names_brand", "refers_to_officer",
                "declines", "answers_in_language"]
CATS = ["dose", "diagnose_act", "in_scope", "out_of_scope", "unsafe"]


def load_jsonl(p: Path) -> list[dict]:
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []


def sample(per_stratum: int, per_stratum_extra: int, sw_per_category: int, seed: int, force: bool = False) -> None:
    """Per model: per (en|bn x category) stratum, `per_stratum` answers from the main pass and `per_stratum_extra`
    from the other passes pooled (safeprompt, t07x3); plus `sw_per_category` Swahili main answers per category."""
    qs = {}
    for name in ("questions.jsonl", "questions_sw.jsonl"):
        qs |= {q["id"]: q for q in load_jsonl(HERE / name)}
    expected = {"main": len(qs), "safeprompt": len(qs), "t07x3": 3 * len(qs)}   # rows per model when a pass is done
    out_dir = HERE / "handcheck"
    out_dir.mkdir(exist_ok=True)
    key_path, blind_path = out_dir / "sample_key.jsonl", out_dir / "sample.jsonl"
    key = load_jsonl(key_path)
    have_models = {k["model"] for k in key}
    new_key, new_blind = [], []
    det_sha = hashlib.sha256(b"".join((HERE / n).read_bytes() for n in ("detectors.py", "lexicon.py"))).hexdigest()

    def add(r, model):
        sid = hashlib.sha256(f"{model}|{r['variant']}|{r['item_id']}|{r.get('sample', 0)}".encode()).hexdigest()[:10]
        q = qs[r["item_id"]]
        new_blind.append({"sample_id": sid, "lang": r["lang"], "category": r["category"], "question": q["question"],
                          "answer": r["answer"]})
        new_key.append({"sample_id": sid, "model": model, "pass": r["variant"], "item_id": r["item_id"],
                        "sample": r.get("sample", 0), "lang": r["lang"], "category": r["category"],
                        "detectors": detect(r["answer"], r["lang"], q["question"]), "detectors_sha256": det_sha})

    for f in sorted((HERE / "runs" / "raw" / "main").glob("*.jsonl")):
        rows = [r for r in load_jsonl(f) if r.get("answer")]
        if not rows:
            continue
        model = rows[0]["model"]
        if model in have_models:
            continue
        have = {p: len(load_jsonl(HERE / "runs" / "raw" / p / f.name)) for p in expected}
        if not force and any(have[p] < expected[p] for p in expected):
            print(f"not drawn yet, passes incomplete: {model} {have} (need {expected}); --force draws anyway")
            continue
        extra = []
        for p in ("safeprompt", "t07x3"):
            extra += [r for r in load_jsonl(HERE / "runs" / "raw" / p / f.name) if r.get("answer")]
        rng = random.Random(f"{seed}:{model}")
        key_of = lambda r: (r["item_id"], r.get("variant", ""), r.get("sample", 0))  # noqa: E731
        for lang in ("en", "bn"):
            for cat in CATS:
                pool = sorted([r for r in rows if r["lang"] == lang and r["category"] == cat], key=key_of)
                for r in rng.sample(pool, min(per_stratum, len(pool))):
                    add(r, model)
                pool = sorted([r for r in extra if r["lang"] == lang and r["category"] == cat], key=key_of)
                for r in rng.sample(pool, min(per_stratum_extra, len(pool))):
                    add(r, model)
        for cat in CATS:
            pool = sorted([r for r in rows if r["lang"] == "sw" and r["category"] == cat], key=key_of)
            for r in rng.sample(pool, min(sw_per_category, len(pool))):
                add(r, model)
    blind = load_jsonl(blind_path) + new_blind
    key = key + new_key
    # shuffle the blind order (seeded) so a labeller cannot read the model from the sequence
    order = sorted(blind, key=lambda b: hashlib.sha256(f"{seed}|{b['sample_id']}".encode()).hexdigest())
    blind_path.write_text("".join(json.dumps(b, ensure_ascii=False) + "\n" for b in order), encoding="utf-8")
    key_path.write_text("".join(json.dumps(k, ensure_ascii=False) + "\n" for k in key), encoding="utf-8")
    csv_path = HERE / "runs" / "human_review.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["sample_id", "lang", "category", "question", "answer"] + [f"label_{x} (Y/N)" for x in LABEL_FIELDS]
                   + ["reviewer", "note"])
        for b in order:
            w.writerow([b["sample_id"], b["lang"], b["category"], b["question"], b["answer"]] + [""] * (len(LABEL_FIELDS) + 2))
    print(f"added {len(new_blind)} (models: {sorted({k['model'] for k in new_key})}); total {len(order)}")


def show(start: int, count: int, only_unlabelled: bool) -> None:
    blind = load_jsonl(HERE / "handcheck" / "sample.jsonl")
    done = {l["sample_id"] for l in load_jsonl(HERE / "handcheck" / "labels.jsonl")}
    items = [b for b in blind if not (only_unlabelled and b["sample_id"] in done)]
    for b in items[start:start + count]:
        print(f"=== {b['sample_id']} [{b['lang']}/{b['category']}] Q: {b['question']}")
        print(b["answer"])
        print()


def label(lines: list[str]) -> None:
    """Compact entry: '<sample_id> <7 digits 0/1 in LABEL_FIELDS order> [note]', e.g. 'a1b2c3d4e5 1100001 dose in a table'."""
    path = HERE / "handcheck" / "labels.jsonl"
    have = {l["sample_id"] for l in load_jsonl(path)}
    valid = {b["sample_id"] for b in load_jsonl(HERE / "handcheck" / "sample.jsonl")}
    n = 0
    with path.open("a", encoding="utf-8") as f:
        for line in lines:
            parts = line.strip().split(maxsplit=2)
            if len(parts) < 2:
                continue
            sid, bits = parts[0], parts[1]
            if sid not in valid or sid in have or len(bits) != len(LABEL_FIELDS) or set(bits) - {"0", "1"}:
                print(f"skipped: {line.strip()[:60]}")
                continue
            rec = {"sample_id": sid, **{k: b == "1" for k, b in zip(LABEL_FIELDS, bits)},
                   "labeller": "coding agent (AI), blind", "note": parts[2] if len(parts) > 2 else ""}
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            have.add(sid)
            n += 1
    print(f"labelled {n}; total {len(have)} of {len(valid)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("label", help="read compact labels from stdin")
    s = sub.add_parser("sample")
    s.add_argument("--per-stratum", type=int, default=2, help="main-pass answers per (lang x category) stratum")
    s.add_argument("--per-stratum-extra", type=int, default=1, help="answers from safeprompt/t07x3 per stratum")
    s.add_argument("--sw-per-category", type=int, default=1)
    s.add_argument("--seed", type=int, default=20261029)
    s.add_argument("--force", action="store_true", help="draw even if a model's passes are incomplete")
    sh = sub.add_parser("show")
    sh.add_argument("--start", type=int, default=0)
    sh.add_argument("--count", type=int, default=15)
    sh.add_argument("--all", action="store_true", help="include items already labelled")
    a = ap.parse_args()
    if a.cmd == "sample":
        sample(a.per_stratum, a.per_stratum_extra, a.sw_per_category, a.seed, a.force)
    elif a.cmd == "label":
        label(sys.stdin.read().splitlines())
    else:
        show(a.start, a.count, not a.all)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
