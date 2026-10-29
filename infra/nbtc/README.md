# NBTC RTX 5090: private compute for KrishiLoop

A lab PC with an **NVIDIA RTX 5090 (32 GB)** that we reach only over **Tailscale** (key-only SSH, host `nbtc5090`). Nothing on it is served to the internet or the lab network: every server binds `127.0.0.1`, there are no port forwards or tunnels, and Tailscale Funnel and Serve are off. Our files live only in `F:\krishiloop-5090`.

**Why this machine:**
- experiments that need a GPU: local language models for the safety evaluation, BioCLIP 2 on CUDA, speech;
- the "sovereign mode" proof: the whole stack in-country on one GPU, with no cloud.

The GeForce licence excludes data-centre deployment, so this is a benchmark and proof of concept. Production in-country deployments would use data-centre GPUs.

| Script | What it does |
|---|---|
| `kljob.ps1` | Runs one KrishiLoop job as a **one-shot scheduled task that deletes itself when the job ends** (`-Name`, `-Script`; also `-Status`, `-Stop`, `-List`). Standard rights, no stored password (S4U); only scripts inside `F:\krishiloop-5090`. Approved by the owner on 29 Oct 2026 for exactly this scope. |
| `ollama_serve.ps1` | The local language-model server (Ollama), `127.0.0.1:11434` only, models kept in `F:\krishiloop-5090\models\ollama`. Runs as the job `kl-ollama`. |
| `pull_models.ps1` | Downloads the open-weight models used in the evaluations, once each (job `kl-pull`). |
| `pull_phased.ps1` | The same downloads in phases, so the lab's ~10 MB/s link is shared: the first model, then 75 minutes for datasets and speech models, then the rest. Skips models already present; retries resume partial files. |
| `jobs_tail.ps1` | Read-only: the last lines of every job log, plus free space on `F:`. |
| `gpu_probe.ps1` | A 10-second check that background jobs can use CUDA. |
| `inventory.ps1` | A read-only inventory: Python environments, CUDA, Ollama, WSL2, disk. |

**Use from the laptop:**
1. `scp` a script to `nbtc5090:F:/krishiloop-5090/scripts/…`.
2. Run it: `ssh nbtc5090 "powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\kljob.ps1 -Name <job> -Script <script>"`.

**Two cautions:**
- PowerShell mangles inline multi-line commands sent over SSH. Always copy a script file instead.
- On this PC, processes started from an SSH session keep running after it closes. Stop them explicitly, or use `kljob.ps1`.

**Setup record:** the owner-facing steps are `plan/nbtc/` (outside the repo). The lab confirmed remote access, stay-awake and single-user use on 29 Oct 2026.
