# kljob: datasets served from fast CDNs (Hugging Face) or small Zenodo pulls, run apart from the S3 queue so they are
# not stuck behind it. Sequential (one dataset at a time): CDN <= 2 connections, Zenodo <= 8, so the job stays well
# below the shared link. Progress: F:\krishiloop-5090\jobs\research-fetch-cdn\run.log
$ErrorActionPreference = 'Continue'
$env:PYTHONUTF8 = '1'
$env:KL_LOG = 'F:\krishiloop-5090\jobs\research-fetch-cdn\run.log'
$env:KL_CDN_CONN = '2'
$env:KL_ZENODO_CONN = '8'
$env:KL_S3_CONN = '4'
$py = 'F:\krishiloop-5090\venvs\research\Scripts\python.exe'
$r = 'F:\krishiloop-5090\scripts\research'
$log = 'F:\krishiloop-5090\jobs\research-fetch-cdn\py.log'
$a = @('-I', '-u', "$r\run_module.py", 'kl_research.fetch', 'run', "$r\configs\datasets.yaml", 'F:\krishiloop-5090\data\raw', '--parallel', '1', '--threads', '2', 'ug_bean_ibean', 'tz_potato', 'lk_rice_paddypulse')
$p = Start-Process -FilePath $py -ArgumentList ($a | ForEach-Object { '"' + $_ + '"' }) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
"python exit: $($p.ExitCode)"
