# kljob: resumable benchmark download. Per-host caps live in kl_research/fetch.py (S3 <= 24, Zenodo <= 8, CDNs <= 4),
# approved by the lead on 29 Oct 2026. Queue order = protocol value per byte: rice core first, with the three small
# Bangladeshi partner sets (potato, bean, maize; 110 MB together) moved up because each unlocks a cross-country pair.
# Progress: F:\krishiloop-5090\jobs\research-fetch\py.log (python stdout) and run.log
$ErrorActionPreference = 'Continue'
$env:HF_HOME = 'F:\krishiloop-5090\models\hf'
$env:PYTHONUTF8 = '1'
$env:KL_LOG = 'F:\krishiloop-5090\jobs\research-fetch\run.log'
$py = 'F:\krishiloop-5090\venvs\research\Scripts\python.exe'
$r = 'F:\krishiloop-5090\scripts\research'
$log = 'F:\krishiloop-5090\jobs\research-fetch\py.log'
$keys = @('in_rice_sethy','bd_rice_netrokona','bd_potato_ctg','bd_bean_bldbd','bd_maize_mld','bd_rice_riceleafdiseasebd',
  'bd_rice_riceyleafdisease','bd_rice_dhanshomadhan','bd_rice_riceleafbd_rimi','bd_rice_daffodil','gh_ccmt','bd_tomato_jttr',
  'in_potato_wb','in_rice_sru_paddy','br_coffee_bracol','bd_wheat','bd_tea_tldbd','bd_banana_wfz','bd_lemon_bdlemonleaf',
  'bd_mango_mld24','bd_sugarcane','bd_banana_6yy','web_plantdoc','ec_coffee_rocole','bd_maize_seasonal','bd_guava_idgldd','bd_eggplant_pwv')
$a = @('-I', '-u', "$r\run_module.py", 'kl_research.fetch', 'run', "$r\configs\datasets.yaml", 'F:\krishiloop-5090\data\raw', '--parallel', '4', '--threads', '4') + $keys
$p = Start-Process -FilePath $py -ArgumentList ($a | ForEach-Object { '"' + $_ + '"' }) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
"python exit: $($p.ExitCode)"
