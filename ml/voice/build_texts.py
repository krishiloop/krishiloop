"""Build ml/voice/tts_texts.jsonl: the Bangla texts we synthesise and transcribe back.

* rule_title: the Bangla `action.title.bn` of every rule in rules/registry/pack-bd-rice/*.yaml (real rule texts;
  note their review level is still "pending": Bangla wording awaits native-speaker review).
* farmer_question: the Bangla seed questions in ml/ask/questions.seed.jsonl (SYNTHETIC, written by the team's
  coding agent on 28 Oct) plus 8 extra SYNTHETIC questions written here on 29 Oct so every domain word in the
  brief (including কুশি and বিঘা, absent from the seeds) is covered. They are questions only, no advice.
Duplicate texts are kept once (the ids that share a text are listed in `also`).
"""
import glob
import json
import os

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TERMS = ["বাদামি গাছফড়িং", "ব্লাস্ট", "স্প্রে", "কুশি", "ইউরিয়া", "বিঘা"]
EXTRA = [  # SYNTHETIC (voice track, 29 Oct 2026): domain-word coverage for the ASR check, not real farmers
    ("qv-01", "এক বিঘা জমিতে কতটুকু ইউরিয়া দেব?"),
    ("qv-02", "ধানের কুশি কম হচ্ছে, কী করব?"),
    ("qv-03", "কুশি বের হওয়ার সময় কি স্প্রে করতে হবে?"),
    ("qv-04", "দুই বিঘা জমিতে বাদামি গাছফড়িং দেখা দিয়েছে, কী করব?"),
    ("qv-05", "পাতায় চোখের মতো দাগ দেখছি, এটা কি ব্লাস্ট?"),
    ("qv-06", "বৃষ্টির আগে স্প্রে করব, না পরে?"),
    ("qv-07", "কুশি গজানোর পর কি ইউরিয়া দেওয়া যাবে?"),
    ("qv-08", "বিঘা প্রতি কতটুকু সার লাগবে?"),
]


def main():
    out, seen = [], {}

    def add(rec):
        if rec["text"] in seen:
            seen[rec["text"]].setdefault("also", []).append(rec["id"])
            return
        rec["terms"] = [t for t in TERMS if t in rec["text"]]
        seen[rec["text"]] = rec
        out.append(rec)

    for p in sorted(glob.glob(os.path.join(REPO, "rules", "registry", "pack-bd-rice", "*.yaml"))):
        d = yaml.safe_load(open(p, encoding="utf-8"))
        add({"id": d["rule_id"], "group": "rule_title", "text": d["action"]["title"]["bn"].strip(),
             "source": f"rules/registry/pack-bd-rice/{os.path.basename(p)}#action.title.bn",
             "rule_status": d.get("status"), "review_level": (d.get("review") or {}).get("level"),
             "synthetic": False})
    for line in open(os.path.join(REPO, "ml", "ask", "questions.seed.jsonl"), encoding="utf-8"):
        q = json.loads(line)
        if q.get("lang") == "bn":
            add({"id": q["id"], "group": "farmer_question", "text": q["question"].strip(),
                 "source": f"ml/ask/questions.seed.jsonl#{q['id']}", "synthetic": True})
    for qid, text in EXTRA:
        add({"id": qid, "group": "farmer_question", "text": text,
             "source": "ml/voice/build_texts.py (SYNTHETIC, voice track, 2026-10-29)", "synthetic": True})
    with open(os.path.join(HERE, "tts_texts.jsonl"), "w", encoding="utf-8") as f:
        for r in out:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    g = {}
    for r in out:
        g[r["group"]] = g.get(r["group"], 0) + 1
    cov = {t: sum(1 for r in out if t in r["terms"]) for t in TERMS}
    print("texts:", g, "term coverage:", cov)


if __name__ == "__main__":
    main()
