"""Start the KrishiLoop API for the sovereign benchmark: 127.0.0.1 only, a throwaway signing key, no outbound calls.

Run from the repo root with the repo's environment:
  python ml/sovereign/serve.py --port 8100 [--stop-file F:/.../STOP] [--max-minutes 180] [--report out.json]

What it sets up (and why):
- Signing key. services/trust reads a 32-byte Ed25519 seed from KRISHILOOP_ISSUER_SEED; there is no key file. This
  launcher always replaces it with a fresh random seed made in memory (secrets.token_hex(32)), whatever the parent
  environment holds. It is never written, logged or printed, and it dies with the process, so everything this server
  signs is a throwaway development receipt under the local identity did:web:127.0.0.1%3A<port> (PUBLIC_BASE_URL is
  forced to the local address; ISSUER_DID is removed). ADMIN_TOKEN is random in the same way (no admin calls).
- No cloud. HTTP_PROXY and HTTPS_PROXY point every urllib/httpx call of this process at a local "refuse" proxy in this
  same process. It answers every request with 403 at once and records which host was asked for. The Open-Meteo fetch
  therefore fails immediately and the planner takes its own offline path: the last saved snapshot of each demo field
  in data/snapshots (a stale one makes the plan abstain, as in production). The Ask router and the photo model are
  local files. The list of refused hosts is written to --report at exit, as evidence.
- Client identity. uvicorn takes the client address from X-Forwarded-For only when the connection comes from
  127.0.0.1 (proxy_headers, forwarded_allow_ips="127.0.0.1": the same setting as behind a reverse proxy). The
  benchmark gives each simulated farmer its own address, so the API's per-client limit (20 requests a minute) applies
  per farmer, as it would in the field.
- Access logging is off (as for the laptop baseline), so the numbers measure the API, not console output.
- It stops by itself when --stop-file appears or after --max-minutes, so the lab PC's one-shot job always ends.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import socketserver
import sys
import threading
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class _Refuse(socketserver.BaseRequestHandler):
    hosts: Counter = Counter()

    def handle(self):
        try:
            line = self.request.recv(4096).split(b"\r\n", 1)[0].decode("latin-1")
            parts = line.split()
            target = parts[1] if len(parts) > 1 else "?"
            host = target.split("//")[-1].split("/")[0].split(":")[0]
            _Refuse.hosts[host] += 1
            self.request.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        except OSError:
            pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8100)
    ap.add_argument("--stop-file", default="")
    ap.add_argument("--max-minutes", type=float, default=180)
    ap.add_argument("--report", default="")
    ap.add_argument("--fresh", action="store_true",
                    help="move data/demo, data/trust and data/inbox aside first (a fresh key cannot verify an old store)")
    args = ap.parse_args()

    if args.fresh:   # benchmark workspaces only: the old folders are kept under data/_previous/<time>, never deleted
        keep = ROOT / "data" / "_previous" / time.strftime("%Y%m%dT%H%M%S")
        for name in ("demo", "trust", "inbox"):
            if (ROOT / "data" / name).exists():
                keep.mkdir(parents=True, exist_ok=True)
                os.replace(ROOT / "data" / name, keep / name)

    refuse = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _Refuse)
    refuse.daemon_threads = True
    threading.Thread(target=refuse.serve_forever, daemon=True).start()
    proxy = f"http://127.0.0.1:{refuse.server_address[1]}"
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        os.environ[k] = proxy
    for k in ("NO_PROXY", "no_proxy"):
        os.environ.pop(k, None)
    os.environ["HF_HUB_OFFLINE"] = "1"
    # Always a local identity and a fresh key, whatever the parent environment holds: a benchmark never signs with a
    # real key or under the public did:web name.
    os.environ["PUBLIC_BASE_URL"] = f"http://127.0.0.1:{args.port}"
    os.environ.pop("ISSUER_DID", None)
    os.environ["KRISHILOOP_ISSUER_SEED"] = secrets.token_hex(32)     # throwaway: memory only
    os.environ["ADMIN_TOKEN"] = secrets.token_urlsafe(24)

    sys.path.insert(0, str(ROOT))
    os.chdir(ROOT)
    import uvicorn
    config = uvicorn.Config("services.api.main:app", host="127.0.0.1", port=args.port, workers=1, access_log=False,
                            proxy_headers=True, forwarded_allow_ips="127.0.0.1", log_level="warning")
    server = uvicorn.Server(config)
    started = time.time()

    def watch():
        while not server.should_exit:
            if (args.stop_file and Path(args.stop_file).exists()) or time.time() - started > args.max_minutes * 60:
                print("serve.py: stop requested", flush=True)
                server.should_exit = True
            time.sleep(1)
    threading.Thread(target=watch, daemon=True).start()
    print(f"serve.py: http://127.0.0.1:{args.port} (outbound calls refused via {proxy}); "
          f"KRISHILENS_DIR={os.environ.get('KRISHILENS_DIR', '')} "
          f"KRISHILENS_PROVIDERS={os.environ.get('KRISHILENS_PROVIDERS', '(unset)')} "
          f"KRISHILOOP_ASK_MODELS={os.environ.get('KRISHILOOP_ASK_MODELS', '')}", flush=True)
    try:
        server.run()
    finally:
        refuse.shutdown()
        if args.report:
            Path(args.report).write_text(json.dumps({
                "outbound_requests_refused": dict(_Refuse.hosts), "uptime_s": round(time.time() - started, 1),
                "signing_key": "fresh random seed generated in memory at start; never stored or printed"}, indent=1),
                encoding="utf-8")
        print(f"serve.py: stopped; outbound requests refused: {dict(_Refuse.hosts)}", flush=True)


if __name__ == "__main__":
    main()
