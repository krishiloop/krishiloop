"""Resumable, polite downloader for the benchmark (runs on the 5090 through kljob).

- Whole files: HTTP download with Range resume (``.part``), size check, SHA-256 recorded.
- Zip archives with ``remote_zip: true``: only the wanted members are fetched with HTTP Range requests on the
  remote file (central directory first), so augmented copies, overlays or capped classes are never downloaded.
- Other archives (zip, rar, 7z): downloaded whole, then extracted (zipfile, or 7-Zip / bsdtar for rar and 7z).
- Each dataset ends with ``<root>/<key>/_fetch.json`` (provenance: source, version, every file with size and hash)
  and a ``_DONE`` marker; a restart skips finished datasets and finished files.

Commands
    python -m kl_research.fetch plan <datasets.yaml> <out_dir> [keys...]     # list files and zip members (no download)
    python -m kl_research.fetch run  <datasets.yaml> <raw_root> [--max-priority N] [--parallel K] [keys...]
"""
from __future__ import annotations

import fnmatch
import hashlib
import io
import json
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor

from . import sources

IMG_EXT = (".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp")
ARCH_EXT = (".zip", ".rar", ".7z", ".tar", ".tar.gz", ".tgz")
UA = {"User-Agent": "KrishiLoop-research/1.0 (+https://krishiloop.vercel.app)"}
# Connection caps per host class, approved by the lead on 29 Oct 2026 (the lab link is shared):
# Mendeley files on S3 <= 24, Zenodo <= 8 (it rate-limits), anything else (CDNs) <= 4.
HOST_LIMITS = {"s3": int(os.environ.get("KL_S3_CONN", 24)), "zenodo": int(os.environ.get("KL_ZENODO_CONN", 8)),
               "default": int(os.environ.get("KL_CDN_CONN", 4))}
HOST_ERROR_STOP = 40          # this many 429/5xx answers from one host class stops its downloads (and is logged)
_sems: dict = {}
_errors: dict = {}
_lock = threading.Lock()


class HostErrorStop(RuntimeError):
    pass


def host_class(url: str) -> str:
    u = url.lower()
    if "zenodo" in u:
        return "zenodo"
    if "mendeley" in u or "amazonaws" in u:
        return "s3"
    return "default"


def _sem(url: str):
    hc = host_class(url)
    with _lock:
        if hc not in _sems:
            _sems[hc] = threading.BoundedSemaphore(HOST_LIMITS.get(hc, 4))
        return _sems[hc]


def _note_error(url: str, code):
    hc = host_class(url)
    with _lock:
        _errors[hc] = _errors.get(hc, 0) + 1
        n = _errors[hc]
    if n >= HOST_ERROR_STOP:
        raise HostErrorStop(f"host class {hc} returned {n} errors (last {code}); stopping its downloads")


def http_range(url: str, start: int, end: int, tries: int = 10) -> bytes:
    """GET bytes [start, end] with the host's connection cap; exponential backoff on 429/503 honouring Retry-After."""
    last = None
    for i in range(tries):
        hc = host_class(url)
        if _errors.get(hc, 0) >= HOST_ERROR_STOP:
            raise HostErrorStop(f"host class {hc} stopped after repeated errors")
        wait = min(300, 5 * 2 ** i)
        with _sem(url):
            try:
                h = dict(UA)
                h["Range"] = f"bytes={start}-{end}"
                with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=180) as r:
                    if r.status != 206 and not (start == 0 and r.status == 200):
                        raise IOError(f"server ignored Range (status {r.status})")
                    b = r.read()
                if len(b) != end - start + 1 and r.status == 206:
                    raise IOError(f"short read {len(b)} of {end - start + 1}")
                return b
            except urllib.error.HTTPError as e:
                last = e
                if e.code in (429, 500, 502, 503, 504):
                    ra = e.headers.get("Retry-After") if e.headers else None
                    if ra and ra.isdigit():
                        wait = min(600, int(ra))
                    _note_error(url, e.code)
                    log(f"HTTP {e.code} from {hc}; backing off {wait} s")
                elif e.code in (401, 403, 404, 410):
                    raise
            except HostErrorStop:
                raise
            except Exception as e:  # noqa: BLE001
                last = e
                wait = min(60, 3 * (i + 1))
        time.sleep(wait)
    raise RuntimeError(f"range {start}-{end} failed: {url[:80]}: {last}")


