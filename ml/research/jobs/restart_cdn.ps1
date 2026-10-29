powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\research\jobs\stop_fetch_cdn.ps1
Remove-Item F:\krishiloop-5090\data\raw\tz_potato\_LOCK -ErrorAction SilentlyContinue
Remove-Item F:\krishiloop-5090\data\raw\lk_rice_paddypulse\_LOCK -ErrorAction SilentlyContinue
powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\kljob.ps1 -Name research-fetch-cdn -Script F:\krishiloop-5090\scripts\research\jobs\fetch_cdn_run.ps1
