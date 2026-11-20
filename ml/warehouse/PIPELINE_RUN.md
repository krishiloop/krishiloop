# Pipeline run

Written by `tools/pipeline_flow.py` (Prefect flow `krishiloop_data_pipeline`). Run by hand; this is the nightly data refresh.

- Flow run name: `icy-coucal`
- Started (UTC): 2026-11-20 14:29:16
- Result: all steps completed
- Total duration: 37.4 s

| Task | State | Duration (s) |
|---|---|---|
| validate_contracts | Completed | 3.1 |
| check_quotes | Completed | 0.4 |
| warehouse | Completed | 5.7 |
| pytest_warehouse_graph | Completed | 27.7 |
