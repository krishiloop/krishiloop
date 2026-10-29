# Restart the main (S3) fetch queue with new code: stop it, clear the locks it held (not the CDN/LK jobs' locks), start.
powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\research\jobs\stop_fetch.ps1
Get-ChildItem F:\krishiloop-5090\data\raw -Directory | Where-Object { $_.Name -notin @('tz_potato','lk_rice_paddypulse') } | ForEach-Object {
  $l = Join-Path $_.FullName '_LOCK'; if (Test-Path $l) { Remove-Item $l; "cleared lock $($_.Name)" } }
powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\kljob.ps1 -Name research-fetch -Script F:\krishiloop-5090\scripts\research\jobs\fetch_run.ps1
