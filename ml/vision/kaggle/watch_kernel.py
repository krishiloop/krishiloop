"""Poll a Kaggle kernel until it finishes, then download its outputs into ml/vision/artifacts/.

Usage: KAGGLE_USERNAME=<user> KAGGLE_API_TOKEN=<token> python ml/vision/kaggle/watch_kernel.py [slug] [max_minutes]
"""
import json, os, sys, time, urllib.request, urllib.error
from pathlib import Path

user, token = os.environ["KAGGLE_USERNAME"], os.environ["KAGGLE_API_TOKEN"]
slug = sys.argv[1] if len(sys.argv) > 1 else "krishiloop-rice-baseline"
max_min = int(sys.argv[2]) if len(sys.argv) > 2 else 240
OUT = Path(__file__).resolve().parents[1] / "artifacts"; OUT.mkdir(exist_ok=True)
H = {"Authorization": f"Bearer {token}", "User-Agent": "kaggle-api/1.8"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60) as r:
        return json.loads(r.read())


start = time.time()
status = "unknown"
while time.time() - start < max_min * 60:
    try:
        st = get(f"https://www.kaggle.com/api/v1/kernels/status?userName={user}&kernelSlug={slug}")
        status = str(st.get("status", "")).lower()
        print(f"[{(time.time()-start)/60:5.1f} min] status={status} {st.get('failureMessage') or ''}", flush=True)
        if any(s in status for s in ("complete", "error", "cancel")):
            break
    except Exception as e:
        print("status check failed:", str(e)[:120], flush=True)
    time.sleep(180)

try:
    out = get(f"https://www.kaggle.com/api/v1/kernels/output?userName={user}&kernelSlug={slug}")
    (OUT / f"{slug}.log.txt").write_text(str(out.get("log", ""))[-200000:], encoding="utf-8")
    for f in out.get("files", []):
        name = f.get("fileName", "")
        if name.endswith((".json", ".csv", ".onnx")):
            with urllib.request.urlopen(urllib.request.Request(f["url"], headers={"User-Agent": "kaggle-api/1.8"}), timeout=300) as r:
                (OUT / name).write_bytes(r.read())
            print("downloaded", name)
except Exception as e:
    print("output download failed:", str(e)[:200])
print("FINAL STATUS:", status)
