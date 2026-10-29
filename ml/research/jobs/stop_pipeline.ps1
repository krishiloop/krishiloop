# Stop the research-pipeline job, its python and any DataLoader workers it spawned.
powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\kljob.ps1 -Name research-pipeline -Stop
$main = Get-CimInstance Win32_Process -Filter "name='python.exe'" | Where-Object { $_.CommandLine -like '*kl_research.pipeline*' }
$ids = @($main | ForEach-Object { $_.ProcessId })
$kids = Get-CimInstance Win32_Process -Filter "name='python.exe'" | Where-Object { $ids -contains $_.ParentProcessId }
foreach ($p in @($kids) + @($main)) { if ($p) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; "killed $($p.ProcessId)" } }