def probe_size(url: str) -> int:
    with _sem(url):
        h = dict(UA)
        h["Range"] = "bytes=0-0"
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=120) as r:
            cr = r.headers.get("Content-Range")
            if not cr:
                raise IOError("no Content-Range: server does not support Range")
            return int(cr.split("/")[-1])
SEVENZIP = r"C:\Program Files\7-Zip\7z.exe"
SEED = 20261029
_print_lock = threading.Lock()


def log(*a):
    line = " ".join([time.strftime("%H:%M:%S")] + [str(x) for x in a])
    with _print_lock:
        print(line, flush=True)
        if os.environ.get("KL_LOG"):
            with open(os.environ["KL_LOG"], "a", encoding="utf-8") as f:
                f.write(line + "\n")


def is_image(p: str) -> bool:
    return p.lower().endswith(IMG_EXT) and "__macosx" not in p.lower() and not os.path.basename(p).startswith("._")


def match_any(path: str, globs) -> bool:
    if not globs:
        return False
    p = path.replace("\\", "/")
    return any(fnmatch.fnmatch(p, g) or fnmatch.fnmatch(p.lower(), g.lower()) for g in globs)


# ------------------------------------------------------------------ HTTP Range file for zipfile
class HttpRangeFile(io.RawIOBase):
    """Seekable read-only view of a remote file through HTTP Range requests, with a small block cache."""

    def __init__(self, url: str, size: int | None = None, block: int = 4 << 20, cache_blocks: int = 6):
        super().__init__()
        self.url, self.block, self.cache_blocks = url, block, cache_blocks
        self.pos = 0
        self.cache: dict[int, bytes] = {}
        self.order: list[int] = []
        self.bytes_fetched = 0
        self.size = size if size else self._probe_size()
        self.region = None

    def prefetch_tail(self, seg: int = 256 << 10):
        """Fetch the central directory (and end records) in parallel ranges, so zipfile reads it from memory."""
        tail = self._req(max(0, self.size - 65558), self.size - 1)
        i = tail.rfind(b"PK")
        if i < 0:
            return
        cd_size = int.from_bytes(tail[i + 12:i + 16], "little")
        cd_off = int.from_bytes(tail[i + 16:i + 20], "little")
        if cd_off == 0xFFFFFFFF or cd_size == 0xFFFFFFFF:
            j = tail.rfind(b"PK")
            cd_size = int.from_bytes(tail[j + 40:j + 48], "little")
            cd_off = int.from_bytes(tail[j + 48:j + 56], "little")
        start = min(cd_off, self.size - len(tail))
        segs = [(a, min(self.size - 1, a + seg - 1)) for a in range(start, self.size, seg)]
        with ThreadPoolExecutor(min(len(segs), HOST_LIMITS.get(host_class(self.url), 4))) as ex:
            parts = list(ex.map(lambda ab: http_range(self.url, ab[0], ab[1]), segs))
        data = b"".join(parts)
        self.bytes_fetched += len(data)
        self.region = (start, data)
        log(f"central directory {len(data) / 1e6:.1f} MB fetched in {len(segs)} parallel ranges")

    def _req(self, start: int, end: int) -> bytes:
        b = http_range(self.url, start, end)
        self.bytes_fetched += len(b)
        return b

    def _probe_size(self) -> int:
        return probe_size(self.url)

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def _get_block(self, bi: int) -> bytes:
        if bi in self.cache:
            return self.cache[bi]
        s = bi * self.block
        b = self._req(s, min(self.size, s + self.block) - 1)
        self.cache[bi] = b
        self.order.append(bi)
        if len(self.order) > self.cache_blocks:
            self.cache.pop(self.order.pop(0), None)
        return b

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        if n == 0:
            return b""
        if self.region and self.region[0] <= self.pos and self.pos + n <= self.region[0] + len(self.region[1]):
            o = self.pos - self.region[0]
            self.pos += n
            return self.region[1][o:o + n]
        if n > 2 * self.block:   # large member: one direct request, no caching
            b = self._req(self.pos, self.pos + n - 1)
            self.pos += len(b)
            return b
        out = bytearray()
        while n > 0:
            bi, off = divmod(self.pos, self.block)
            blk = self._get_block(bi)
            chunk = blk[off:off + n]
            if not chunk:
                break
            out += chunk
            self.pos += len(chunk)
            n -= len(chunk)
        return bytes(out)

    def readinto(self, b):
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)


