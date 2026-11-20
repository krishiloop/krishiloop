"""Warehouse: export a tiny temp dataset to Parquet and query it with DuckDB."""
import json
import sys
from pathlib import Path

import pyarrow.parquet as pq
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import warehouse as wh  # noqa: E402


def _tiny(tmp_path) -> wh.Sources:
    reg = tmp_path / "registry" / "pack-x"
    reg.mkdir(parents=True)
    for i, tl in ((1, "green"), (2, "amber")):
        (reg / f"R-XXX-00{i}.yaml").write_text(yaml.safe_dump({
            "rule_id": f"R-XXX-00{i}", "version": 1, "pack_id": "pack-x", "crop": "x",
            "action": {"kind": "practice", "traffic_light": tl}, "review": {"level": "pending"},
            "sources": [{"doc_id": "DOC-1", "page": 3, "quote_sha256": "ab" * 32}]}), encoding="utf-8")
    store = tmp_path / "trust" / "did_x"
    (store / "creds").mkdir(parents=True)
    (store / "state.json").write_text(json.dumps({"recalls": {"R-XXX-002@1": {"at": "2026-01-01T00:00:00Z", "reason": "t", "actor": "admin"}}}))
    for n in range(3):
        (store / "creds" / f"{n}.json").write_text(json.dumps({
            "id": f"urn:uuid:{n}", "type": ["VerifiableCredential", "AdviceReceiptCredential"],
            "credentialSubject": {"receipt_id": f"r{n}", "created_at": "2026-01-01T00:00:00Z", "confidence": {"level": "high"},
                                  "rule_refs": [{"rule_id": "R-XXX-001", "version": 1}]}}))
    runs = tmp_path / "scored.jsonl"
    runs.write_text("\n".join(json.dumps(r) for r in (
        {"item_id": "a", "model": "m1", "gives_dose": True, "ungrounded_dose": True},
        {"item_id": "b", "model": "m1", "gives_dose": False, "ungrounded_dose": False},
        {"item_id": "c", "model": "m2", "gives_dose": False, "refers_to_officer": True})), encoding="utf-8")
    sight = tmp_path / "sightings.json"
    sight.write_text(json.dumps({"countries": {"BD": {"taxa": {"faw": {"total": 5}, "bph": {"total": 7}}},
                                               "KE": {"taxa": {"faw": {"total": 2}}}}}))
    return wh.Sources(registry=tmp_path / "registry", trust=tmp_path / "trust", safety_runs=(runs,),
                      ask_eval=tmp_path / "missing.json", sightings=sight, out_dir=tmp_path / "wh", report_dir=tmp_path / "rep")


def test_export_writes_parquet_and_duckdb_answers_sql(tmp_path):
    src = _tiny(tmp_path)
    counts = wh.export(src)
    assert counts == {"rules": 2, "receipts": 3, "recalls": 1, "safety_runs": 3, "ask_eval": 0, "sightings": 3}
    assert pq.read_table(src.out_dir / "rules.parquet").num_rows == 2
    rows = wh.query(src.out_dir, "SELECT rule_id, count(DISTINCT credential_id) AS n FROM receipts GROUP BY 1")
    assert rows == [{"rule_id": "R-XXX-001", "n": 3}]
    per_model = wh.query(src.out_dir, "SELECT model, count_if(gives_dose) AS dose FROM safety_runs GROUP BY 1 ORDER BY 1")
    assert per_model == [{"model": "m1", "dose": 1}, {"model": "m2", "dose": 0}]


def test_report_files_are_written_and_reproducible(tmp_path):
    src = _tiny(tmp_path)
    counts = wh.export(src)
    first = wh.report(src, counts)
    md = (src.report_dir / "REPORT.md").read_text(encoding="utf-8")
    assert "| pack-x | 2 |" in md and "| BD | 12 |" in md and "| R-XXX-001 | 1 | 3 |" in md
    assert first["results"]["recalls"][0]["rule_id"] == "R-XXX-002"
    wh.export(src)
    assert wh.report(src, counts) == first and (src.report_dir / "REPORT.md").read_text(encoding="utf-8") == md
    assert json.loads((src.report_dir / "report.json").read_text(encoding="utf-8"))["tables"]["rules"] == 2


def test_report_draws_vega_lite_svgs_when_altair_is_installed(tmp_path):
    import pytest
    pytest.importorskip("altair")
    pytest.importorskip("vl_convert")
    src = _tiny(tmp_path)
    wh.report(src, wh.export(src))
    for name in ("sightings_per_country.svg", "rules_per_pack.svg"):
        assert (src.report_dir / name).read_text(encoding="utf-8").lstrip().startswith("<svg")
    assert "![Rules per pack" in (src.report_dir / "REPORT.md").read_text(encoding="utf-8")


def test_lakehouse_delta_tables_round_trip_and_keep_history(tmp_path):
    """Delta Lake (delta-rs): every Parquet table is committed as a Delta table, reads back with the same rows, and a
    second run is a new version while version 0 is still readable (time travel). Skipped without deltalake."""
    import pytest
    deltalake = pytest.importorskip("deltalake")
    src = _tiny(tmp_path)
    counts = wh.export(src)
    first = wh.lakehouse(src.out_dir)
    assert {k: v["rows"] for k, v in first.items()} == counts
    assert all(v["version"] == 0 for v in first.values())
    second = wh.lakehouse(src.out_dir)
    assert all(v["version"] == 1 for v in second.values())
    old = deltalake.DeltaTable(str(src.out_dir / "delta" / "rules"), version=0)
    assert old.to_pyarrow_table().num_rows == counts["rules"]
    wh.report(src, counts, second)
    md = (src.report_dir / "REPORT.md").read_text(encoding="utf-8")
    assert "## Lakehouse: the same tables as Delta Lake tables" in md and "| rules | 2 |" in md
