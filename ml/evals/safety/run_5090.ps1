# Safety eval: raw-model runs on the NBTC RTX 5090. Started ONLY through the approved job runner:
#   powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\kljob.ps1 -Name safety-raw -Script F:\krishiloop-5090\scripts\safety\run_5090.ps1
# Status: same with -Status. Resumable: rerunning skips (item, sample) pairs already written.
# After -Stop, also run scripts\safety\find_safety_procs.ps1 -Kill: stopping the task does not end its python child.
# Each model runs every pass as soon as its download finishes, then is unloaded (one model on the GPU at a time).
$ErrorActionPreference = 'Continue'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
$env:HF_HOME = 'F:\krishiloop-5090\models\hf'
$py = 'F:\krishiloop-5090\venvs\safety\Scripts\python.exe'
$s = 'F:\krishiloop-5090\scripts\safety'
$w = 'F:\krishiloop-5090\work\safety'
& $py "$s\run_raw.py" --questions "$w\questions.jsonl" --questions "$w\questions_sw.jsonl" --out "$w\runs\raw" --passes main,lat1,safeprompt,nosys,deftemp,t07x3 --concurrency 8 --wait-hours 10
