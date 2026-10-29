"""Download the public model and dataset files used by the voice track (resumable, no keys, no tokens).

Runs on the NBTC 5090. Every source is public and ungated. Files land in plain folders under
F:\\krishiloop-5090\\models\\voice\\<name>\\ so the eval code can load them by path.

The lab link is shared (~10 MB/s). By the lead's decision (29 Oct) the voice downloads run in the window
the phased Ollama pull yields ("=== link yielded to datasets and voice until HH:mm" in its log), with at most
4 parallel range connections per file.

  python download_assets.py --stage window      # wait for the window, then the agreed list, in order
  python download_assets.py --stage overnight   # later, after the Ollama models: Omnilingual CTC-3B-v2, Whisper large-v3
"""
import argparse
import json
import os
import re
import threading
import time

import requests

ROOT = r"F:\krishiloop-5090\models\voice"
HF = "https://huggingface.co/{repo}/resolve/main/{path}"
HFD = "https://huggingface.co/datasets/{repo}/resolve/main/{path}"
FB = "https://dl.fbaipublicfiles.com/mms/{path}"

WHISPER_FILES = ["config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json",
                 "tokenizer_config.json", "vocab.json", "merges.txt", "normalizer.json", "added_tokens.json",
                 "special_tokens_map.json", "model.safetensors"]

# (local folder, url template, repo, [paths])  -- order = the lead's priority order
STAGES = {
    "window": [
        ("fleurs_bn_in", HFD, "google/fleurs", ["data/bn_in/test.tsv", "data/bn_in/audio/test.tar.gz"]),
        ("whisper-large-v3-turbo", HF, "openai/whisper-large-v3-turbo", WHISPER_FILES),
        ("svara-tts-v1", HF, "kenpath/svara-tts-v1", ["config.json", "tokenizer.json", "tokenizer_config.json",
                                                      "special_tokens_map.json", "chat_template.jinja", "README.md"]),
        ("svara-tts-v1-gguf", HF, "mradermacher/svara-tts-v1-GGUF", ["svara-tts-v1.Q8_0.gguf"]),
        ("snac_24khz", HF, "hubertsiuzdak/snac_24khz", ["config.json", "pytorch_model.bin"]),
        ("mms-tts-ben", HF, "facebook/mms-tts-ben", ["config.json", "tokenizer_config.json", "vocab.json",
                                                     "special_tokens_map.json", "model.safetensors", "README.md"]),
        ("omniasr", FB, None, ["omniASR_tokenizer_written_v2.model", "omniASR-CTC-1B-v2.pt"]),
    ],
    "overnight": [
        ("omniasr", FB, None, ["omniASR-CTC-3B-v2.pt"]),
        ("whisper-large-v3", HF, "openai/whisper-large-v3", WHISPER_FILES),
    ],
}

PULL_LOG = r"F:\krishiloop-5090\jobs\pull\log.txt"
_print_lock = threading.Lock()


def log(msg):
    with _print_lock:
        print(time.strftime("%H:%M:%S"), msg, flush=True)


def wait_for_window(max_wait_s):
    t0, warned = time.time(), False
    while time.time() - t0 < max_wait_s:
        try:
            raw = open(PULL_LOG, "rb").read()
            enc = "utf-16" if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8"
            txt = raw.decode(enc, errors="ignore")
            m = re.findall(r"link yielded to datasets and voice until (\d\d:\d\d)", txt)
            if m:
                log(f"window open (pull job says: until {m[-1]})")
                return m[-1]
        except OSError as ex:  # the transcript writer may hold the file; say so once, keep polling
            if not warned:
                log(f"cannot read the pull log yet ({type(ex).__name__}); still waiting")
                warned = True
        time.sleep(20)
    log("no window line seen; starting anyway")
    return None


def remote_size(url):
    r = requests.head(url, allow_redirects=False, timeout=60)
    if r.status_code in (301, 302, 303, 307, 308):
        linked = r.headers.get("X-Linked-Size")
        if linked:
            return int(linked)
        r = requests.head(r.headers["Location"], allow_redirects=True, timeout=60)
    r.raise_for_status()
    return int(r.headers["Content-Length"])


