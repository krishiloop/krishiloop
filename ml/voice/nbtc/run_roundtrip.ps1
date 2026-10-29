# SYNTHETIC round trip: every TTS output set transcribed by every available ASR model
. F:\krishiloop-5090\scripts\voice\common.ps1
foreach ($tts in 'svara', 'mms') {
  $man = "$W\tts\$tts\manifest_roundtrip.jsonl"
  if (-not (Test-Path $man)) { continue }
  if (Test-Path "$M\omniasr\omniASR-CTC-1B-v2.pt") { Run @("$V\asr_eval.py", '--backend', 'omni', '--ckpt', "$M\omniasr\omniASR-CTC-1B-v2.pt", '--tokenizer', "$M\omniasr\omniASR_tokenizer_written_v2.model", '--arch', '1b_v2', '--manifest', $man, '--out-dir', "$W\roundtrip", '--tag', "${tts}__omni-ctc-1b-v2", '--no-latency') }
  if (Test-Path "$M\omniasr\omniASR-CTC-3B-v2.pt") { Run @("$V\asr_eval.py", '--backend', 'omni', '--ckpt', "$M\omniasr\omniASR-CTC-3B-v2.pt", '--tokenizer', "$M\omniasr\omniASR_tokenizer_written_v2.model", '--arch', '3b_v2', '--manifest', $man, '--out-dir', "$W\roundtrip", '--tag', "${tts}__omni-ctc-3b-v2", '--no-latency') }
  foreach ($wm in 'whisper-large-v3-turbo', 'whisper-large-v3') {
    if (Test-Path "$M\$wm\model.safetensors") { Run @("$V\asr_eval.py", '--backend', 'whisper', '--model-dir', "$M\$wm", '--manifest', $man, '--out-dir', "$W\roundtrip", '--tag', "${tts}__$wm", '--no-latency', '--batch', '16', '--timing-n', '20') }
  }
}
