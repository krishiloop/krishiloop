# Stop the main research-fetch job and the python it started (processes do not die with the task on this PC).
# Matches only the main queue (its key list contains in_rice_sethy), never the CDN job.
powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\kljob.ps1 -Name research-fetch -Stop
Get-CimInstance Win32_Process -Filter "name='python.exe'" | Where-Object { $_.CommandLine -like '*kl_research.fetch*' -and $_.CommandLine -like '*in_rice_sethy*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "killed $($_.ProcessId)" }
