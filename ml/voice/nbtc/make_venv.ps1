# kljob script: create the voice venv (reuses the dl env's torch/transformers via --system-site-packages; never installs into dl)
$v = 'F:\krishiloop-5090\venvs\voice'
if (-not (Test-Path "$v\Scripts\python.exe")) { & 'C:\Users\User\miniforge3\envs\dl\python.exe' -m venv --system-site-packages $v }
$env:PIP_CACHE_DIR = 'F:\krishiloop-5090\cache\pip-win'
& "$v\Scripts\python.exe" -m pip install --disable-pip-version-check --progress-bar off soundfile jiwer av fastapi uvicorn python-multipart gguf 2>&1 | ForEach-Object { "$_" }
& "$v\Scripts\python.exe" -m pip install --disable-pip-version-check --progress-bar off --no-deps snac 2>&1 | ForEach-Object { "$_" }
& "$v\Scripts\python.exe" -c "import soundfile, jiwer, av, fastapi, uvicorn, multipart, gguf, snac, transformers, torch; import soundfile as sf; print('ok', sf.__libsndfile_version__, av.__version__, fastapi.__version__, transformers.__version__, torch.__version__, 'OPUS' in sf.available_subtypes('OGG'), 'MP3' in sf.available_formats())" 2>&1 | ForEach-Object { "$_" }
