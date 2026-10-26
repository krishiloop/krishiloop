"""Push ml/vision/kaggle/rice_baseline.py to Kaggle as a private GPU script kernel (owner = KAGGLE_USERNAME).

Usage (tokens come from the environment, never from this repo):
    KAGGLE_USERNAME=<user> KAGGLE_API_TOKEN=<token> python ml/vision/kaggle/push_kernel.py
"""
import json, os, sys, urllib.request, urllib.error
from pathlib import Path

user = os.environ["KAGGLE_USERNAME"]; token = os.environ["KAGGLE_API_TOKEN"]
code = (Path(__file__).parent / "rice_baseline.py").read_text(encoding="utf-8")
body = {
    "slug": f"{user}/krishiloop-rice-baseline",
    "newTitle": "KrishiLoop rice baseline",
    "text": code,
    "language": "python",
    "kernelType": "script",
    "isPrivate": True,
    "enableGpu": True,
    "enableTpu": False,
    "enableInternet": True,
    "datasetDataSources": ["alamshihab075/rice-leaf-disease-an-images-dataset", "imbikramsaha/paddy-doctor"],
    "competitionDataSources": [],
    "kernelDataSources": [],
    "categoryIds": [],
}
req = urllib.request.Request("https://www.kaggle.com/api/v1/kernels/push", data=json.dumps(body).encode(),
                             headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                      "User-Agent": "kaggle-api/1.8"})
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        print(r.status, r.read().decode()[:600])
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode()[:600]); sys.exit(1)
