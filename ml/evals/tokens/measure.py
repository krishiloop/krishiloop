"""Token use, measured: how we built KrishiLoop with AI, and what the product spends per answer.

  python ml/evals/tokens/measure.py [--dev-logs DIR]

Part 1, development (portal row "token optimisation", development-time). Reads the Claude Code session logs of this
project (default: ~/.claude/projects/D--AI-congress) and counts, per model and for the lead session vs subagents:
requests, fresh input tokens, prompt-cache writes, prompt-cache reads and output tokens. Only the `usage` numbers and the
model name are read: no message text, file content or path leaves the logs, and the logs are never copied into the
repo. A request is counted once (log lines are de-duplicated by request id).

Part 2, the product. KrishiLoop's plans and Ask answers are produced by a deterministic engine and retrieval over sourced
rules (ADR-1): no generative model is called, so no output token is generated per answer. For comparison, the raw-model
runs of the safety eval (ml/evals/safety/runs/raw/main) record Ollama's own token counts for every answer.

Writes ml/evals/tokens/report.json and REPORT.md.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SAFETY = ROOT / "ml" / "evals" / "safety"
DEFAULT_LOGS = Path.home() / ".claude" / "projects" / "D--AI-congress"
FIELDS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")


def dev_usage(logs: Path) -> dict:
    seen: set[str] = set()
    by = defaultdict(lambda: Counter())          # (role, model) -> counts
    sessions, subagents, compactions = set(), 0, 0
    first = last = None
    for f in sorted(logs.rglob("*.jsonl")):
        role = "subagent" if "subagents" in f.parts else "lead"
        subagents += role == "subagent"
        for line in f.open(encoding="utf-8", errors="replace"):
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if o.get("isCompactSummary") or (o.get("type") == "system" and o.get("subtype") == "compact_boundary"):
                compactions += 1
            if o.get("type") != "assistant":
                continue
            m = o.get("message") or {}
            u = m.get("usage")
            if not u:
                continue
            key = o.get("requestId") or m.get("id")
            if not key or key in seen:
                continue
            seen.add(key)
            if role == "lead":
                sessions.add(o.get("sessionId"))
            ts = o.get("timestamp")
            if ts:
                first, last = min(first or ts, ts), max(last or ts, ts)
            c = by[(role, m.get("model") or "unknown")]
            c["requests"] += 1
            for k in FIELDS:
                c[k] += int(u.get(k) or 0)
    rows = []
    for (role, model), c in sorted(by.items(), key=lambda kv: (kv[0][0], -kv[1]["requests"])):
        if model.startswith("<") or c["requests"] == 0:      # synthetic placeholder entries
            continue
        rows.append({"role": role, "model": model, **{k: c[k] for k in ("requests", *FIELDS)}})

    def total(rs):
        t = Counter()
        for r in rs:
            for k in ("requests", *FIELDS):
                t[k] += r[k]
        inp = t["input_tokens"] + t["cache_creation_input_tokens"] + t["cache_read_input_tokens"]
        return {**t, "all_input_tokens": inp,
                "cache_read_share_of_input": round(t["cache_read_input_tokens"] / inp, 4) if inp else None}

    lead = [r for r in rows if r["role"] == "lead"]
    sub = [r for r in rows if r["role"] == "subagent"]
    by_model = defaultdict(list)
    for r in rows:
        by_model[r["model"]].append(r)
    return {"logs": "Claude Code session logs of this project (usage fields only)",
            "period": {"first": first, "last": last}, "lead_sessions": len(sessions), "subagent_runs": subagents,
            "compactions": compactions, "rows": rows,
            "total": total(rows), "lead": total(lead), "subagents": total(sub),
            "by_model": {m: total(rs) for m, rs in sorted(by_model.items(), key=lambda kv: -sum(r["requests"] for r in kv[1]))}}


def product_tokens() -> dict:
    """Per raw model: Ollama's prompt and output token counts per answer (main pass), from the safety eval's raw runs."""
    rep = json.loads((SAFETY / "report.json").read_text(encoding="utf-8"))
    invalid = set(rep.get("invalid_runs") or {})
    out = {}
    for f in sorted((SAFETY / "runs" / "raw" / "main").glob("*.jsonl")):
        rows = [json.loads(x) for x in f.open(encoding="utf-8") if x.strip()]
        if not rows:
            continue
        m = rows[0]["model"]
        ev = [r["eval_count"] for r in rows if r.get("eval_count")]
        pe = [r["prompt_eval_count"] for r in rows if r.get("prompt_eval_count")]
        ch = [r["answer_chars"] for r in rows if r.get("answer_chars") is not None]
        wall = [r["wall_s"] for r in rows if r.get("wall_s")]
        out[m] = {"answers": len(rows), "valid_run": m not in invalid,
                  "output_tokens_median": statistics.median(ev) if ev else None,
                  "output_tokens_sum": sum(ev), "prompt_tokens_median": statistics.median(pe) if pe else None,
                  "answer_chars_median": statistics.median(ch) if ch else None,
                  "wall_s_median_under_8_way_concurrency": round(statistics.median(wall), 2) if wall else None,
                  "think": rows[0].get("think"), "num_predict": (rows[0].get("options") or {}).get("num_predict")}
    return {"source": "ml/evals/safety/runs/raw/main (Ollama eval_count / prompt_eval_count, 148 questions per model)",
            "raw_models": out,
            "krishiloop": {"generated_tokens_per_answer": 0,
                           "why": "plans come from the deterministic planner (services/engine/planner.py, ADR-1) and Ask "
                                  "answers are the validated text of a sourced rule picked by BM25 + a small multilingual "
                                  "encoder (multilingual-e5-small); no generative model runs in the product today",
                           "encoder_passes_per_question": 1}}


def fmt(n) -> str:
    return f"{n:,}" if isinstance(n, int) else str(n)


def write_md(rep: dict) -> None:
    L = [f"# Token use, measured ({rep['generated_at'][:10]})", "",
         "Generated by `ml/evals/tokens/measure.py`. Re-run it to refresh every number. Development numbers come from "
         "the Claude Code session logs on the lead's machine (only the usage counters are read); the logs themselves "
         "stay private.", ""]
    d = rep.get("dev")
    if d:
        t, lead, sub = d["total"], d["lead"], d["subagents"]
        L += ["## 1. How we built it (development-time)", "",
              f"- **Period:** {d['period']['first'][:10]} to {d['period']['last'][:10]}; {d['lead_sessions']} lead "
              f"sessions, {d['subagent_runs']} subagent runs, {d['compactions']} context compactions.",
              f"- **Requests:** {fmt(t['requests'])} ({fmt(lead['requests'])} lead, {fmt(sub['requests'])} subagents).",
              f"- **Prompt cache:** {t['cache_read_share_of_input']:.1%} of all input tokens were served from the "
              f"prompt cache ({fmt(t['cache_read_input_tokens'])} of {fmt(t['all_input_tokens'])}); "
              f"{fmt(t['cache_creation_input_tokens'])} were cache writes and {fmt(t['input_tokens'])} fresh.",
              f"- **Output:** {fmt(t['output_tokens'])} tokens.", "",
              "| Model | Requests | Fresh input | Cache writes | Cache reads | Output | Cache share of input |",
              "|---|---|---|---|---|---|---|"]
        for m, v in d["by_model"].items():
            L.append(f"| {m} | {fmt(v['requests'])} | {fmt(v['input_tokens'])} | {fmt(v['cache_creation_input_tokens'])} | "
                     f"{fmt(v['cache_read_input_tokens'])} | {fmt(v['output_tokens'])} | "
                     f"{v['cache_read_share_of_input']:.1%} |")
        L += ["", "| Role | Model | Requests | Output tokens |", "|---|---|---|---|"]
        for r in d["rows"]:
            L.append(f"| {r['role']} | {r['model']} | {fmt(r['requests'])} | {fmt(r['output_tokens'])} |")
        L += ["", "**What we did to save tokens** (each visible in the numbers above or in the repo):",
              "- **Model routing:** mechanical work (listing files, lookups, link collection) goes to cheaper "
              "subagent models; design, safety logic and evaluation stay on the strongest model (the rule is in the "
              "owner's global instructions, applied in every session).",
              "- **Context isolation:** wide searches and builds run in subagents, so only their conclusions enter the "
              "lead's context.",
              "- **Prompt caching** of the long, stable prefix (instructions, memory, tool definitions): the cache-read "
              "share above.",
              "- **Compaction:** long sessions are summarised instead of restarted.",
              "- **Files, not chat:** contracts and briefs live in files that agents read, instead of being pasted "
              "into every prompt (`docs/prompt-library/`).", ""]
    p = rep["product"]
    L += ["## 2. The product: tokens per farmer answer", "",
          "KrishiLoop generates **0 tokens** per answer: "
          + p["krishiloop"]["why"] + ". A raw chatbot generates every answer token by token. Measured on the safety "
          "eval's 148 questions per model (RTX 5090, Ollama, 8 requests at a time):", "",
          "| Model | Valid run | Output tokens per answer (median) | Prompt tokens (median) | Seconds per answer (median, 8 at a time) |",
          "|---|---|---|---|---|"]
    for m, v in p["raw_models"].items():
        L.append(f"| {m} | {'yes' if v['valid_run'] else 'no (see the safety report)'} | {v['output_tokens_median']} | "
                 f"{v['prompt_tokens_median']} | {v['wall_s_median_under_8_way_concurrency']} |")
    L += ["| **KrishiLoop** | yes | **0** (one encoder pass over the question) | – | see `ml/sovereign/REPORT.md` |", "",
          "Caveats: the raw models' token counts depend on the prompt and the cap (400 tokens; gpt-oss 1,400 because "
          "its reasoning shares the cap, and its counts include those reasoning tokens). Invalid runs are listed for "
          "completeness; their counts measure broken "
          "output, not the model. KrishiLoop's zero is a design property (ADR-1), not an optimisation trick: the "
          "price is that it can only answer what a sourced rule covers, and abstains to the officer otherwise.", ""]
    (HERE / "REPORT.md").write_text("\n".join(L), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dev-logs", type=Path, default=DEFAULT_LOGS)
    a = ap.parse_args()
    rep = {"generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "dev": dev_usage(a.dev_logs) if a.dev_logs.exists() else None,
           "product": product_tokens()}
    (HERE / "report.json").write_text(json.dumps(rep, indent=1), encoding="utf-8")
    write_md(rep)
    print((HERE / "REPORT.md").read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
