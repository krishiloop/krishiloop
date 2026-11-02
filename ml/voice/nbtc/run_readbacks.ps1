# kljob script: (re)synthesise the farmer app's Bangla readbacks that have no shippable clip yet, male voice only,
# then transcribe them back with Omnilingual CTC-1B so ml/voice/readbacks.py can keep only clips that say their text.
#
# NOT RUN YET. Written on 2 Nov 2026 while the 5090 was lent to another project. Steps (see ml/voice/REPORT.md, "Wired
# into the app"):
#   laptop:  python ml/voice/readbacks.py todo            # writes ml/voice/results/readbacks/todo.jsonl (2 takes per text)
#            scp ml/voice/results/readbacks/todo.jsonl nbtc5090:F:/krishiloop-5090/scripts/voice/readbacks_todo.jsonl
#            scp ml/voice/nbtc/run_readbacks.ps1 nbtc5090:F:/krishiloop-5090/scripts/voice/
#   5090:    kljob.ps1 -Name voice-readbacks -Script F:\krishiloop-5090\scripts\voice\run_readbacks.ps1
#   laptop:  scp "nbtc5090:F:/krishiloop-5090/work/voice/readbacks/svara/opus/*" <clips dir>
#            scp nbtc5090:F:/krishiloop-5090/work/voice/readbacks/svara/results.jsonl ml/voice/results/readbacks/results.jsonl
#            scp nbtc5090:F:/krishiloop-5090/work/voice/readbacks/roundtrip/svara__omni-ctc-1b-v2.hyps.jsonl ml/voice/results/readbacks/roundtrip.hyps.jsonl
#            python ml/voice/readbacks.py build --clips <clips dir, holding the old AND the new .ogg files> \
#                --results ml/voice/results/tts/svara/results.jsonl ml/voice/results/readbacks/results.jsonl \
#                --roundtrip ml/voice/results/roundtrip/svara__omni-ctc-1b-v2.hyps.jsonl ml/voice/results/readbacks/roundtrip.hyps.jsonl
. F:\krishiloop-5090\scripts\voice\common.ps1
$todo = "$V\readbacks_todo.jsonl"
if (-not (Test-Path $todo)) { "no $todo: run readbacks.py todo on the laptop and copy it here first"; exit 1 }
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader
# both voice options are male: the female voice failed the round trip (19 of 51 clips heard as Devanagari or Gujarati)
Run @("$V\tts_eval.py", '--backend', 'svara', '--texts', $todo, '--out-dir', "$W\readbacks", '--lean', '--voices', 'Bengali (Male)', '--rule-voices', 'Bengali (Male)')
$man = "$W\readbacks\svara\manifest_roundtrip.jsonl"
Run @("$V\asr_eval.py", '--backend', 'omni', '--ckpt', "$M\omniasr\omniASR-CTC-1B-v2.pt", '--tokenizer', "$M\omniasr\omniASR_tokenizer_written_v2.model", '--arch', '1b_v2', '--manifest', $man, '--out-dir', "$W\readbacks\roundtrip", '--tag', 'svara__omni-ctc-1b-v2', '--no-latency')
"=== readbacks end"
