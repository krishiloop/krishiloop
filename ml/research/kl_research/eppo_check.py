"""Verify EPPO codes in configs/label_map.csv against the public EPPO Global Database pages (no account needed).
For each code, fetch https://gd.eppo.int/taxon/<CODE> and read the page title (the preferred name). The result is
written next to the label map as eppo_check.json; a code whose page does not name the expected taxon is reported and
must be blanked in the label map (we never keep an unverified code).
Usage: python -m kl_research.eppo_check <label_map.csv> <out.json>"""
import csv
import json
import re
import sys
import time
import urllib.request


def title(code):
    req = urllib.request.Request(f"https://gd.eppo.int/taxon/{code}", headers={"User-Agent": "KrishiLoop-research/0.1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        html = r.read().decode("utf-8", "replace")
    m = re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""


def main(argv):
    rows = list(csv.DictReader(open(argv[0], encoding="utf-8")))
    want = {}
    for r in rows:
        if r["eppo_crop"]:
            want.setdefault(r["eppo_crop"], r["crop_sci"])
        if r["eppo_condition"]:
            want.setdefault(r["eppo_condition"], r["agent"])
    out = {}
    for code, expected in sorted(want.items()):
        try:
            t = title(code)
        except Exception as e:  # noqa: BLE001
            t = f"ERROR {e}"
        genus = expected.split()[0].lower() if expected else ""
        ok = bool(genus) and genus in t.lower()
        out[code] = {"expected": expected, "page_title": t, "match": ok, "url": f"https://gd.eppo.int/taxon/{code}"}
        print(f"{code:<8} {'OK ' if ok else 'CHECK'} expected={expected!r} title={t!r}", flush=True)
        time.sleep(1)
    json.dump(out, open(argv[1], "w", encoding="utf-8"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1:])
