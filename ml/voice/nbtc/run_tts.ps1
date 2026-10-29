# TTS: svara (candidate) then MMS (comparison only, CC BY-NC)
. F:\krishiloop-5090\scripts\voice\common.ps1
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader
if (Test-Path "$M\svara-tts-v1-gguf\svara-tts-v1.Q8_0.gguf") { Run @("$V\tts_eval.py", '--backend', 'svara', '--texts', "$V\tts_texts.jsonl", '--out-dir', "$W\tts") }
if (Test-Path "$M\mms-tts-ben\model.safetensors") { Run @("$V\tts_eval.py", '--backend', 'mms', '--texts', "$V\tts_texts.jsonl", '--out-dir', "$W\tts") }
