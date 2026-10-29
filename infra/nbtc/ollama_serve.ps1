# The local language-model server for KrishiLoop experiments: 127.0.0.1 only, models kept in the work folder.
# NUM_PARALLEL lets one loaded model answer 8 requests at once (batched on the GPU) instead of one at a time.
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_MODELS = 'F:\krishiloop-5090\models\ollama'
$env:OLLAMA_KEEP_ALIVE = '10m'
$env:OLLAMA_FLASH_ATTENTION = '1'
$env:OLLAMA_MAX_LOADED_MODELS = '1'
$env:OLLAMA_NUM_PARALLEL = '8'
$env:OLLAMA_KV_CACHE_TYPE = 'q8_0'
New-Item -ItemType Directory -Force $env:OLLAMA_MODELS | Out-Null
& 'C:\Users\User\AppData\Local\Programs\Ollama\ollama.exe' serve
