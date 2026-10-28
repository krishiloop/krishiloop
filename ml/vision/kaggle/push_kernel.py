"""Push a script from ml/vision/kaggle/ to Kaggle as a private GPU script kernel (owner = KAGGLE_USERNAME).

Usage (tokens come from the environment, never from this repo):
    KAGGLE_USERNAME=<user> KAGGLE_API_TOKEN=<token> [KERNEL_SCRIPT=x.py KERNEL_SLUG=y KERNEL_DATASETS=a/b,c/d] \
        python ml/vision/kaggle/push_kernel.py
KERNEL_DATASETS="" attaches no Kaggle datasets (the script downloads its own data, e.g. from Mendeley).
"""
import json, os, sys, urllib.request, urllib.error
from pathlib import Path

user = os.environ["KAGGLE_USERNAME"]; token = os.environ["KAGGLE_API_TOKEN"]
SCRIPT = os.environ.get("KERNEL_SCRIPT", "rice_baseline.py"); SLUG = os.environ.get("KERNEL_SLUG", "krishiloop-rice-baseline")
code = (Path(__file__).parent / SCRIPT).read_text(encoding="utf-8")
body = {
    "slug": f"{user}/{SLUG}",
    "newTitle": SLUG.replace("-", " "),
    "text": code,
    "language": "python",
    "kernelType": "script",
    "isPrivate": True,
    "enableGpu": True,
    "enableTpu": False,
    "enableInternet": True,
    "datasetDataSources": [d for d in os.environ.get(
        "KERNEL_DATASETS", "alamshihab075/rice-leaf-disease-an-images-dataset,imbikramsaha/paddy-doctor").split(",") if d],
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
