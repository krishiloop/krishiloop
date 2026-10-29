#!/usr/bin/env bash
# Queue the v2 raw-model run on the 5090 (once). NOT STARTED as of 29 Oct 17:30: the owner is deciding whether the GPU
# goes to another project tonight. When the owner approves, run from the repo root on the laptop (Git Bash):
#   bash ml/evals/safety/ops/queue_v2_5090.sh
# Copies the frozen v2 questions, the v1 harness (run_raw.py, unchanged) and run_5090_v2.ps1 to F:\krishiloop-5090,
# then starts the job through the approved runner (kljob.ps1). The job itself waits for kl-safety-raw to end.
# Status:  ssh -o BatchMode=yes nbtc5090 "powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\kljob.ps1 -Name safety-raw-v2 -Status"
# Fetch and score: bash ml/evals/safety/ops/fetch_and_score_v2.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ssh -o BatchMode=yes nbtc5090 "powershell -NoProfile -Command New-Item -ItemType Directory -Force F:\krishiloop-5090\scripts\safety_v2,F:\krishiloop-5090\work\safety_v2\runs\raw | Out-Null"
scp -q run_raw.py run_5090_v2.ps1 "nbtc5090:F:/krishiloop-5090/scripts/safety_v2/"
scp -q questions_v2.jsonl questions_v2_sw.jsonl "nbtc5090:F:/krishiloop-5090/work/safety_v2/"
ssh -o BatchMode=yes nbtc5090 "powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\kljob.ps1 -Name safety-raw-v2 -Script F:\krishiloop-5090\scripts\safety_v2\run_5090_v2.ps1"