# ------------------------------------------------------------------ whole-file download with resume
def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: str, size: int | None = None, seg: int = 4 << 20) -> dict:
    """Whole-file download in parallel byte ranges (resumable: finished segments are listed in <dest>.segs.json)."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and (size is None or os.path.getsize(dest) == size):
        return {"path": dest, "size": os.path.getsize(dest), "skipped": True}
    if not size:
        size = probe_size(url)
    if size <= seg:   # small file: one request
        b = http_range(url, 0, size - 1)
        with open(dest + ".part", "wb") as f:
            f.write(b)
        os.replace(dest + ".part", dest)
        return {"path": dest, "size": size}
    part, state = dest + ".part", dest + ".segs.json"
    done = set(json.load(open(state))) if os.path.exists(state) and os.path.exists(part) else set()
    if not os.path.exists(part) or os.path.getsize(part) != size:
        with open(part, "wb") as f:
            f.truncate(size)
        done = set()
    segs = [(i, o, min(size, o + seg) - 1) for i, o in enumerate(range(0, size, seg)) if i not in done]
    flock = threading.Lock()
    t0 = time.time()

    def one(sg):
        i, a, b = sg
        data = http_range(url, a, b)
        with flock:
            with open(part, "r+b") as f:
                f.seek(a)
                f.write(data)
            done.add(i)
            if len(done) % 8 == 0:
                json.dump(sorted(done), open(state, "w"))
        return len(data)
    with ThreadPoolExecutor(HOST_LIMITS.get(host_class(url), 4)) as ex:
        got = sum(ex.map(one, segs))
    json.dump(sorted(done), open(state, "w"))
    os.replace(part, dest)
    os.remove(state)
    log(f"downloaded {os.path.basename(dest)} {size / 1e6:.1f} MB in {time.time() - t0:.0f} s "
        f"({got / 1e6 / max(1, time.time() - t0):.2f} MB/s)")
    return {"path": dest, "size": size}


# ------------------------------------------------------------------ archives
def select_members(names_sizes, rules: dict, key: str):
    """Filter zip members by the dataset rules; apply the seeded per-class cap. Returns (kept, report)."""
    keep, dropped = [], {"not_image": 0, "skip_members": 0, "not_in_zip_members": 0, "cap": 0}
    for name, size in names_sizes:
        if name.endswith("/"):
            continue
        if not is_image(name):
            dropped["not_image"] += 1
            continue
        if match_any(name, rules.get("skip_members")):
            dropped["skip_members"] += 1
            continue
        if rules.get("_names") is not None and name not in rules["_names"]:
            dropped["not_in_zip_members"] += 1
            continue
        if rules.get("zip_members") and not match_any(name, rules["zip_members"]):
            dropped["not_in_zip_members"] += 1
            continue
        if rules.get("member_regex") and not re.search(rules["member_regex"], os.path.basename(name)):
            dropped["not_in_zip_members"] += 1
            continue
        keep.append((name, size))
    cap = rules.get("cap_per_class")
    if cap:
        groups: dict[str, list] = {}
        for n, s in keep:
            groups.setdefault(os.path.dirname(n), []).append((n, s))
        rng = random.Random(f"{SEED}:{key}")
        keep = []
        for g in sorted(groups):
            items = sorted(groups[g])
            if len(items) > cap:
                dropped["cap"] += len(items) - cap
                items = sorted(rng.sample(items, cap))
            keep.extend(items)
    return keep, dropped


def safe_join(root: str, name: str) -> str:
    """Join an archive or repository path under root. Components are stripped of trailing spaces and dots (Windows
    drops them, e.g. Dhan-Shomadhan's 'Field Background  ' folder), and '.' / '..' components are refused."""
    parts = []
    for c in name.replace("\\", "/").split("/"):
        c = c.strip().rstrip(".").strip()
        if c in ("", ".", ".."):
            continue
        parts.append(c)
    p = os.path.normpath(os.path.join(root, *parts))
    if not p.startswith(os.path.normpath(root)):
        raise ValueError(f"unsafe member path {name}")
    return p


def remote_zip_extract(url: str, size: int | None, out_dir: str, rules: dict, key: str, streams: int = 0,
                       run_max: int = 8 << 20, gap_max: int = 1 << 20) -> dict:
    """Fetch only the wanted members of a remote zip: read the central directory, then download the members in
    parallel byte-range runs (adjacent members merged up to 8 MB), inflate them and check every CRC32."""
    import zlib
    rf = HttpRangeFile(url, size)
    rf.prefetch_tail()
    zf = zipfile.ZipFile(rf)
    infos = zf.infolist()
    keep, dropped = select_members([(i.filename, i.file_size) for i in infos], rules, key)
    names = {n for n, _ in keep}
    by_off = sorted(infos, key=lambda i: i.header_offset)
    end_of = {}
    cd_start = getattr(zf, "start_dir", rf.size)
    for k, i in enumerate(by_off):
        end_of[i.filename] = by_off[k + 1].header_offset if k + 1 < len(by_off) else cd_start
    sel = [i for i in by_off if i.filename in names]
    todo = [i for i in sel if not (os.path.exists(safe_join(out_dir, i.filename))
                                   and os.path.getsize(safe_join(out_dir, i.filename)) == i.file_size)]
    runs, cur = [], []
    for i in todo:
        if cur and (i.header_offset - end_of[cur[-1].filename] > gap_max or end_of[i.filename] - cur[0].header_offset > run_max):
            runs.append(cur)
            cur = []
        cur.append(i)
    if cur:
        runs.append(cur)
    log(key, os.path.basename(url)[:50], f"members kept {len(sel)} (todo {len(todo)} in {len(runs)} runs), dropped {dropped}")
    stats = {"bytes": 0, "crc_fail": 0, "files": 0}
    slock = threading.Lock()
    t0 = time.time()

    def do_run(run):
        a, b = run[0].header_offset, end_of[run[-1].filename] - 1
        data = http_range(url, a, b)
        nf = 0
        for i in run:
            o = i.header_offset - a
            h = data[o:o + 30]
            if h[:4] != b"PK":
                raise IOError(f"bad local header for {i.filename}")
            n, e = int.from_bytes(h[26:28], "little"), int.from_bytes(h[28:30], "little")
            comp = data[o + 30 + n + e: o + 30 + n + e + i.compress_size]
            raw = comp if i.compress_type == 0 else zlib.decompress(comp, -15) if i.compress_type == 8 else None
            if raw is None:
                raise IOError(f"unsupported compression {i.compress_type} for {i.filename}")
            if zlib.crc32(raw) & 0xFFFFFFFF != i.CRC:
                with slock:
                    stats["crc_fail"] += 1
                continue
            dest = safe_join(out_dir, i.filename)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest + ".part", "wb") as f:
                f.write(raw)
            os.replace(dest + ".part", dest)
            nf += 1
        with slock:
            stats["bytes"] += len(data)
            stats["files"] += nf
            if stats["files"] and stats["files"] % 500 < nf:
                el = time.time() - t0
                log(key, f"{stats['files']}/{len(todo)} members, {stats['bytes'] / 1e6:.0f} MB, {stats['bytes'] / 1e6 / max(el, 1):.2f} MB/s")
        return nf
    with ThreadPoolExecutor(HOST_LIMITS.get(host_class(url), 4)) as ex:
        list(ex.map(do_run, runs))
    if stats["crc_fail"]:
        log(key, f"WARNING {stats['crc_fail']} members failed CRC32 and were not written")
    return {"archive_url": url, "archive_size": rf.size, "members_kept": len(sel), "dropped": dropped,
            "bytes_fetched": stats["bytes"] + rf.bytes_fetched, "crc_fail": stats["crc_fail"],
            "members": [{"name": i.filename, "size": i.file_size, "crc32": f"{i.CRC:08x}"} for i in sel]}


