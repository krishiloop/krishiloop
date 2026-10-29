# Prints the last lines of every KrishiLoop job log (read-only).
param([int]$Lines = 6)
Get-ChildItem F:\krishiloop-5090\jobs -Directory | Sort-Object LastWriteTime -Descending | ForEach-Object {
  $log = Join-Path $_.FullName 'log.txt'
  $exit = Join-Path $_.FullName 'exit.txt'
  $state = if (Test-Path $exit) { 'exit=' + (Get-Content $exit -Raw).Trim() } else { 'running/none' }
  $age = if (Test-Path $log) { '{0:HH:mm}' -f (Get-Item $log).LastWriteTime } else { '-' }
  Write-Output ("##### {0}  [{1}]  log@{2}" -f $_.Name, $state, $age)
  if (Test-Path $log) { Get-Content $log -Tail $Lines | ForEach-Object { if ($_.Length -gt 220) { $_.Substring(0,220) + '…' } else { $_ } } }
}
$f = Get-PSDrive F; Write-Output ("F: free {0:N0} GB" -f ($f.Free/1GB))
$net = Get-NetAdapterStatistics -ErrorAction SilentlyContinue | Select-Object -First 3 Name, ReceivedBytes
$net | ForEach-Object { Write-Output ("{0}: rx {1:N1} GB" -f $_.Name, ($_.ReceivedBytes/1GB)) }
