# Progress of the safety-eval job on the 5090 (read-only). Copy to F:\krishiloop-5090\scripts\safety\ and run:
#   ssh -o BatchMode=yes nbtc5090 "powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\safety\status_5090.ps1"
$w = 'F:\krishiloop-5090\work\safety\runs\raw'
"--- time: $(Get-Date -Format s)"
"--- models downloaded:"
try { (Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 10).models | ForEach-Object { "  $($_.name)  $([math]::Round($_.size/1GB,1)) GB" } } catch { "  ollama not answering" }
"--- loaded now:"
try { (Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/ps' -TimeoutSec 10).models | ForEach-Object { "  $($_.name) vram=$([math]::Round($_.size_vram/1GB,1)) GB" } } catch { }
"--- gpu: " + (nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader)
"--- partial downloads:"
Get-ChildItem 'F:\krishiloop-5090\models\ollama\blobs' -Filter '*-partial' -ErrorAction SilentlyContinue | ForEach-Object { "  $($_.Name.Substring(0,20))... $([math]::Round($_.Length/1GB,1)) GB (preallocated)" }
"--- answers written (lines per file):"
Get-ChildItem $w -Recurse -Filter '*.jsonl' -ErrorAction SilentlyContinue | ForEach-Object { "  $($_.Directory.Name)/$($_.Name): $((Get-Content $_.FullName | Measure-Object -Line).Lines)" }
"--- harness log (tail):"
if (Test-Path "$w\run.log") { Get-Content "$w\run.log" -Tail 12 }
"--- job:"
powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\kljob.ps1 -Name safety-raw -Status | Select-Object -First 1