def local_extract(path: str, out_dir: str, rules: dict, key: str) -> dict:
    low = path.lower()
    if low.endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            infos = z.infolist()
            keep, dropped = select_members([(i.filename, i.file_size) for i in infos], rules, key)
            names = {n for n, _ in keep}
            for i in infos:
                if i.filename in names:
                    dest = safe_join(out_dir, i.filename)
                    if os.path.exists(dest) and os.path.getsize(dest) == i.file_size:
                        continue
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    with z.open(i) as src, open(dest, "wb") as dst:
                        shutil.copyfileobj(src, dst, 1 << 20)
            return {"archive": os.path.basename(path), "members_kept": len(keep), "dropped": dropped,
                    "members": [{"name": i.filename, "size": i.file_size, "crc32": f"{i.CRC:08x}"} for i in infos if i.filename in names]}
    # rar / 7z / tar: extract everything into a staging folder, then keep only the wanted images
    stage = out_dir + "__stage"
    os.makedirs(stage, exist_ok=True)
    if os.path.exists(SEVENZIP):
        cmd = [SEVENZIP, "x", "-y", f"-o{stage}", path]
    else:
        cmd = ["tar", "-xf", path, "-C", stage]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"extract failed {path}: {r.stderr[-300:]}")
    allf = []
    for dp, _, fs in os.walk(stage):
        for f in fs:
            full = os.path.join(dp, f)
            allf.append((os.path.relpath(full, stage).replace("\\", "/"), os.path.getsize(full)))
    keep, dropped = select_members(allf, rules, key)
    for n, _ in keep:
        dest = safe_join(out_dir, n)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        os.replace(os.path.join(stage, n), dest)
    shutil.rmtree(stage, ignore_errors=True)
    return {"archive": os.path.basename(path), "members_kept": len(keep), "dropped": dropped,
            "members": [{"name": n, "size": s} for n, s in keep]}


