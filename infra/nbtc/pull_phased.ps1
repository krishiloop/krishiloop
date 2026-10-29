# Phased model downloads, so the lab's ~10 MB/s link is shared fairly:
#   1) gpt-oss:20b first (the safety evaluation starts on it),
#   2) then 75 minutes with no model downloads (the benchmark datasets and the voice models get the link),
#   3) then the other six models. Present models are skipped; each pull retries (Ollama resumes partial blobs).
$env:OLLAMA_HOST = '127.0.0.1:11434'
$ollama = 'C:\Users\User\AppData\Local\Programs\Ollama\ollama.exe'
foreach ($i in 1..60) { try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:11434/api/version -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 2 } }
function Have($m) { $list = & $ollama list 2>$null; return [bool]($list | Select-String -SimpleMatch ($m + ' ')) }
function Pull($m) {
  foreach ($try in 1..4) {
    if (Have $m) { Write-Output "=== $m present"; return }
    $t0 = Get-Date
    Write-Output "=== pulling $m (attempt $try)"
    & $ollama pull $m 2>&1 | Select-Object -Last 1
    Write-Output ("=== {0} attempt {1} ended after {2:N0} s" -f $m, $try, ((Get-Date) - $t0).TotalSeconds)
    if (-not (Have $m)) { Start-Sleep -Seconds 10 }
  }
}
Pull 'gpt-oss:20b'
$until = (Get-Date).AddMinutes(75)
Write-Output ("=== link yielded to datasets and voice until {0:HH:mm}" -f $until)
Start-Sleep -Seconds 4500
foreach ($m in 'gemma4:26b', 'qwen3:30b', 'mistral-small3.2:24b', 'phi4:14b', 'gemma4:e4b', 'qwen3-vl:8b') { Pull $m }
& $ollama list
