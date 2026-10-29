#!/usr/bin/env bash
# Copy the v2 raw-model results back from the 5090 and score them. Run from the repo root on the laptop (Git Bash):
#   bash ml/evals/safety/ops/fetch_and_score_v2.sh
# Safe to repeat (the 5090 files are append-only and resumable; score.py recomputes everything). Raw answers land in
# runs/raw_v2/ (git-ignored: they are evidence, not for a public repo); report_v2.json holds aggregates only.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p runs/raw_v2
scp -q -r "nbtc5090:F:/krishiloop-5090/work/safety_v2/runs/raw/*" runs/raw_v2/
export PYTHONIOENCODING=utf-8
python score.py --set v2
