# kljob: dedup -> manifest -> text embeddings -> RQ1 frozen (re-runnable as more datasets land).
# Progress: F:\krishiloop-5090\jobs\research-build\run.log ; results in F:\krishiloop-5090\results\research
# Extra arguments (e.g. '--boot' '200' or '--no-rq1') are passed through to kl_research.build.
$ErrorActionPreference = 'Continue'
$env:HF_HOME = 'F:\krishiloop-5090\models\hf'
$env:PYTHONUTF8 = '1'
$env:KL_LOG = 'F:\krishiloop-5090\jobs\research-build\run.log'
$env:OMP_NUM_THREADS = '8'
$py = 'F:\krishiloop-5090\venvs\research\Scripts\python.exe'
$r = 'F:\krishiloop-5090\scripts\research'
$log = 'F:\krishiloop-5090\jobs\research-build\py.log'
$a = @('-I', '-u', "$r\run_module.py", 'kl_research.build', $r, 'F:\krishiloop-5090\data\benchmark', 'F:\krishiloop-5090\features', 'F:\krishiloop-5090\results\research') + $args
$p = Start-Process -FilePath $py -ArgumentList ($a | ForEach-Object { '"' + $_ + '"' }) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
"python exit: $($p.ExitCode)"
