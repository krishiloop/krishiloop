# kljob script: after the main pipeline, voice the 40 SYNTHETIC farmer questions with "Bengali (Male)" too
# (the female voice was transcribed in Devanagari for 19 of 51 clips), then extend the round trips.
. F:\krishiloop-5090\scripts\voice\common.ps1
while (Get-ScheduledTask -TaskName 'kl-voice-pipe4' -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 15 }
Remove-Item "$W\tts\svara\summary.json" -ErrorAction SilentlyContinue
Run @("$V\tts_eval.py", '--backend', 'svara', '--texts', "$V\tts_texts.jsonl", '--out-dir', "$W\tts", '--lean', '--voices', 'Bengali (Male)', '--rule-voices', 'Bengali (Male)')
$man = "$W\tts\svara\manifest_roundtrip.jsonl"
Run @("$V\asr_eval.py", '--backend', 'omni', '--ckpt', "$M\omniasr\omniASR-CTC-1B-v2.pt", '--tokenizer', "$M\omniasr\omniASR_tokenizer_written_v2.model", '--arch', '1b_v2', '--manifest', $man, '--out-dir', "$W\roundtrip", '--tag', 'svara__omni-ctc-1b-v2', '--no-latency')
Run @("$V\asr_eval.py", '--backend', 'whisper', '--model-dir', "$M\whisper-large-v3-turbo", '--manifest', $man, '--out-dir', "$W\roundtrip", '--tag', 'svara__whisper-large-v3-turbo', '--no-latency', '--batch', '16', '--timing-n', '20')
"=== male questions end"
