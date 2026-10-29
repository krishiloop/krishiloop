# kljob: prefetch backbone weights from the Hugging Face CDN (2 parallel ranges) into the HF cache, in pipeline order.
# Progress: F:\krishiloop-5090\jobs\research-models\run.log
$ErrorActionPreference = 'Continue'
$env:HF_HOME = 'F:\krishiloop-5090\models\hf'
$env:PYTHONUTF8 = '1'
$env:KL_LOG = 'F:\krishiloop-5090\jobs\research-models\run.log'
$env:KL_CDN_CONN = '2'
$py = 'F:\krishiloop-5090\venvs\research\Scripts\python.exe'
$r = 'F:\krishiloop-5090\scripts\research'
$log = 'F:\krishiloop-5090\jobs\research-models\py.log'
$a = @('-I', '-u', "$r\run_module.py", 'kl_research.prefetch_models', "$r\configs\backbones.yaml", 'siglip2_b16,dinov2_l,pe_core_l,eva02_l,siglip2_so400m,dinov2_g,dinov3_b,dinov3_l')
$p = Start-Process -FilePath $py -ArgumentList ($a | ForEach-Object { '"' + $_ + '"' }) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
"python exit: $($p.ExitCode)"
