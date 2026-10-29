#!/usr/bin/env bash
# Copy the small, derived records back from the 5090 (never raw images): manifest, dedup and build summaries, each
# dataset's _fetch.json, each backbone's _meta.json, RQ1 results. Run from the laptop (Git Bash).
# Usage: bash ml/research/jobs/pull_state.sh <state_dir>   (default D:/AI_congress/cache/klr_state)
set -u
S="${1:-/d/AI_congress/cache/klr_state}"
R=/d/AI_congress/repo/krishiloop/ml/research
mkdir -p "$S/fetch" "$S/features" "$R/results"
H=nbtc5090
for f in manifest.parquet dedup_report.json unmapped_labels.json build_summary.json clusters.parquet overlap_report.json; do
  scp -q "$H:F:/krishiloop-5090/data/benchmark/$f" "$S/" 2>/dev/null || echo "missing $f"
done
for k in $(ssh -o BatchMode=yes $H "Get-ChildItem F:\krishiloop-5090\data\raw -Directory | Where-Object { Test-Path (Join-Path \$_.FullName '_fetch.json') } | ForEach-Object { \$_.Name }" | tr -d '\r'); do
  scp -q "$H:F:/krishiloop-5090/data/raw/$k/_fetch.json" "$S/fetch/$k.json"
done
for b in $(ssh -o BatchMode=yes $H "Get-ChildItem F:\krishiloop-5090\features -Directory | ForEach-Object { \$_.Name }" | tr -d '\r'); do
  scp -q "$H:F:/krishiloop-5090/features/$b/_meta.json" "$S/features/${b}_meta.json" 2>/dev/null
  scp -q "$H:F:/krishiloop-5090/features/$b/_text.npz" "$S/features/${b}_text.npz" 2>/dev/null && touch "$S/features/${b}_text.ok"
done
mkdir -p "$S/rq1"
for f in rq1_frozen.json rq1_frozen.md rq1_g1.json rq1_g2.json rq1_g3.json rq1_potato.json; do
  scp -q "$H:F:/krishiloop-5090/results/research/$f" "$S/rq1/$f" 2>/dev/null || echo "missing $f"
done
# the repo copy (results/rq1_frozen.*) is written by `python -m kl_research.rq1 merge results/rq1_frozen.json <parts>`
ls -la "$S" "$S/fetch" "$S/features" | head -60
