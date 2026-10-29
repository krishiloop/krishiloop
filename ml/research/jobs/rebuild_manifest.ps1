# kljob: rebuild the manifest only (dedup, manifest, text embeddings; no RQ1) and re-run the overlap check.
& 'F:\krishiloop-5090\scripts\research\jobs\build_run.ps1' '--no-rq1'
$py = 'F:\krishiloop-5090\venvs\research\Scripts\python.exe'
$env:PYTHONUTF8 = '1'
$o = Start-Process -FilePath $py -ArgumentList @('-I', '-u', '"F:\krishiloop-5090\scripts\research\run_module.py"', 'kl_research.overlap', 'F:\krishiloop-5090\data\benchmark', 'F:\krishiloop-5090\features') -NoNewWindow -Wait -PassThru -RedirectStandardOutput 'F:\krishiloop-5090\jobs\research-build\overlap.out' -RedirectStandardError 'F:\krishiloop-5090\jobs\research-build\overlap.err'
"overlap exit: $($o.ExitCode)"
