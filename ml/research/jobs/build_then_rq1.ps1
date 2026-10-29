# kljob: build (dedup, manifest, text embeddings) then RQ1 for all backbone groups in parallel, then merge.
# Progress: F:\krishiloop-5090\jobs\research-build\run.log (build) and research-rq1-g*\run.log
$ErrorActionPreference = 'Continue'
& 'F:\krishiloop-5090\scripts\research\jobs\build_run.ps1' '--no-rq1'
$py = 'F:\krishiloop-5090\venvs\research\Scripts\python.exe'
$r = 'F:\krishiloop-5090\scripts\research'
$res = 'F:\krishiloop-5090\results\research'
$env:PYTHONUTF8 = '1'
# cross- and within-dataset check of perceptual matches against DINOv2-B (writes data\benchmark\overlap_report.json)
$o = Start-Process -FilePath $py -ArgumentList @('-I', '-u', "`"$r\run_module.py`"", 'kl_research.overlap', 'F:\krishiloop-5090\data\benchmark', 'F:\krishiloop-5090\features') -NoNewWindow -Wait -PassThru -RedirectStandardOutput 'F:\krishiloop-5090\jobs\research-build\overlap.out' -RedirectStandardError 'F:\krishiloop-5090\jobs\research-build\overlap.err'
$env:OMP_NUM_THREADS = '4'; $env:OPENBLAS_NUM_THREADS = '4'; $env:MKL_NUM_THREADS = '4'
$groups = @{ g1 = 'bioclip2,dinov2_b'; g2 = 'siglip2_b16,dinov2_l'; g3 = 'pe_core_l,eva02_l,siglip2_so400m,dinov2_g,dinov3_b,dinov3_l' }
$procs = @()
foreach ($g in $groups.Keys) {
  $env:KL_LOG = "F:\krishiloop-5090\jobs\research-build\rq1_$g.log"
  $a = @('-I', '-u', "$r\run_module.py", 'kl_research.rq1', 'F:\krishiloop-5090\data\benchmark', 'F:\krishiloop-5090\features', "$res\rq1_$g.json", '--backbones', $groups[$g], '--boot', '1000')
  $procs += Start-Process -FilePath $py -ArgumentList ($a | ForEach-Object { '"' + $_ + '"' }) -NoNewWindow -PassThru -RedirectStandardOutput "F:\krishiloop-5090\jobs\research-build\rq1_$g.out" -RedirectStandardError "F:\krishiloop-5090\jobs\research-build\rq1_$g.err"
}
$procs | ForEach-Object { $_.WaitForExit() }
$env:KL_LOG = 'F:\krishiloop-5090\jobs\research-build\run.log'
$parts = @('g1','g2','g3') | ForEach-Object { "$res\rq1_$_.json" } | Where-Object { Test-Path $_ }
$a = @('-I', '-u', "$r\run_module.py", 'kl_research.rq1', 'merge', "$res\rq1_frozen.json") + $parts
$p = Start-Process -FilePath $py -ArgumentList ($a | ForEach-Object { '"' + $_ + '"' }) -NoNewWindow -Wait -PassThru -RedirectStandardOutput "F:\krishiloop-5090\jobs\research-build\merge.out" -RedirectStandardError "F:\krishiloop-5090\jobs\research-build\merge.err"
"merge exit: $($p.ExitCode)"
