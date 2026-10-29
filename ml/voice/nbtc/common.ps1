# dot-sourced by the voice job scripts: process-scoped settings only
$env:HF_HOME = 'F:\krishiloop-5090\models\hf'
$env:HF_HUB_OFFLINE = '1'
$env:TRANSFORMERS_OFFLINE = '1'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUNBUFFERED = '1'
$PY = 'F:\krishiloop-5090\venvs\voice\Scripts\python.exe'
$V = 'F:\krishiloop-5090\scripts\voice'
$M = 'F:\krishiloop-5090\models\voice'
$W = 'F:\krishiloop-5090\work\voice'
$FLEURS = 'F:\krishiloop-5090\data\voice\fleurs_bn_in\manifest_test.jsonl'
function Run($argsList) { & $PY @argsList 2>&1 | ForEach-Object { "$_" } }
