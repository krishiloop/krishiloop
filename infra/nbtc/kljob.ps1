<#
  kljob.ps1: run one KrishiLoop job on this PC so it outlives the SSH session.
  Scope (approved by the owner on 29 Oct 2026): one-shot scheduled tasks, only for KrishiLoop jobs whose script lives
  in F:\krishiloop-5090, nothing reachable from the network (servers bind 127.0.0.1), and every task deletes itself
  when its job ends. Runs with standard (limited) rights, as the SSH user, no password stored (S4U).

    start:  powershell -File F:\krishiloop-5090\scripts\kljob.ps1 -Name eval -Script F:\krishiloop-5090\scripts\safety\run.ps1
    status: powershell -File F:\krishiloop-5090\scripts\kljob.ps1 -Name eval -Status
    stop:   powershell -File F:\krishiloop-5090\scripts\kljob.ps1 -Name eval -Stop
    list:   powershell -File F:\krishiloop-5090\scripts\kljob.ps1 -List
  Log: F:\krishiloop-5090\jobs\<name>\log.txt   exit code: ...\exit.txt
#>
param([string]$Name, [string]$Script, [switch]$Status, [switch]$Stop, [switch]$List)
$ErrorActionPreference = 'Stop'
$work = 'F:\krishiloop-5090'
$root = Join-Path $work 'jobs'

if ($List) {
  Get-ScheduledTask -TaskName 'kl-*' -ErrorAction SilentlyContinue | Select-Object TaskName, State | Format-Table -AutoSize | Out-String
  return
}
if (-not ($Name -match '^[a-z0-9][a-z0-9-]{0,30}$')) { throw 'Name: lowercase letters, digits and dashes only' }
$dir = Join-Path $root $Name
$task = "kl-$Name"

if ($Status) {
  $t = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  $state = if ($t) { $t.State } else { 'removed' }
  $exit = if (Test-Path "$dir\exit.txt") { (Get-Content "$dir\exit.txt" -Raw).Trim() } else { '-' }
  "task: $state   exit: $exit"
  if (Test-Path "$dir\log.txt") { Get-Content "$dir\log.txt" -Tail 30 }
  return
}
if ($Stop) {
  Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  "stopped and removed $task"
  return
}

# only scripts inside the KrishiLoop work folder
$full = [IO.Path]::GetFullPath($Script)
if (-not ($full.StartsWith("$work\", [StringComparison]::OrdinalIgnoreCase)) -or -not (Test-Path $full)) { throw "Script must exist inside $work" }
if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) { throw "$task already exists (running?). Use -Status or -Stop." }

New-Item -ItemType Directory -Force $dir | Out-Null
Remove-Item "$dir\exit.txt" -ErrorAction SilentlyContinue
$wrapper = @"
`$ErrorActionPreference = 'Continue'
Start-Transcript -Path '$dir\log.txt' -Append | Out-Null
Write-Output ("=== {0} start {1}" -f '$task', (Get-Date -Format s))
try { & '$full'; `$code = if (`$LASTEXITCODE) { `$LASTEXITCODE } else { 0 } } catch { Write-Output "ERROR: `$_"; `$code = 1 }
Write-Output ("=== {0} end {1} exit {2}" -f '$task', (Get-Date -Format s), `$code)
Stop-Transcript | Out-Null
Set-Content -Path '$dir\exit.txt' -Value `$code
# one-shot: the task removes itself when the job ends
schtasks.exe /Delete /TN '$task' /F | Out-Null
"@
Set-Content -Path "$dir\wrapper.ps1" -Value $wrapper -Encoding utf8
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$dir\wrapper.ps1`"" -WorkingDirectory $work
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 3) -MultipleInstances IgnoreNew -Priority 5
Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Settings $settings -Description 'KrishiLoop one-shot job (self-removing); see F:\krishiloop-5090\jobs' | Out-Null
Start-ScheduledTask -TaskName $task
"started $task -> $dir\log.txt"
