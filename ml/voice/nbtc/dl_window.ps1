# kljob script: wait for the link window the phased Ollama pull yields, then fetch the voice files (<=4 range connections/file)
& 'C:\Users\User\miniforge3\envs\dl\python.exe' -u 'F:\krishiloop-5090\scripts\voice\download_assets.py' --stage window 2>&1 | ForEach-Object { "$_" }
