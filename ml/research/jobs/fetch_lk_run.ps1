# kljob: PaddyPulse-SLNR (Sri Lanka) from Zenodo, alone (Zenodo <= 8 connections), so it does not wait behind the
# CDN queue. Progress: F:\krishiloop-5090\jobs\research-fetch-lk\run.log
$ErrorActionPreference = 'Continue'
$env:PYTHONUTF8 = '1'
$env:KL_LOG = 'F:\krishiloop-5090\jobs\research-fetch-lk\run.log'
$env:KL_ZENODO_CONN = '8'
$env:KL_CDN_CONN = '1'
$env:KL_S3_CONN = '1'
$py = 'F:\krishiloop-5090\venvs\research\Scripts\python.exe'
$r = 'F:\krishiloop-5090\scripts\research'
$log = 'F:\krishiloop-5090\jobs\research-fetch-lk\py.log'
$a = @('-I', '-u', "$r\run_module.py", 'kl_research.fetch', 'run', "$r\configs\datasets.yaml", 'F:\krishiloop-5090\data\raw', '--parallel', '1', '--threads', '1', 'lk_rice_paddypulse')
$p = Start-Process -FilePath $py -ArgumentList ($a | ForEach-Object { '"' + $_ + '"' }) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
"python exit: $($p.ExitCode)"
