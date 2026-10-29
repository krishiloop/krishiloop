# kljob script: the link window is open (pull log: "link yielded to datasets and voice until 16:00"); fetch now
& 'C:\Users\User\miniforge3\envs\dl\python.exe' -u 'F:\krishiloop-5090\scripts\voice\download_assets.py' --stage window --no-wait 2>&1 | ForEach-Object { "$_" }
