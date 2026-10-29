# FLEURS bn_in test with omni-ctc-3b-v2 (kljob script)
. F:\krishiloop-5090\scripts\voice\common.ps1
Run @("$V\asr_eval.py", '--backend', 'omni', '--ckpt', "$M\omniasr\omniASR-CTC-3B-v2.pt", '--tokenizer', "$M\omniasr\omniASR_tokenizer_written_v2.model", '--arch', '3b_v2', '--manifest', $FLEURS, '--out-dir', "$W\asr", '--tag', 'omni-ctc-3b-v2')