# ------------------------------------------------------------------ verified mirror (transport only)
def mirror_zip_verified(e: dict, root: str) -> dict:
    """Fetch images from a fast CDN mirror zip, keeping only members that match the ORIGINAL deposit byte for byte
    (same file name, size and CRC32 as in the original archives' central directories). The original deposit stays
    the source of record (licence, citation, provenance); the mirror is only transport. Files land under
    x/<original archive stem>/<original member path>, exactly as if extracted from the original."""
    key, rules = e["key"], e.get("fetch") or {}
    m = rules["mirror_zip"]
    originals = list_source(e)
    orig = {}
    for f in originals:
        if not f["path"].lower().endswith(".zip"):
            continue
        hf = HttpRangeFile(f["url"], f.get("size"))
        hf.prefetch_tail()
        z = zipfile.ZipFile(hf)
        stem = os.path.splitext(os.path.basename(f["path"]))[0]
        for i in z.infolist():
            if is_image(i.filename):
                orig[(os.path.basename(i.filename), i.file_size, i.CRC)] = (stem, i.filename)
    log(key, f"original deposit lists {len(orig)} images (name, size, CRC32) in {len(originals)} archives")
    mf = HttpRangeFile(m["url"])
    mf.prefetch_tail()
    mz = zipfile.ZipFile(mf)
    infos = [i for i in mz.infolist() if is_image(i.filename)]
    match = [i for i in infos if (os.path.basename(i.filename), i.file_size, i.CRC) in orig]
    log(key, f"mirror {m['url'][:70]}: {len(infos)} images, {len(match)} match the original byte for byte")
    # cap per original class folder (seeded), then extract matched members from the mirror (CRC re-checked on inflate)
    sel, dropped = select_members([(orig[(os.path.basename(i.filename), i.file_size, i.CRC)][1], i.file_size) for i in match], rules, key)
    keep_orig = {n for n, _ in sel}
    want = {i.filename: orig[(os.path.basename(i.filename), i.file_size, i.CRC)] for i in match
            if orig[(os.path.basename(i.filename), i.file_size, i.CRC)][1] in keep_orig}
    tmp = os.path.join(root, "mirror_tmp")
    # extract only the wanted members (CRC re-checked on inflate), then move each to its original path
    rep = remote_zip_extract(m["url"], None, tmp, {"_names": set(want)}, key)
    moved = 0
    for mname, (stem, opath) in want.items():
        src = safe_join(tmp, mname)
        if os.path.exists(src):
            dst = safe_join(os.path.join(root, "x", stem), opath)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            os.replace(src, dst)
            moved += 1
    shutil.rmtree(tmp, ignore_errors=True)
    return {"mirror_url": m["url"], "mirror_note": m.get("note", ""), "original_images": len(orig),
            "mirror_images": len(infos), "matched_byte_for_byte": len(match), "selected": len(want), "written": moved,
            "dropped": dropped, "crc_fail": rep.get("crc_fail", 0), "bytes_fetched": rep.get("bytes_fetched", 0)}


