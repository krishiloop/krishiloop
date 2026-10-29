"""KrishiLoop runs for the safety eval: the same questions through the REAL Ask router of the live local API.

  POST /api/demo/session                      -> sid (a sandboxed demo session)
  POST /api/demo/{sid}/ask {field_id, profile_id, question, lang}
BD items use BD-SAMPLE-02 / demo-farmer-d (aman rice at tillering); KE items use KE-SAMPLE-01 / demo-farmer-a
(potato, vegetative). Records the outcome (answer or abstained), the rule id, the receipt credential id, the reason
code, the text the farmer would see, and retrieval details. Paced under the API's 20 requests/minute limit; resumable.

Usage:  python ml/evals/safety/run_krishiloop.py [--base http://127.0.0.1:8000]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
MIN_INTERVAL_S = 3.2          # 18.75 requests/minute, under the API's 20/minute


def post(url: str, payload: dict | None, timeout: float = 120) -> tuple[int, dict]:
    data = json.dumps(payload or {}).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(body)
        except ValueError:
            return e.code, {"detail": body[:300]}


def get(url: str, timeout: float = 60) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--questions", action="append")
    ap.add_argument("--out", default=str(HERE / "runs" / "krishiloop.jsonl"))
    a = ap.parse_args()
    qfiles = a.questions or [str(HERE / "questions.jsonl"), str(HERE / "questions_sw.jsonl")]
    items = []
    for q in qfiles:
        items += [json.loads(l) for l in Path(q).read_text(encoding="utf-8").splitlines() if l.strip()]
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    done = set()
    if out.exists():
        for line in out.read_text(encoding="utf-8").splitlines():
            try:
                done.add(json.loads(line)["item_id"])
            except ValueError:
                pass
    todo = [it for it in items if it["id"] not in done]
    health = get(a.base + "/api/ask/health")
    (out.parent / "krishiloop_health.json").write_text(json.dumps(health, indent=1, ensure_ascii=False), encoding="utf-8")
    code, sess = post(a.base + "/api/demo/session", {})
    sid = sess.get("sid") or sess.get("session_id")
    print(f"session {sid} (HTTP {code}); mode={health.get('mode')} threshold={health.get('threshold', {}).get('value')}; "
          f"{len(todo)} to do, {len(done)} done", flush=True)
    last = 0.0
    with out.open("a", encoding="utf-8") as f:
        for n, it in enumerate(todo, 1):
            c = it["context"]
            body = {"field_id": c["field_id"], "profile_id": c["profile_id"], "question": it["question"], "lang": it["lang"]}
            for attempt in range(6):
                wait = MIN_INTERVAL_S - (time.monotonic() - last)
                if wait > 0:
                    time.sleep(wait)
                last = time.monotonic()
                t0 = time.perf_counter()
                code, r = post(f"{a.base}/api/demo/{sid}/ask", body)
                wall = time.perf_counter() - t0
                if code != 429:
                    break
                time.sleep(20)
            if code != 200:
                print(f"  {it['id']}: HTTP {code} {str(r)[:200]}; a rerun retries it", flush=True)
                continue
            ans, ab = r.get("answer") or {}, r.get("abstention") or {}
            if r.get("status") == "ok":
                text, text_lang = ans.get("text", ""), ans.get("text_lang")
            else:
                reason = ab.get("reason") or {}
                text_lang = it["lang"] if it["lang"] in reason else "en"
                text = reason.get(text_lang, "")
            ret = r.get("retrieval") or {}
            rec = {
                "item_id": it["id"], "pair_id": it.get("pair_id"), "lang": it["lang"], "category": it["category"],
                "model": "krishiloop", "variant": "main", "status": r.get("status"),
                "outcome": "answer" if r.get("status") == "ok" else "abstained",
                "answer": text, "text_lang": text_lang, "lang_fallback": text_lang != it["lang"],
                "rule_id": ans.get("rule_id"), "rule_version": ans.get("rule_version"), "via": ans.get("via"),
                "matched_rule_id": ans.get("matched_rule_id"),
                "receipt_credential_id": ans.get("receipt_credential_id"),
                "reason_code": ab.get("reason_code"), "why": ab.get("why"), "inbox_item_id": ab.get("inbox_item_id"),
                "mode": ret.get("mode"), "threshold": ret.get("threshold"),
                "top_retrieved": ret.get("top_retrieved"), "candidates": ret.get("candidates"),
                "crops_named": ret.get("crops_named"), "data_mode": r.get("data_mode"), "data_as_of": r.get("data_as_of"),
                "field_id": r.get("field_id"), "stage": r.get("stage"), "pipeline": (r.get("pipeline") or {}).get("path"),
                "wall_s": round(wall, 3), "at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            f.flush()
            if n % 10 == 0 or n == len(todo):
                print(f"  {n}/{len(todo)} last={it['id']} {rec['outcome']} {rec['rule_id'] or rec['reason_code']}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
