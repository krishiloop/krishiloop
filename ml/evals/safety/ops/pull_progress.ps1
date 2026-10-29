# Download progress of Ollama blobs in flight (read-only): sums the chunk files Ollama keeps next to each partial blob.
$b = 'F:\krishiloop-5090\models\ollama\blobs'
Get-ChildItem $b -Filter '*-partial' -ErrorAction SilentlyContinue | ForEach-Object {
  $name = $_.Name; $total = $_.Length; $done = 0; $last = $null
  Get-ChildItem $b -Filter "$name-*" | ForEach-Object {
    if (-not $last -or $_.LastWriteTime -gt $last) { $last = $_.LastWriteTime }
    try { $j = Get-Content $_.FullName -Raw | ConvertFrom-Json; $done += [int64]$j.Completed } catch {} }
  "{0}... {1:N1} of {2:N1} GB ({3:P0}), chunk files last written {4:T}" -f $name.Substring(7,12), ($done/1GB), ($total/1GB), ($(if ($total) { $done/$total } else { 0 })), $last
}
"time: $(Get-Date -Format s)"
