# kljob: scan landed datasets and extract every backbone as soon as each dataset lands (GPU), resumable.
# Progress: F:\krishiloop-5090\jobs\research-pipeline\run.log (python log), py.log.err (warnings)
$ErrorActionPreference = 'Continue'
$env:HF_HOME = 'F:\krishiloop-5090\models\hf'
$env:HF_HUB_DISABLE_XET = '1'
$env:PYTHONUTF8 = '1'
$env:KL_LOG = 'F:\krishiloop-5090\jobs\research-pipeline\run.log'
$py = 'F:\krishiloop-5090\venvs\research\Scripts\python.exe'
$r = 'F:\krishiloop-5090\scripts\research'
$log = 'F:\krishiloop-5090\jobs\research-pipeline\py.log'
$a = @('-I', '-u', "$r\run_module.py", 'kl_research.pipeline', "$r\configs", 'F:\krishiloop-5090\data\raw', 'F:\krishiloop-5090\data\benchmark', 'F:\krishiloop-5090\features', 'F:\krishiloop-5090\jobs\research-fetch')
$p = Start-Process -FilePath $py -ArgumentList ($a | ForEach-Object { '"' + $_ + '"' }) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
"python exit: $($p.ExitCode)"
