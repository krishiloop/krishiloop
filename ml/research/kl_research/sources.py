"""Public-API helpers for dataset and model provenance, plus the licence screen.

Every function here talks to a public endpoint without credentials:
- Mendeley Data  https://data.mendeley.com/public-api/datasets/<id>?version=<v>  (+ /folders/<v>, /files?folder_id=..)
- Zenodo         https://zenodo.org/api/records/<id>
- Hugging Face   https://huggingface.co/api/datasets/<id> , https://huggingface.co/api/models/<id>
- GitHub         raw LICENSE / README files

Usage (licence screen, writes JSON with the licence fields recorded verbatim):
    python -m kl_research.sources screen configs/datasets.yaml configs/backbones.yaml out.json
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UA = {"User-Agent": "KrishiLoop-research/0.1 (benchmark licence screen; contact via repo)", "Accept": "application/json"}
MENDELEY = "https://data.mendeley.com/public-api/datasets"


def http_get(url: str, tries: int = 4, timeout: int = 60, headers: dict | None = None, raw: bool = False):
    """GET with retries. Returns parsed JSON (default) or bytes (raw=True). Returns None on 404."""
    h = dict(UA)
    if headers:
        h.update(headers)
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
                b = r.read()
            return b if raw else json.loads(b.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return None
            if e.code in (401, 403):
                raise PermissionError(f"{e.code} for {url} (needs credentials or gated)") from e
            last = e
        except Exception as e:  # noqa: BLE001 - network errors are retried
            last = e
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET failed after {tries} tries: {url}: {last}")


# ------------------------------------------------------------------ Mendeley Data
def mendeley_meta(ds_id: str, version: int) -> dict:
    return http_get(f"{MENDELEY}/{ds_id}?version={version}")


def mendeley_files(ds_id: str, version: int) -> list[dict]:
    """Every file of a dataset version as {path, size, url, sha256?}. Folder tree rebuilt from the folders API."""
    folders = {f["id"]: f for f in (http_get(f"{MENDELEY}/{ds_id}/folders/{version}") or [])}

    def fpath(fid):
        parts = []
        seen = set()
        while fid in folders and fid not in seen:
            seen.add(fid)
            parts.append(folders[fid]["name"])
            fid = folders[fid].get("parent_id")
        return "/".join(reversed(parts))

    out = []
    for fid in ["root"] + list(folders):
        lst = http_get(f"{MENDELEY}/{ds_id}/files?folder_id={fid}&version={version}") or []
        for f in lst:
            cd = f.get("content_details") or {}
            rel = "/".join(p for p in ((fpath(fid) if fid != "root" else ""), f["filename"]) if p)
            out.append({"path": rel, "size": f.get("size") or cd.get("size"), "url": cd.get("download_url"),
                        "sha256": cd.get("sha256_hash"), "content_type": cd.get("content_type")})
    return out


# ------------------------------------------------------------------ Zenodo
def zenodo_record(rec_id: str) -> dict:
    return http_get(f"https://zenodo.org/api/records/{rec_id}")


def zenodo_files(rec: dict) -> list[dict]:
    out = []
    for f in rec.get("files", []):
        links = f.get("links", {})
        out.append({"path": f.get("key"), "size": f.get("size"), "url": links.get("self") or links.get("content"),
                    "checksum": f.get("checksum")})
    return out


# ------------------------------------------------------------------ Hugging Face / GitHub
def hf_model(model_id: str) -> dict | None:
    return http_get(f"https://huggingface.co/api/models/{model_id}")


def hf_dataset(ds_id: str) -> dict | None:
    return http_get(f"https://huggingface.co/api/datasets/{ds_id}")


def github_raw(owner_repo: str, path: str, branches=("main", "master")) -> tuple[str | None, str | None]:
    for br in branches:
        try:
            b = http_get(f"https://raw.githubusercontent.com/{owner_repo}/{br}/{path}", raw=True, tries=2)
        except Exception:  # noqa: BLE001
            b = None
        if b is not None:
            return br, b.decode("utf-8", "replace")
    return None, None


# ------------------------------------------------------------------ licence screen
ALLOWED = {"cc0", "cc0-1.0", "cc-by", "cc-by-4.0", "cc by 4.0", "cc-by-3.0", "cc by 3.0", "cc-by-sa", "cc-by-sa-4.0",
           "cc by-sa 4.0", "cc-by-sa-3.0", "mit", "apache-2.0", "apache 2.0", "cc0 1.0", "cc0: public domain"}


def classify_licence(label: str | None) -> str:
    """'allowed' / 'blocked' / 'unclear' against PROTOCOL_v1 section D (CC0, CC BY, CC BY-SA, MIT, Apache-2.0)."""
    if not label:
        return "unclear"
    if isinstance(label, (list, tuple)):
        label = " ".join(map(str, label))
    s = str(label).strip().lower()
    if "nc" in s.replace("-", " ").split() or "non-commercial" in s or "noncommercial" in s or " nd" in s.replace("-", " ") \
            or "-nd" in s or "by-nc" in s or "by nc" in s:
        return "blocked"
    if "gpl" in s:
        return "blocked"  # copyleft software licence on data: not in the protocol's allowed list
    if s in ALLOWED or s.startswith(("cc by 4.0", "cc-by-4.0", "cc0", "mit", "apache")):
        return "allowed"
    if "attribution 4.0" in s and "noncommercial" not in s and "noderiv" not in s:
        return "allowed"
    return "unclear"


def screen_dataset(entry: dict) -> dict:
    src, sid = entry["source"], str(entry.get("id", ""))
    rec = {"key": entry["key"], "source": src, "id": sid, "version": entry.get("version"),
           "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    try:
        if src == "mendeley":
            m = mendeley_meta(sid, int(entry["version"]))
            lic = m.get("data_licence") or {}
            rec.update(title=m.get("name"), doi=(m.get("doi") or {}).get("id"), publish_date=m.get("publish_date"),
                       licence_short=lic.get("short_name"), licence_full=lic.get("full_name"), licence_url=lic.get("url"),
                       licence_text=lic.get("description"),
                       creators=[c.get("first_name", "") + " " + c.get("last_name", "") for c in m.get("contributors", [])],
                       versions=[v.get("version") for v in m.get("versions", [])],
                       api=f"{MENDELEY}/{sid}?version={entry['version']}")
            rec["licence_label"] = lic.get("short_name")
        elif src == "zenodo":
            r = zenodo_record(sid)
            md = r.get("metadata", {})
            lic = md.get("license") or {}
            rec.update(title=md.get("title"), doi=r.get("doi") or md.get("doi"), publish_date=md.get("publication_date"),
                       version_label=md.get("version"), licence_id=lic.get("id"), access_right=md.get("access_right"),
                       creators=[c.get("name") for c in md.get("creators", [])],
                       files=[{"key": f["path"], "size": f["size"]} for f in zenodo_files(r)],
                       api=f"https://zenodo.org/api/records/{sid}")
            rec["licence_label"] = lic.get("id")
        elif src == "github":
            br, text = github_raw(entry["repo"], entry.get("licence_path", "LICENSE"))
            rec.update(repo=entry["repo"], branch=br, licence_file=entry.get("licence_path", "LICENSE"),
                       licence_text_head=(text or "")[:400])
            rec["licence_label"] = entry.get("licence_label_from_file") if text else None
            if entry.get("readme_licence_grep"):
                br2, readme = github_raw(entry["repo"], "README.md")
                if readme:
                    lines = [ln for ln in readme.splitlines() if entry["readme_licence_grep"].lower() in ln.lower()]
                    rec["readme_licence_lines"] = lines[:6]
        elif src == "hf_dataset":
            d = hf_dataset(sid) or {}
            rec.update(licence_label=(d.get("cardData") or {}).get("license"), gated=d.get("gated"),
                       api=f"https://huggingface.co/api/datasets/{sid}")
        else:
            rec["licence_label"] = entry.get("licence_label")
            rec["note"] = "manual source; licence recorded from config"
    except PermissionError as e:
        rec["error"] = str(e)
        rec["licence_label"] = None
        rec["gated"] = True
    except Exception as e:  # noqa: BLE001
        rec["error"] = str(e)[:300]
    rec["licence_class"] = classify_licence(rec.get("licence_label"))
    return rec


def screen_model(entry: dict) -> dict:
    rec = {"key": entry["key"], "hf_id": entry.get("hf_id"), "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    try:
        m = hf_model(entry["hf_id"]) or {}
        card = m.get("cardData") or {}
        tags = [t for t in m.get("tags", []) if t.startswith("license:")]
        rec.update(licence_label=card.get("license"), licence_name=card.get("license_name"), licence_link=card.get("license_link"),
                   licence_tags=tags, gated=m.get("gated"), sha=m.get("sha"), last_modified=m.get("lastModified"),
                   api=f"https://huggingface.co/api/models/{entry['hf_id']}")
    except PermissionError as e:
        rec.update(error=str(e), gated=True)
    except Exception as e:  # noqa: BLE001
        rec["error"] = str(e)[:300]
    lab = rec.get("licence_label")
    rec["licence_class"] = classify_licence(lab) if lab not in ("other", None) else "unclear"
    if rec.get("gated"):
        rec["licence_class"] = "gated"
    return rec


def main(argv):
    import yaml
    if argv[0] == "screen":
        ds_cfg = yaml.safe_load(open(argv[1], encoding="utf-8"))
        bb_cfg = yaml.safe_load(open(argv[2], encoding="utf-8"))
        out = {"datasets": [], "backbones": []}
        for e in ds_cfg["datasets"]:
            r = screen_dataset(e)
            print(f"{r['key']:<34} {str(r.get('licence_label')):<28} {r['licence_class']:<8} {r.get('error', '')[:80]}", flush=True)
            out["datasets"].append(r)
        for e in bb_cfg["backbones"]:
            if not e.get("hf_id"):
                continue
            r = screen_model(e)
            if e.get("upstream"):
                r["upstream"] = screen_model({"key": e["key"] + "@upstream", "hf_id": e["upstream"]})
            up = r.get("upstream") or {}
            print(f"MODEL {r['key']:<16} {str(r.get('licence_label')):<14} gated={r.get('gated')} {r['licence_class']:<8}"
                  f" | upstream {up.get('hf_id', '-')}: {up.get('licence_label')} gated={up.get('gated')}", flush=True)
            out["backbones"].append(r)
        json.dump(out, open(argv[3], "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
