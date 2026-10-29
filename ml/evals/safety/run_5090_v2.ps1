# Safety eval v2 (held-out set, frozen in V2_FREEZE.md): raw-model runs on the NBTC RTX 5090.
# Started ONLY through the approved job runner (see ops/queue_v2_5090.sh):
#   powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\kljob.ps1 -Name safety-raw-v2 -Script F:\krishiloop-5090\scripts\safety_v2\run_5090_v2.ps1
# 1. Waits (up to 16 h) until the v1 job has ended: no scheduled task kl-safety-raw and no python process writing to
#    work\safety\runs\raw. It never touches that job.
# 2. Runs the v2 questions (460: 200 en, 200 bn, 60 sw) on all 7 Ollama models with run_raw.py (same harness as v1):
#    main (neutral prompt, T 0.2, seed 7), safeprompt (the safety prompt), t07x3 (3 samples at T 0.7, seeds 101-103).
#    One model on the GPU at a time (run_raw.py unloads each model when its passes are done). Resumable: a rerun skips
#    (item, sample) pairs already written. Raw answers stay on the 5090 and, once copied, in the git-ignored
#    ml/evals/safety/runs/raw_v2/.
$ErrorActionPreference = 'Continue'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
$env:HF_HOME = 'F:\krishiloop-5090\models\hf'
$py = 'F:\krishiloop-5090\venvs\safety\Scripts\python.exe'
$s = 'F:\krishiloop-5090\scripts\safety_v2'
$w = 'F:\krishiloop-5090\work\safety_v2'
$deadline = (Get-Date).AddHours(16)
while ($true) {
  $task = Get-ScheduledTask -TaskName 'kl-safety-raw' -ErrorAction SilentlyContinue
  $procs = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
             Where-Object { $_.CommandLine -like '*\work\safety\runs\raw*' })
  if (-not $task -and $procs.Count -eq 0) { break }
  if ((Get-Date) -ge $deadline) { Write-Output 'gave up: kl-safety-raw still running after 16 h'; exit 3 }
  Write-Output ('{0} waiting for kl-safety-raw to end (task present: {1}; its python processes: {2})' -f (Get-Date -Format s), [bool]$task, $procs.Count)
  Start-Sleep -Seconds 300
}
Write-Output ('{0} kl-safety-raw has ended; starting v2' -f (Get-Date -Format s))
& $py "$s\run_raw.py" --questions "$w\questions_v2.jsonl" --questions "$w\questions_v2_sw.jsonl" --out "$w\runs\raw" --passes main,safeprompt,t07x3 --concurrency 8 --wait-hours 2
exit $LASTEXITCODE
