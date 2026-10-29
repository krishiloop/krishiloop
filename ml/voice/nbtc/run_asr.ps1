# FLEURS bn_in test: every ASR model whose files are present (sequential; one model on the GPU at a time)
. F:\krishiloop-5090\scripts\voice\common.ps1
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader
if (Test-Path "$M\omniasr\omniASR-CTC-1B-v2.pt") {
  Run @("$V\asr_eval.py", '--backend', 'omni', '--ckpt', "$M\omniasr\omniASR-CTC-1B-v2.pt", '--tokenizer', "$M\omniasr\omniASR_tokenizer_written_v2.model", '--arch', '1b_v2', '--manifest', $FLEURS, '--out-dir', "$W\asr", '--tag', 'omni-ctc-1b-v2')
}
if (Test-Path "$M\omniasr\omniASR-CTC-3B-v2.pt") {
  Run @("$V\asr_eval.py", '--backend', 'omni', '--ckpt', "$M\omniasr\omniASR-CTC-3B-v2.pt", '--tokenizer', "$M\omniasr\omniASR_tokenizer_written_v2.model", '--arch', '3b_v2', '--manifest', $FLEURS, '--out-dir', "$W\asr", '--tag', 'omni-ctc-3b-v2')
}
foreach ($wm in 'whisper-large-v3-turbo', 'whisper-large-v3') {
  if (Test-Path "$M\$wm\model.safetensors") {
    Run @("$V\asr_eval.py", '--backend', 'whisper', '--model-dir', "$M\$wm", '--manifest', $FLEURS, '--out-dir', "$W\asr", '--tag', $wm)
  }
}