def fetch(url, dest, nconn=4, min_split=64 << 20):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    size = remote_size(url)
    if os.path.exists(dest) and os.path.getsize(dest) == size:
        log(f"have {os.path.basename(dest)} ({size/1e6:.1f} MB)")
        return
    part, meta = dest + ".part", dest + ".parts.json"
    if os.path.exists(meta):
        segs = json.load(open(meta))
    else:
        done0 = os.path.getsize(part) if os.path.exists(part) else 0  # a single-stream partial from earlier
        done0 = min(done0, size)
        with open(part, "ab") as f:
            f.truncate(size)
        rest = size - done0
        n = max(1, min(nconn, rest // min_split)) if rest > 0 else 0
        segs = [[0, done0, done0]] if done0 else []
        step = rest // n if n else 0
        for i in range(n):
            s = done0 + i * step
            e = size if i == n - 1 else s + step
            segs.append([s, e, s])
        json.dump(segs, open(meta, "w"))
    lock = threading.Lock()
    t0 = time.time()
    start_bytes = sum(p - s for s, e, p in segs)

    def worker(i):
        s, e, p = segs[i]
        tries = 0
        while p < e and tries < 30:
            try:
                hdr = {"Range": f"bytes={p}-{e-1}"}
                with requests.get(url, headers=hdr, stream=True, timeout=120) as r:
                    if r.status_code != 206:
                        raise IOError(f"HTTP {r.status_code} for a range request")
                    with open(part, "r+b") as f:
                        f.seek(p)
                        for block in r.iter_content(chunk_size=1 << 20):
                            if not block:
                                continue
                            block = block[: e - p]
                            f.write(block)
                            p += len(block)
                            with lock:
                                segs[i][2] = p
                            if p >= e:
                                break
            except Exception as ex:  # noqa: BLE001 - retry with backoff, keep the bytes we have
                tries += 1
                log(f"  retry {tries} seg {i} of {os.path.basename(dest)}: {type(ex).__name__}: {str(ex)[:120]}")
                time.sleep(min(60, 5 * tries))

    threads = [threading.Thread(target=worker, args=(i,), daemon=True) for i in range(len(segs)) if segs[i][2] < segs[i][1]]
    for t in threads:
        t.start()
    last = time.time()
    while any(t.is_alive() for t in threads):
        time.sleep(2)
        if time.time() - last > 30:
            with lock:
                json.dump(segs, open(meta, "w"))
                got = sum(p - s for s, e, p in segs)
            rate = (got - start_bytes) / max(time.time() - t0, 1e-6)
            log(f"  {os.path.basename(dest)} {got/1e6:.0f}/{size/1e6:.0f} MB  {rate/1e6:.2f} MB/s")
            last = time.time()
    json.dump(segs, open(meta, "w"))
    if any(p < e for s, e, p in segs):
        raise IOError(f"incomplete: {dest}")
    os.replace(part, dest)
    os.remove(meta)
    dt = time.time() - t0
    log(f"ok {os.path.basename(dest)} {size/1e6:.1f} MB in {dt:.0f}s ({(size-start_bytes)/1e6/max(dt,1e-6):.2f} MB/s)")


def run_stage(stage, nconn):
    for folder, tmpl, repo, paths in STAGES[stage]:
        for p in paths:
            url = tmpl.format(repo=repo, path=p)
            dest = os.path.join(ROOT, folder, *p.split("/"))
            for attempt in range(5):
                try:
                    fetch(url, dest, nconn=nconn)
                    break
                except Exception as ex:  # noqa: BLE001
                    log(f"retry file {p}: {type(ex).__name__}: {str(ex)[:160]}")
                    time.sleep(15)
            else:
                log(f"FAILED {url}")
        log(f"done {folder}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=list(STAGES), required=True)
    ap.add_argument("--nconn", type=int, default=4)
    ap.add_argument("--no-wait", action="store_true")
    a = ap.parse_args()
    if a.stage == "window" and not a.no_wait:
        wait_for_window(max_wait_s=3 * 3600)
    run_stage(a.stage, a.nconn)
    log("ALL DONE")
