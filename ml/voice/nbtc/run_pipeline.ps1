# kljob script: the rest of the voice evaluation, in order, skipping steps whose outputs already exist.
# Omnilingual ASR on FLEURS -> svara TTS (lean sampling loop) -> MMS TTS (comparison only, CC BY-NC)
# -> SYNTHETIC round trips -> service test (starts and stops the 127.0.0.1 service). One model on the GPU at a time.
. F:\krishiloop-5090\scripts\voice\common.ps1
$omni = "$M\omniasr\omniASR-CTC-1B-v2.pt"
if ((Test-Path $omni) -and -not (Test-Path "$W\asr\omni-ctc-1b-v2.summary.json")) {
  "=== omni-ctc-1b-v2 on FLEURS"
  Run @("$V\asr_eval.py", '--backend', 'omni', '--ckpt', $omni, '--tokenizer', "$M\omniasr\omniASR_tokenizer_written_v2.model", '--arch', '1b_v2', '--manifest', $FLEURS, '--out-dir', "$W\asr", '--tag', 'omni-ctc-1b-v2')
}
if ((Test-Path "$M\svara-tts-v1-gguf\svara-tts-v1.Q8_0.gguf") -and -not (Test-Path "$W\tts\svara\summary.json")) {
  "=== svara TTS"
  Run @("$V\tts_eval.py", '--backend', 'svara', '--texts', "$V\tts_texts.jsonl", '--out-dir', "$W\tts", '--lean')
}
if ((Test-Path "$M\mms-tts-ben\model.safetensors") -and -not (Test-Path "$W\tts\mms\summary.json")) {
  "=== MMS TTS (CC BY-NC, comparison only)"
  Run @("$V\tts_eval.py", '--backend', 'mms', '--texts', "$V\tts_texts.jsonl", '--out-dir', "$W\tts")
}
"=== round trips"
. "$V\run_roundtrip.ps1"
"=== service test"
. "$V\run_service_test.ps1"
"=== pipeline end"
