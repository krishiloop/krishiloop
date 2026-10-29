powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\kljob.ps1 -Name research-fetch-cdn -Stop
Get-CimInstance Win32_Process -Filter "name='python.exe'" | Where-Object { $_.CommandLine -like '*kl_research.fetch*' -and $_.CommandLine -like '*lk_rice_paddypulse*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "killed $($_.ProcessId)" }