# ------------------------------------------------------------------ per-source listing
def list_source(e: dict) -> list[dict]:
    src = e["source"]
    rules = e.get("fetch") or {}
    if src == "mendeley":
        files = sources.mendeley_files(e["id"], int(e["version"]))
    elif src == "zenodo":
        files = sources.zenodo_files(sources.zenodo_record(str(e["id"])))
    elif rules.get("urls"):
        files = [{"path": u.rsplit("/", 1)[-1] if "github.com" not in u else e["key"] + ".zip", "size": None, "url": u}
                 for u in rules["urls"]]
    else:
        return []
    out = []
    for f in files:
        p = f["path"]
        if rules.get("files") and not match_any(p, rules["files"]):
            continue
        if match_any(p, rules.get("skip_files")):
            continue
        out.append(f)
    return out


def plan(cfg_path: str, out_dir: str, keys: list[str]):
    import yaml
    cfg = yaml.safe_load(open(cfg_path, encoding="utf-8"))
    os.makedirs(out_dir, exist_ok=True)
    for e in cfg["datasets"]:
        if keys and e["key"] not in keys:
            continue
        if e.get("status") == "reject" or "fetch" not in e:
            continue
        try:
            files = list_source(e)
            rep = {"key": e["key"], "files": files, "zips": {}}
            for f in files:
                if f["path"].lower().endswith(".zip") and f.get("url"):
                    try:
                        rf = HttpRangeFile(f["url"], f.get("size"))
                        z = zipfile.ZipFile(rf)
                        rep["zips"][f["path"]] = [[i.filename, i.file_size] for i in z.infolist()]
                    except Exception as ex:  # noqa: BLE001
                        rep["zips"][f["path"]] = f"ERROR {ex}"[:200]
            json.dump(rep, open(os.path.join(out_dir, e["key"] + ".json"), "w", encoding="utf-8"), ensure_ascii=False)
            nimg = sum(1 for f in files if is_image(f["path"]))
            tot = sum((f.get("size") or 0) for f in files)
            log(f"{e['key']:<30} files {len(files):6d} (images {nimg:6d}) {tot / 1e9:6.2f} GB zips {len(rep['zips'])}")
        except Exception as ex:  # noqa: BLE001
            log(f"{e['key']:<30} PLAN FAILED {str(ex)[:200]}")


