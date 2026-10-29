# kljob: wait until the feature pipeline has finished (its task disappears: every landed dataset has every backbone
# and the download queue has ended), then rebuild the manifest and re-run RQ1 for all backbones and domains.
# Safe to stop at any time (kljob -Name research-followup -Stop); nothing is lost.
$ErrorActionPreference = 'Continue'
while (Get-ScheduledTask -TaskName 'kl-research-pipeline' -ErrorAction SilentlyContinue) {
  "{0} pipeline still running; waiting" -f (Get-Date -Format s)
  Start-Sleep -Seconds 600
}
"{0} pipeline finished; rebuilding" -f (Get-Date -Format s)
& 'F:\krishiloop-5090\scripts\research\jobs\build_then_rq1.ps1'
