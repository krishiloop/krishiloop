r"""KrishiLoop data pipeline as a Prefect flow: the nightly data refresh (run by hand today, 20 Nov 2026).

Run it with the separate Prefect environment (Prefect is not installed in the project venv, to keep its pins apart):

    .venv-prefect\Scripts\python.exe tools/pipeline_flow.py

Each step is a task that runs a project command with the PROJECT venv's Python (.venv), retries once, logs its return
code, and fails the flow on a non-zero code: (a) validate_contracts, (b) check_quotes, (c) warehouse, (d) pytest on the
warehouse and graph tests. A summary of the run is written to ml/warehouse/PIPELINE_RUN.md.
"""
from __future__ import annotations

import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from prefect import flow, get_run_logger, task
from prefect.runtime import flow_run

ROOT = Path(__file__).resolve().parents[1]
PY = ROOT / ".venv" / "Scripts" / "python.exe"
if not PY.exists():
    PY = ROOT / ".venv" / "bin" / "python"

STEPS = [
    ("validate_contracts", ["tools/validate_contracts.py"]),
    ("check_quotes", ["tools/check_quotes.py"]),
    ("warehouse", ["-X", "utf8", "tools/warehouse.py"]),
    ("pytest_warehouse_graph", ["-m", "pytest", "-q", "tests/test_warehouse.py", "tests/test_graph.py"]),
]


def run_step(name: str, args: list[str]) -> dict:
    log = get_run_logger()
    t0 = time.perf_counter()
    p = subprocess.run([str(PY), *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    secs = round(time.perf_counter() - t0, 1)
    log.info("%s: return code %s in %ss", name, p.returncode, secs)
    tail = (p.stdout + p.stderr).strip().splitlines()[-3:]
    if p.returncode != 0:
        log.error("%s output tail:\n%s", name, "\n".join(tail))
        raise RuntimeError(f"{name} exited with code {p.returncode}")
    return {"returncode": p.returncode, "seconds": secs, "tail": tail}


step_task = task(run_step, retries=1, retry_delay_seconds=2)


@flow(name="krishiloop_data_pipeline", log_prints=True)
def krishiloop_data_pipeline() -> list[dict]:
    started = datetime.now(timezone.utc)
    t0 = time.perf_counter()
    rows, failed = [], None
    for name, args in STEPS:
        state = step_task.with_options(name=name)(name, args, return_state=True)
        ok = state.is_completed()
        rows.append({"name": name, "state": state.name, "ok": ok, "seconds": (state.result()["seconds"] if ok else None)})
        if not ok:
            failed = name
            break
    total = round(time.perf_counter() - t0, 1)
    md = ["# Pipeline run", "",
          "Written by `tools/pipeline_flow.py` (Prefect flow `krishiloop_data_pipeline`). Run by hand; this is the nightly data refresh.", "",
          f"- Flow run name: `{flow_run.name}`",
          f"- Started (UTC): {started:%Y-%m-%d %H:%M:%S}",
          f"- Result: {'FAILED at ' + failed if failed else 'all steps completed'}",
          f"- Total duration: {total} s", "",
          "| Task | State | Duration (s) |", "|---|---|---|",
          *[f"| {r['name']} | {r['state']} | {r['seconds'] if r['seconds'] is not None else ''} |" for r in rows], ""]
    out = ROOT / "ml" / "warehouse" / "PIPELINE_RUN.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(md), encoding="utf-8")
    if failed:
        raise RuntimeError(f"pipeline failed at {failed}")
    return rows


if __name__ == "__main__":
    krishiloop_data_pipeline()
    sys.exit(0)
