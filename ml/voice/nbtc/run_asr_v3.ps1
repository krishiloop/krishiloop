# FLEURS bn_in test with whisper-large-v3 (kljob script)
. F:\krishiloop-5090\scripts\voice\common.ps1
Run @("$V\asr_eval.py", '--backend', 'whisper', '--model-dir', "$M\whisper-large-v3", '--manifest', $FLEURS, '--out-dir', "$W\asr", '--tag', 'whisper-large-v3', '--batch', '16')
