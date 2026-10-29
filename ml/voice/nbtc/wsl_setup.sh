#!/bin/bash
# wsl_setup: ATTEMPTED 29 Oct, stopped after the pip bootstrap because the link was saturated; kept for an overnight cross-check of omni_ctc.py against the official fairseq2 pipeline
# Build the WSL2 venv for Meta Omnilingual ASR (fairseq2 has no native Windows support).
# Everything lives on F: (/mnt/f/krishiloop-5090); no sudo, no apt, nothing persistent.
set -uo pipefail
ROOT=/mnt/f/krishiloop-5090
V=$ROOT/venvs/voice-wsl
export PIP_CACHE_DIR=$ROOT/cache/pip-wsl
export PIP_DISABLE_PIP_VERSION_CHECK=1
mkdir -p "$ROOT/cache/wheels" "$PIP_CACHE_DIR"
echo "whoami: $(whoami)  python3: $(python3 --version)"
nvidia-smi --query-gpu=name,memory.used --format=csv,noheader
if [ ! -x "$V/bin/python" ]; then python3 -m venv --without-pip "$V" || python3 -m venv --copies --without-pip "$V" || exit 1; fi
if [ ! -x "$V/bin/pip" ]; then
  WHL_URL=$(python3 -c "import json,urllib.request;d=json.load(urllib.request.urlopen('https://pypi.org/pypi/pip/json'));print([u['url'] for u in d['urls'] if u['filename'].endswith('.whl')][0])")
  WHL="$ROOT/cache/wheels/$(basename "$WHL_URL")"
  [ -f "$WHL" ] || curl -sSL -o "$WHL" "$WHL_URL"
  "$V/bin/python" "$WHL/pip" install --no-index "$WHL" || exit 1
fi
"$V/bin/pip" --version
echo "== torch"; "$V/bin/pip" install -q "torch==2.8.0" "torchaudio==2.8.0" || exit 1
echo "== fairseq2"; "$V/bin/pip" install -q "fairseq2[arrow]==0.6.0" || exit 1
echo "== omnilingual-asr (no kenlm: it needs a compiler and is only used for optional LM decoding)"
"$V/bin/pip" install -q --no-deps "omnilingual-asr==0.2.0" || exit 1
"$V/bin/pip" install -q pyarrow "polars>=1.29.0" numba pandas soundfile || exit 1
# fairseq2n wants libsndfile.so.1; reuse the copy bundled in the soundfile wheel (no apt needed)
SF=$("$V/bin/python" -c "import os,_soundfile_data as d; print(os.path.dirname(d.__file__))" 2>/dev/null)
mkdir -p "$V/lib/extra"
if [ -n "$SF" ]; then ln -sf "$SF"/libsndfile*.so "$V/lib/extra/libsndfile.so.1"; fi
ls -la "$V/lib/extra" || true
export LD_LIBRARY_PATH="$V/lib/extra:${LD_LIBRARY_PATH:-}"
"$V/bin/python" -c "import torch; print('torch', torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0), torch.cuda.get_arch_list())"
"$V/bin/python" -c "import fairseq2, fairseq2n; print('fairseq2', fairseq2.__version__)"
"$V/bin/python" -c "from omnilingual_asr.models.inference.pipeline import ASRInferencePipeline; print('pipeline import ok')"
echo "WSL SETUP DONE"
