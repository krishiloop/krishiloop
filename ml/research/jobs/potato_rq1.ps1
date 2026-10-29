# kljob: rebuild the manifest (adds datasets that landed since the main RQ1 run, e.g. Tanzania potato) and run RQ1 for
# the potato folds only; merged with the main run afterwards (`kl_research.rq1 merge`).
$ErrorActionPreference = 'Continue'
& 'F:\krishiloop-5090\scripts\research\jobs\build_run.ps1' '--no-rq1'
$py = 'F:\krishiloop-5090\venvs\research\Scripts\python.exe'
$r = 'F:\krishiloop-5090\scripts\research'
$env:PYTHONUTF8 = '1'
$env:KL_LOG = 'F:\krishiloop-5090\jobs\research-build\rq1_potato.log'
$a = @('-I', '-u', "$r\run_module.py", 'kl_research.rq1', 'F:\krishiloop-5090\data\benchmark', 'F:\krishiloop-5090\features', 'F:\krishiloop-5090\results\research\rq1_potato.json', '--backbones', 'bioclip2,dinov2_b,siglip2_b16,dinov2_l,pe_core_l,eva02_l', '--boot', '1000', '--crops', 'potato')
$p = Start-Process -FilePath $py -ArgumentList ($a | ForEach-Object { '"' + $_ + '"' }) -NoNewWindow -Wait -PassThru -RedirectStandardOutput 'F:\krishiloop-5090\jobs\research-build\rq1_potato.out' -RedirectStandardError 'F:\krishiloop-5090\jobs\research-build\rq1_potato.err'
"rq1 potato exit: $($p.ExitCode)"
