# kljob script: re-run the service test (first run failed: FastAPI could not resolve locally imported types
# under postponed annotations). Waits for the male-voice job so only one voice job uses the GPU.
. F:\krishiloop-5090\scripts\voice\common.ps1
while (Get-ScheduledTask -TaskName 'kl-voice-male' -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 10 }
Remove-Item "$W\service\service_test.json" -ErrorAction SilentlyContinue
. "$V\run_service_test.ps1"
