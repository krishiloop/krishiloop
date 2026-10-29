# Pull the open-weight models for KrishiLoop's local experiments into the work folder (via the 127.0.0.1 server).
# Chosen to fit one RTX 5090 (32 GB) at their default quantisation. Resumable: models already present are skipped,
# and each pull is retried up to 4 times (a server restart or a network drop interrupts a pull; Ollama resumes blobs).
$env:OLLAMA_HOST = '127.0.0.1:11434'
$ollama = 'C:\Users\User\AppData\Local\Programs\Ollama\ollama.exe'
foreach ($i in 1..60) { try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:11434/api/version -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 2 } }
$models = @(
  'gpt-oss:20b',        # OpenAI open-weight (Apache-2.0): the self-hosted LLM candidate
  'gemma4:26b',         # Google Gemma 4 (MoE): the other self-hosted candidate, strong multilingual
  'qwen3:30b',          # Qwen3 30B-A3B (Apache-2.0): multilingual MoE
  'mistral-small3.2:24b',
  'phi4:14b',
  'gemma4:e4b',         # a phone-sized model: what an on-device assistant would answer
  'qwen3-vl:8b'         # vision-language: symptom description (second opinion only)
)
function Have($m) { $list = & $ollama list 2>$null; return [bool]($list | Select-String -SimpleMatch ($m + ' ')) }
foreach ($m in $models) {
  foreach ($try in 1..4) {
    if (Have $m) { Write-Output "=== $m present"; break }
    $t0 = Get-Date
    Write-Output "=== pulling $m (attempt $try)"
    & $ollama pull $m 2>&1 | Select-Object -Last 1
    Write-Output ("=== {0} attempt {1} ended after {2:N0} s (exit {3})" -f $m, $try, ((Get-Date) - $t0).TotalSeconds, $LASTEXITCODE)
    if (-not (Have $m)) { Start-Sleep -Seconds 10 }
  }
}
& $ollama list
