$ErrorActionPreference = 'SilentlyContinue'
"--- conda"
$conda = @("$env:USERPROFILE\miniforge3\Scripts\conda.exe", 'C:\ProgramData\miniforge3\Scripts\conda.exe') + (Get-ChildItem C:\Users\*\miniforge3\Scripts\conda.exe | ForEach-Object FullName) | Where-Object { Test-Path $_ } | Select-Object -First 1
"conda: $conda"
if ($conda) { & $conda env list }
"--- torch in existing envs"
foreach ($e in 'dl', 'medimg', 'bio') {
  $r = & $conda run -n $e python -c "import torch,sys;print(sys.version.split()[0], torch.__version__, torch.version.cuda, torch.cuda.is_available(), torch.cuda.get_arch_list()[-3:])" 2>&1 | Select-Object -Last 1
  "$e -> $r"
}
"--- ollama"
(Get-Command ollama).Source
Test-Path "$env:LOCALAPPDATA\Programs\Ollama"
"--- WSL GPU"
wsl -d Ubuntu-24.04 -- nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>&1 | Select-Object -First 2
"--- WSL mem"
wsl -d Ubuntu-24.04 -- free -g 2>&1 | Select-Object -First 2
"--- .wslconfig"
Get-Content "$env:USERPROFILE\.wslconfig"
"--- work folder"
Get-ChildItem F:\krishiloop-5090 | Select-Object Name
"--- cpu"
(Get-CimInstance Win32_Processor | Select-Object -First 1).Name
(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
"--- network speed hint"
Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object Name, LinkSpeed | Format-Table -AutoSize | Out-String
