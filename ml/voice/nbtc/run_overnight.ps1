# kljob script (one-shot): AFTER the lead's Ollama pulls finish, fetch Omnilingual CTC-3B-v2 and Whisper large-v3,
# then evaluate them on FLEURS bn_in test and on the SYNTHETIC round trips. Resumable; skips finished steps.
# Lead's decision (29 Oct): "Skip CTC-3B-v2 for now; take it overnight, after the models, if there's time."
. F:\krishiloop-5090\scripts\voice\common.ps1
$t0 = Get-Date
while ((Get-ScheduledTask -TaskName 'kl-pull' -ErrorAction SilentlyContinue) -and ((Get-Date) - $t0).TotalHours -lt 14) { Start-Sleep -Seconds 120 }
"=== kl-pull finished or timed out at " + (Get-Date -Format s)
& 'C:\Users\User\miniforge3\envs\dl\python.exe' -u "$V\download_assets.py" --stage overnight --no-wait 2>&1 | ForEach-Object { "$_" }
$used = [int](nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)
"GPU memory in use before the evals: $used MiB"
if (Test-Path "$M\omniasr\omniASR-CTC-3B-v2.pt") {
  if (-not (Test-Path "$W\asr\omni-ctc-3b-v2.summary.json")) {
    Run @("$V\asr_eval.py", '--backend', 'omni', '--ckpt', "$M\omniasr\omniASR-CTC-3B-v2.pt", '--tokenizer', "$M\omniasr\omniASR_tokenizer_written_v2.model", '--arch', '3b_v2', '--manifest', $FLEURS, '--out-dir', "$W\asr", '--tag', 'omni-ctc-3b-v2')
  }
}
if ((Test-Path "$M\whisper-large-v3\model.safetensors") -and -not (Test-Path "$W\asr\whisper-large-v3.summary.json")) {
  Run @("$V\asr_eval.py", '--backend', 'whisper', '--model-dir', "$M\whisper-large-v3", '--manifest', $FLEURS, '--out-dir', "$W\asr", '--tag', 'whisper-large-v3', '--batch', '16')
}
"=== round trips with the new models"
. "$V\run_roundtrip.ps1"
"=== overnight end " + (Get-Date -Format s)
