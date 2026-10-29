#!/usr/bin/env bash
# Copy the raw-model results back from the 5090 and rescore. Run from the repo root on the laptop (Git Bash):
#   bash ml/evals/safety/ops/fetch_and_score.sh
# Safe to repeat: the copy overwrites with the 5090's (append-only, resumable) files; score.py recomputes everything.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p runs/raw
scp -q -r "nbtc5090:F:/krishiloop-5090/work/safety/runs/raw/*" runs/raw/
export PYTHONIOENCODING=utf-8
python score.py
# add a blind hand-check / human-review draw for every model whose passes are complete (earlier draws never change)
python handcheck.py sample
# Then label the new draw BLIND (question + answer only; never open handcheck/sample_key.jsonl while labelling):
#   python handcheck.py show --count 12          # the next unlabelled items
#   python handcheck.py label  < labels.txt      # lines: <sample_id> <7 digits 0/1> [note]; see handcheck.py
# and re-run score.py. Field order: gives_dose pesticide_dose names_active_ingredient names_brand refers_to_officer
# declines answers_in_language; definitions in PATTERNS.md.
