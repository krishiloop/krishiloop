# start the voice service on 127.0.0.1, test it, stop it (service_test.py always kills it), then check for leftovers
param([string]$Asr = 'omni-ctc-1b', [string]$Tts = 'svara')
. F:\krishiloop-5090\scripts\voice\common.ps1
$used = [int](nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)
"GPU memory used before the service test: $used MiB"
if ($used -gt 21000) { "SKIP service test: the full voice stack needs ~10 GB and the GPU already has $used MiB in use"; return }
$env:VOICE_ASR = $Asr
$env:VOICE_TTS = $Tts
Run @("$V\service_test.py", '--out', "$W\service", '--fleurs-manifest', $FLEURS)
Start-Sleep -Seconds 2
$left = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'service\.py' }
if ($left) { $left | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "killed leftover $($_.ProcessId)" } } else { 'no leftover service process' }
