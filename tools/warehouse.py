"""Data warehouse: export KrishiLoop's real data to Parquet, then run DuckDB SQL over the Parquet files.

    .venv/Scripts/python.exe -X utf8 tools/warehouse.py            # export + report, one command

Tables (data_warehouse/*.parquet, gitignored): rules (rules/registry), receipts and recalls (trust stores under
data/trust, when present), safety_runs (ml/evals/safety/runs/scored*.jsonl), ask_eval (ml/ask/eval_report.json),
sightings (apps/web/src/data/map/sightings.json). Then SQL over those files writes ml/warehouse/REPORT.md and
report.json. The report is plain counts; the numbers come only from the files above and are deterministic for the
same inputs. Receipt and recall counts depend on the local trust store, which is not in git.

After the SQL report it also draws two Vega-Lite charts (altair, rendered to SVG by vl-convert-python; pins in
requirements-ml.txt): ml/warehouse/sightings_per_country.svg and rules_per_pack.svg. Both come only from the
deterministic counts (never receipts). If altair or vl-convert is not installed the chart step is skipped with a note.

Lakehouse: every Parquet table is also committed as a Delta Lake table (delta-rs, `deltalake` in requirements-ml.txt)
under data_warehouse/delta/<table>/: ACID commits, schema enforcement and time travel (each run is a new table
version; `DeltaTable(path, version=0)` reads the first). The report lists the rows read back from each Delta table.
If deltalake is not installed this step is skipped with a note.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import yaml

ROOT = Path(__file__).resolve().parents[1]


@dataclass
class Sources:
    registry: Path = ROOT / "rules" / "registry"
    trust: Path = ROOT / "data" / "trust"
    safety_runs: tuple = (ROOT / "ml" / "evals" / "safety" / "runs" / "scored.jsonl",
                          ROOT / "ml" / "evals" / "safety" / "runs" / "scored_v2.jsonl")
    ask_eval: Path = ROOT / "ml" / "ask" / "eval_report.json"
    sightings: Path = ROOT / "apps" / "web" / "src" / "data" / "map" / "sightings.json"
    out_dir: Path = ROOT / "data_warehouse"
    report_dir: Path = ROOT / "ml" / "warehouse"


S, I, B, F = pa.string(), pa.int64(), pa.bool_(), pa.float64()
SCHEMAS = {
    "rules": pa.schema([("rule_id", S), ("version", I), ("pack_id", S), ("crop", S), ("kind", S), ("traffic_light", S),
                        ("review_level", S), ("doc_id", S), ("page", I), ("quote_sha256", S)]),
    "receipts": pa.schema([("credential_id", S), ("receipt_id", S), ("store", S), ("created_at", S), ("rule_id", S),
                           ("rule_version", I), ("confidence", S)]),
    "recalls": pa.schema([("store", S), ("rule_id", S), ("version", I), ("at", S), ("reason", S), ("actor", S)]),
    "safety_runs": pa.schema([("run", S), ("item_id", S), ("category", S), ("lang", S), ("model", S), ("outcome", S),
                              ("gives_dose", B), ("ungrounded_dose", B), ("names_brand", B), ("refers_to_officer", B),
                              ("declines", B)]),
    "ask_eval": pa.schema([("mode", S), ("split", S), ("items", I), ("accuracy_at_1", F), ("wrong_answers", I),
                           ("coverage", F), ("outcome_accuracy", F)]),
    "sightings": pa.schema([("country", S), ("taxon", S), ("total", I)]),
}


def _rules(src: Sources) -> list[dict]:
    rows = []
    if not src.registry.is_dir():
        return rows
    for path in sorted(src.registry.glob("*/*.yaml")):
        r = yaml.safe_load(path.read_text(encoding="utf-8"))
        srcs = r.get("sources") or [{}]
        rows.append({"rule_id": r["rule_id"], "version": r["version"], "pack_id": r.get("pack_id") or path.parent.name,
                     "crop": r.get("crop"), "kind": (r.get("action") or {}).get("kind"),
                     "traffic_light": (r.get("action") or {}).get("traffic_light"),
                     "review_level": (r.get("review") or {}).get("level"), "doc_id": srcs[0].get("doc_id"),
                     "page": srcs[0].get("page"), "quote_sha256": srcs[0].get("quote_sha256")})
    return rows


def _trust(src: Sources) -> tuple[list[dict], list[dict]]:
    receipts, recalls = [], []
    if not src.trust.is_dir():
        return receipts, recalls
    for store in sorted(p for p in src.trust.iterdir() if p.is_dir()):
        state = store / "state.json"
        if state.exists():
            for key, v in (json.loads(state.read_text(encoding="utf-8")).get("recalls") or {}).items():
                rid, _, ver = key.rpartition("@")
                recalls.append({"store": store.name, "rule_id": rid, "version": int(ver), "at": v.get("at"),
                                "reason": v.get("reason"), "actor": v.get("actor")})
        for f in sorted((store / "creds").glob("*.json")):
            try:
                c = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if "AdviceReceiptCredential" not in c.get("type", []):
                continue
            s = c.get("credentialSubject") or {}
            for ref in s.get("rule_refs") or []:
                receipts.append({"credential_id": c["id"], "receipt_id": s.get("receipt_id"), "store": store.name,
                                 "created_at": s.get("created_at"), "rule_id": ref["rule_id"],
                                 "rule_version": ref["version"], "confidence": (s.get("confidence") or {}).get("level")})
    return receipts, recalls


def _safety(src: Sources) -> list[dict]:
    rows = []
    for path in src.safety_runs:
        if not Path(path).exists():
            continue
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            rows.append({"run": Path(path).stem, "item_id": r.get("item_id"), "category": r.get("category"),
                         "lang": r.get("lang"), "model": r.get("model"), "outcome": r.get("outcome"),
                         **{k: (None if r.get(k) is None else bool(r[k]))
                            for k in ("gives_dose", "ungrounded_dose", "names_brand", "refers_to_officer", "declines")}})
    return rows


def _ask_eval(src: Sources) -> list[dict]:
    if not src.ask_eval.exists():
        return []
    rep, rows = json.loads(src.ask_eval.read_text(encoding="utf-8")), []
    for mode, m in (rep.get("modes") or {}).items():
        if not isinstance(m, dict) or not m.get("run"):
            continue
        for split, key in (("test", "test"), ("dev", "dev (threshold fitted here)")):
            x = m.get(key)
            if isinstance(x, dict):
                rows.append({"mode": mode, "split": split, "items": x.get("items"), "accuracy_at_1": x.get("accuracy@1"),
                             "wrong_answers": x.get("wrong_answers"), "coverage": x.get("coverage"),
                             "outcome_accuracy": x.get("outcome_accuracy")})
    return rows


def _sightings(src: Sources) -> list[dict]:
    if not src.sightings.exists():
        return []
    d = json.loads(src.sightings.read_text(encoding="utf-8"))
    return [{"country": c, "taxon": t, "total": x.get("total")}
            for c, v in (d.get("countries") or {}).items() for t, x in (v.get("taxa") or {}).items()]


def export(src: Sources | None = None) -> dict[str, int]:
    """Write one Parquet file per table under src.out_dir; returns row counts."""
    src = src or Sources()
    src.out_dir.mkdir(parents=True, exist_ok=True)
    receipts, recalls = _trust(src)
    data = {"rules": _rules(src), "receipts": receipts, "recalls": recalls, "safety_runs": _safety(src),
            "ask_eval": _ask_eval(src), "sightings": _sightings(src)}
    for name, rows in data.items():
        pq.write_table(pa.Table.from_pylist(rows, schema=SCHEMAS[name]), src.out_dir / f"{name}.parquet")
    return {name: len(rows) for name, rows in data.items()}


QUERIES = {
    "rules_per_pack": "SELECT pack_id, count(*) AS rules FROM rules GROUP BY 1 ORDER BY 1",
    "receipts_per_rule": """SELECT r.rule_id, r.version, count(DISTINCT x.credential_id) AS receipts
                            FROM rules r LEFT JOIN receipts x ON x.rule_id = r.rule_id AND x.rule_version = r.version
                            GROUP BY 1, 2 HAVING receipts > 0 ORDER BY receipts DESC, r.rule_id""",
    "recalls": "SELECT rule_id, version, actor, reason FROM recalls ORDER BY \"at\", rule_id",
    "safety_outcomes_per_model": """SELECT run, model, count(*) AS rows,
                                    count_if(gives_dose) AS gives_dose, count_if(ungrounded_dose) AS ungrounded_dose,
                                    count_if(names_brand) AS names_brand, count_if(refers_to_officer) AS refers_to_officer,
                                    count_if(outcome = 'answer') AS answered, count_if(outcome = 'abstained') AS abstained
                                    FROM safety_runs GROUP BY 1, 2 ORDER BY 1, 2""",
    "ask_eval": "SELECT mode, split, items, accuracy_at_1, wrong_answers, coverage FROM ask_eval ORDER BY mode, split",
    "sightings_per_country": "SELECT country, sum(total) AS sightings FROM sightings GROUP BY 1 ORDER BY 2 DESC, 1",
}


def query(out_dir: Path, sql: str) -> list[dict]:
    """Run SQL over the Parquet files in out_dir (each file is a view named after it)."""
    con = duckdb.connect()
    try:
        for f in sorted(Path(out_dir).glob("*.parquet")):
            path = f.as_posix().replace("'", "''")
            con.execute(f"CREATE VIEW {f.stem} AS SELECT * FROM read_parquet('{path}')")
        cur = con.execute(sql)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        con.close()


def _md_table(rows: list[dict]) -> str:
    if not rows:
        return "_no rows_\n"
    cols = list(rows[0])
    body = ["| " + " | ".join(str(r[c]) if r[c] is not None else "" for c in cols) + " |" for r in rows]
    return "\n".join(["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols), *body]) + "\n"


TITLES = {"rules_per_pack": "Rules per pack", "receipts_per_rule": "Receipts per rule (rules with at least one receipt)",
          "recalls": "Recalls", "safety_outcomes_per_model": "Safety evaluation per model",
          "ask_eval": "Ask router evaluation (synthetic questions)", "sightings_per_country": "GBIF sightings per country"}


def charts(results: dict, report_dir: Path) -> list[str]:
    """Write two Vega-Lite charts as SVG (altair + vl_convert). Returns the file names written; [] if the libraries are missing."""
    try:
        import altair as alt
        import vl_convert as vlc
    except ImportError:
        print("note: altair / vl-convert-python not installed, skipping the Vega-Lite charts (see requirements-ml.txt)")
        return []

    def bars(rows: list[dict], cat: str, val: str, title: str, label: str) -> "alt.Chart":
        return (alt.Chart(alt.Data(values=rows), title=title)
                .mark_bar(color="#2f5a35", cornerRadiusEnd=3)
                .encode(y=alt.Y(f"{cat}:N", sort="-x", title=None), x=alt.X(f"{val}:Q", title=label),
                        tooltip=[f"{cat}:N", f"{val}:Q"])
                .properties(width=420, height=alt.Step(26)))

    specs = {
        "sightings_per_country.svg": bars(results["sightings_per_country"], "country", "sightings",
                                          "GBIF sightings per country (DuckDB SQL over Parquet)", "sightings"),
        "rules_per_pack.svg": bars(results["rules_per_pack"], "pack_id", "rules", "Rules per pack", "rules"),
    }
    written = []
    for name, chart in specs.items():
        (report_dir / name).write_text(vlc.vegalite_to_svg(chart.to_dict()), encoding="utf-8")
        written.append(name)
    return written


def lakehouse(out_dir: Path) -> dict[str, dict] | None:
    """Commit each Parquet table in out_dir as a Delta Lake table under out_dir/delta/<table>, then read it back.
    Returns {table: {"rows": rows read back from Delta, "version": the table's latest version}}; None without deltalake."""
    try:
        from deltalake import DeltaTable, write_deltalake
    except ImportError:
        print("note: deltalake not installed, skipping the Delta Lake tables (see requirements-ml.txt)")
        return None
    back = {}
    for f in sorted(Path(out_dir).glob("*.parquet")):
        path = str(Path(out_dir) / "delta" / f.stem)
        write_deltalake(path, pq.read_table(f), mode="overwrite", schema_mode="overwrite")
        dt = DeltaTable(path)
        back[f.stem] = {"rows": dt.to_pyarrow_table().num_rows, "version": dt.version()}
    return back


def report(src: Sources | None = None, counts: dict | None = None, lake: dict | None = None) -> dict:
    src = src or Sources()
    results = {name: query(src.out_dir, sql) for name, sql in QUERIES.items()}
    src.report_dir.mkdir(parents=True, exist_ok=True)
    out = {"tables": counts or {}, "results": results}
    (src.report_dir / "report.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    drawn = charts(results, src.report_dir)
    md = ["# Warehouse report", "",
          "Generated by `tools/warehouse.py` (DuckDB SQL over Parquet files in `data_warehouse/`). Counts only, from the "
          "repo's own files. Receipt and recall rows come from the local trust store (`data/trust`, not in git), so they "
          "differ per machine. The safety and Ask evaluations are the team's synthetic sets; read their own reports for "
          "caveats.", "", "Rows exported: " + ", ".join(f"{k} {v}" for k, v in (counts or {}).items()), ""]
    for name in QUERIES:
        md += [f"## {TITLES[name]}", ""]
        if f"{name}.svg" in drawn:
            md += [f"![{TITLES[name]}, Vega-Lite chart]({name}.svg)", ""]
        md += [_md_table(results[name])]
    if lake:   # rows only: the version number grows with every run on a machine, so it stays out of the report
        md += ["## Lakehouse: the same tables as Delta Lake tables", "",
               "Each table is also committed as a Delta Lake table (delta-rs) under `data_warehouse/delta/`, then read back.",
               "", _md_table([{"table": k, "rows_read_back": v["rows"]} for k, v in lake.items()])]
    (src.report_dir / "REPORT.md").write_text("\n".join(md), encoding="utf-8")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", type=Path, help="Parquet folder (default data_warehouse/)")
    ap.add_argument("--report", type=Path, help="report folder (default ml/warehouse/)")
    a = ap.parse_args()
    src = Sources(**{k: v for k, v in (("out_dir", a.out), ("report_dir", a.report)) if v})
    counts = export(src)
    lake = lakehouse(src.out_dir)
    report(src, counts, lake)
    print("exported:", counts)
    if lake:
        print("delta lake:", {k: f"{v['rows']} rows, v{v['version']}" for k, v in lake.items()})
    print("report:", src.report_dir / "REPORT.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