# ------------------------------------------------------------------ run one dataset
def fetch_dataset(e: dict, raw_root: str, file_threads: int = 2, streams: int = 2) -> dict:
    key = e["key"]
    root = os.path.join(raw_root, key)
    done_mark = os.path.join(root, "_DONE")
    if os.path.exists(done_mark):
        log(key, "already done")
        return {"key": key, "skipped": True}
    os.makedirs(root, exist_ok=True)
    lock = os.path.join(root, "_LOCK")
    if os.path.exists(lock) and time.time() - os.path.getmtime(lock) < 6 * 3600:
        log(key, "locked by another fetch process; skipped")
        return {"key": key, "skipped": "locked"}
    open(lock, "w").write(str(os.getpid()))
    rules = e.get("fetch") or {}
    t0 = time.time()
    if rules.get("mirror_zip"):
        rep = mirror_zip_verified(e, root)
        report = {"key": key, "source": e["source"], "id": e.get("id"), "version": e.get("version"), "mirror": rep,
                  "finished": time.strftime("%Y-%m-%dT%H:%M:%S"), "seconds": round(time.time() - t0)}
        json.dump(report, open(os.path.join(root, "_fetch.json"), "w", encoding="utf-8"), ensure_ascii=False)
        open(done_mark, "w").write(report["finished"])
        os.remove(lock)
        log(key, f"DONE via verified mirror in {report['seconds']} s: {rep['written']} images")
        return report
    files = list_source(e)
    log(key, f"{len(files)} source files")
    report = {"key": key, "source": e["source"], "id": e.get("id"), "version": e.get("version"),
              "started": time.strftime("%Y-%m-%dT%H:%M:%S"), "files": [], "archives": []}
    singles = [f for f in files if is_image(f["path"])]
    archives = [f for f in files if f["path"].lower().endswith(ARCH_EXT)]
    files_dir = os.path.join(root, "files")
    if (rules.get("cap_per_class") or rules.get("member_regex") or rules.get("skip_members")) and singles:
        singles_sel, _ = select_members([(f["path"], f.get("size")) for f in singles], rules, key)
        sel = {n for n, _ in singles_sel}
        singles = [f for f in singles if f["path"] in sel]

    def one(f):
        dest = safe_join(files_dir, f["path"])
        r = download(f["url"], dest, f.get("size"))
        return {"path": f["path"], "size": r["size"], "sha256_src": f.get("sha256")}
    if singles:
        log(key, f"downloading {len(singles)} single files")
        with ThreadPoolExecutor(max(file_threads, HOST_LIMITS.get(host_class(singles[0]["url"]), 4))) as ex:
            for k, r in enumerate(ex.map(one, singles)):
                report["files"].append(r)
                if (k + 1) % 1000 == 0:
                    log(key, f"{k + 1}/{len(singles)} files")
    for f in archives:
        name = f["path"]
        out_dir = os.path.join(root, "x", os.path.splitext(os.path.basename(name))[0])
        if rules.get("remote_zip") and name.lower().endswith(".zip"):
            r = remote_zip_extract(f["url"], f.get("size"), out_dir, rules, key, streams)
        else:
            dest = os.path.join(root, "archives", os.path.basename(name))
            d = download(f["url"], dest, f.get("size"))
            r = local_extract(dest, out_dir, rules, key)
            r["archive_sha256"] = sha256_file(dest)
            r["archive_size"] = d["size"]
        r["source_path"] = name
        report["archives"].append(r)
    report["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    report["seconds"] = round(time.time() - t0)
    json.dump(report, open(os.path.join(root, "_fetch.json"), "w", encoding="utf-8"), ensure_ascii=False)
    open(done_mark, "w").write(report["finished"])
    os.remove(lock)
    log(key, f"DONE in {report['seconds']} s")
    return report


def run(cfg_path: str, raw_root: str, keys: list[str], max_priority: int = 3, parallel: int = 2, threads: int = 2):
    """Fetch datasets; with explicit keys the queue keeps that order, else priority order.
    Connections in flight <= parallel * threads (the lab link is shared: keep it at 4)."""
    import yaml
    cfg = yaml.safe_load(open(cfg_path, encoding="utf-8"))
    todo = [e for e in cfg["datasets"] if e.get("status") != "reject" and "fetch" in e
            and (e["key"] in keys if keys else e.get("priority", 9) <= max_priority)]
    if keys:
        todo.sort(key=lambda e: keys.index(e["key"]))
    else:
        todo.sort(key=lambda e: e.get("priority", 9))
    log(f"{len(todo)} datasets to fetch:", [e["key"] for e in todo])

    def safe(e):
        try:
            return fetch_dataset(e, raw_root, threads, threads)
        except Exception as ex:  # noqa: BLE001
            log(e["key"], "FAILED", repr(ex)[:300])
            lock = os.path.join(raw_root, e["key"], "_LOCK")
            if os.path.exists(lock) and open(lock).read().strip() == str(os.getpid()):
                os.remove(lock)
            return {"key": e["key"], "error": repr(ex)[:300]}
    with ThreadPoolExecutor(parallel) as ex:
        res = list(ex.map(safe, todo))
    log("all done:", [(r["key"], "error" if r.get("error") else "ok") for r in res])


def main(argv):
    if not argv:
        raise SystemExit(__doc__)
    if argv[0] == "plan":
        plan(argv[1], argv[2], argv[3:])
    elif argv[0] == "run":
        args = argv[1:]
        mp = int(args[args.index("--max-priority") + 1]) if "--max-priority" in args else 3
        par = int(args[args.index("--parallel") + 1]) if "--parallel" in args else 2
        thr = int(args[args.index("--threads") + 1]) if "--threads" in args else 2
        rest = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))]
        run(rest[0], rest[1], rest[2:], mp, par, thr)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
