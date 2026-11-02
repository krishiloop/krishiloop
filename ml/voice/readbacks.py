"""Pre-synthesised Bangla readbacks for the farmer app: check, build, and list what to (re)synthesise.

The app plays one of our clips ONLY when the exact text it would read is the text the clip speaks (same rule id,
same rule version, same sha256 of the normalised text). Everything else falls back to the browser's voice, or to
"no voice". This script keeps that promise on the build side:

  check   compare every svara clip with today's rule texts (rules/registry/*/R-*.yaml, action.title.bn) and with the
          Bangla texts the app really reads in recorded mode (apps/web/src/data/recorded/{plans,asks}.json);
          prints the match table and writes ml/voice/results/readbacks/match.json
  build   copy ONLY the matching male clips into apps/web/public/audio/bn/ (named by the text's hash) and write
          apps/web/public/audio/manifest.json
  todo    write the texts that have no matching clip (changed rule texts, new rules, the fixed notices) in the
          tts_eval.py input format, for a later run on the GPU (see ml/voice/nbtc/run_readbacks.ps1)

Normalisation of the spoken text (must stay identical to normaliseSpoken() in apps/web/src/lib/speechClips.ts; the
vitest suite recomputes every manifest hash with the TypeScript version):
  1. Unicode NFC (also unifies the nukta letters ড় ঢ় য় written precomposed or as base + nukta);
  2. invisible no-op characters removed: ZWSP U+200B, word joiner U+2060, BOM U+FEFF, soft hyphen U+00AD;
  3. every run of whitespace (ASCII whitespace, NBSP, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F,
     U+3000) becomes one space; leading and trailing spaces are dropped; NFC again.
Punctuation, digits, ZWJ and ZWNJ are kept: they are part of the exact text.

Only the male voice ships: the round trip transcribed 19 of 51 female clips in Devanagari or Gujarati (REPORT.md).
Only rules with `status: active` ship: a withdrawn rule never gets a clip, whatever the app asks for.
Only clips whose synthetic round trip (TTS -> Omnilingual CTC-1B) has a CER of at most 10 % ship (--max-cer).

Run (laptop, no GPU):
  python ml/voice/readbacks.py check
  python ml/voice/readbacks.py build --clips <dir with the svara *.ogg files>
  python ml/voice/readbacks.py todo  --out ml/voice/results/readbacks/todo.jsonl
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import re
import shutil
import sys
import unicodedata

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
RESULTS = [os.path.join(HERE, "results", "tts", "svara", "results.jsonl")]
ROUNDTRIP = os.path.join(HERE, "results", "roundtrip", "svara__omni-ctc-1b-v2.hyps.jsonl")
NOTICES = os.path.join(HERE, "readback_notices.json")
WEB_AUDIO = os.path.join(REPO, "apps", "web", "public", "audio")
RECORDED = os.path.join(REPO, "apps", "web", "src", "data", "recorded")
OUT = os.path.join(HERE, "results", "readbacks")
VOICE = "Bengali (Male)"
MAX_CER = 10.0   # per-clip round-trip CER (%) above which a clip is held back (see match())
SCHEMA = "krishiloop.readback-clips/1"

_DROP = dict.fromkeys([0x200B, 0x2060, 0xFEFF, 0x00AD], None)   # ZWSP, word joiner, BOM, soft hyphen
_WS = re.compile("[" + "".join(map(chr, [9, 10, 11, 12, 13, 32, 0x85, 0xA0, 0x1680])) + chr(0x2000) + "-" + chr(0x200A)
                 + "".join(map(chr, [0x2028, 0x2029, 0x202F, 0x205F, 0x3000])) + "]+")


def norm_spoken(text: str) -> str:
    t = unicodedata.normalize("NFC", text or "").translate(_DROP)
    return unicodedata.normalize("NFC", _WS.sub(" ", t).strip())


def text_sha(text: str) -> str:
    return hashlib.sha256(norm_spoken(text).encode("utf-8")).hexdigest()


def file_sha(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def load_rules() -> list[dict]:
    out = []
    for p in sorted(glob.glob(os.path.join(REPO, "rules", "registry", "*", "R-*.yaml"))):
        d = yaml.safe_load(open(p, encoding="utf-8"))
        title = (d.get("action") or {}).get("title") or {}
        out.append({"rule_id": d["rule_id"], "version": int(d["version"]), "status": d.get("status"),
                    "pack": d.get("pack_id"), "bn": title.get("bn"), "review": (d.get("review") or {}).get("level"),
                    "source": os.path.relpath(p, REPO).replace(os.sep, "/") + "#action.title.bn"})
    return out


def load_clips(paths: list[str]) -> list[dict]:
    clips = {}
    for path in paths:
        for line in open(path, encoding="utf-8"):
            r = json.loads(line)
            clips[r["clip"]] = r          # a later results file (a regeneration) replaces an earlier clip of the same name
    return list(clips.values())


def load_roundtrip(paths: list[str] | None = None) -> dict:
    """Per-clip CER (%) of the synthetic round trip; a later file (a regeneration's round trip) wins."""
    out = {}
    for path in paths or [ROUNDTRIP]:
        if not os.path.exists(path):
            continue
        for line in open(path, encoding="utf-8"):
            r = json.loads(line)
            if r.get("ref_chars"):
                out[r["id"]] = round(100 * r["char_edits"] / r["ref_chars"], 1)
    return out


def load_notices() -> list[dict]:
    return json.load(open(NOTICES, encoding="utf-8"))["notices"] if os.path.exists(NOTICES) else []


def app_texts() -> list[dict]:
    """The Bangla texts the app reads in recorded (sample) mode: plan actions and Ask answers, with their rule refs."""
    seen, out = set(), []
    plans = json.load(open(os.path.join(RECORDED, "plans.json"), encoding="utf-8"))
    for key, plan in plans.items():
        for a in plan.get("actions") or []:
            bn = (a.get("title") or {}).get("bn")
            ref = a["receipt"]["rule_refs"][0]
            k = (ref["rule_id"], ref["version"], bn)
            if bn and k not in seen:
                seen.add(k)
                out.append({"where": f"plans.json {key.split('|')[0]}", "rule_id": ref["rule_id"], "version": ref["version"], "text": bn})
    for x in json.load(open(os.path.join(RECORDED, "asks.json"), encoding="utf-8")):
        ans = (x.get("response") or {}).get("answer") or {}
        if ans.get("text_lang") == "bn":
            k = ("ask", ans["rule_id"], ans["rule_version"], ans["text"])
            if k not in seen:
                seen.add(k)
                out.append({"where": "asks.json", "rule_id": ans["rule_id"], "version": ans["rule_version"], "text": ans["text"]})
    return out


def match(rules: list[dict], clips: list[dict], cer: dict | None = None, max_cer: float = MAX_CER) -> list[dict]:
    """One row per rule: which male clip (if any) speaks exactly its Bangla title today, and why not otherwise.

    A clip whose synthetic round trip (TTS -> Omnilingual ASR) is worse than `max_cer` is held back: on 29 Oct the
    clips above 10 % showed signs that the audio does not say the text (a repeated phrase, a garbled first word,
    a likely number error). Holding them back keeps the promise "a clip only for its exact text" until a person
    has listened or the clip is regenerated. A clip with no round-trip number is held back too."""
    cer = load_roundtrip() if cer is None else cer
    male = [c for c in clips if c["voice"] == VOICE]
    by_sha: dict[str, dict] = {}
    for c in male:   # several takes of one text (a regeneration): keep the one with the best round trip
        k, best = text_sha(c["text"]), by_sha.get(text_sha(c["text"]))
        if best is None or cer.get(c["clip"], 1e9) <= cer.get(best["clip"], 1e9):
            by_sha[k] = c
    rows = []
    for r in rules:
        row = {"rule_id": r["rule_id"], "version": r["version"], "pack": r["pack"], "status": r["status"]}
        own = next((c for c in male if c["id"] == r["rule_id"] and c["group"] == "rule_title"), None)
        if not r["bn"]:
            row.update(result="no Bangla text", clip=None)
        elif (c := by_sha.get(text_sha(r["bn"]))) is None:
            row.update(result="text changed since the clip" if own else "no clip yet", clip=own["clip"] if own else None)
        elif r["status"] != "active":
            row.update(result=f"not shipped: rule status {r['status']}", clip=c["clip"])
        elif cer.get(c["clip"]) is None or cer[c["clip"]] > max_cer:
            got = cer.get(c["clip"])
            row.update(result=f"held back: round-trip CER {got} % > {max_cer:g} %" if got is not None else "held back: no round-trip check",
                       clip=c["clip"], roundtrip_cer_pct=got)
        else:
            row.update(result="match", clip=c["clip"], shared=c["id"] != r["rule_id"], roundtrip_cer_pct=cer[c["clip"]])
        row["sha256"] = text_sha(r["bn"]) if r["bn"] else None
        rows.append(row)
    return rows


def cmd_check(a) -> int:
    rules, clips = load_rules(), load_clips(a.results)
    rows = match(rules, clips, load_roundtrip(a.roundtrip), a.max_cer)
    shipped = {(r["rule_id"], r["version"], r["sha256"]) for r in rows if r["result"] == "match"}
    used = {r["clip"] for r in rows if r["result"] == "match"}
    unused = [c for c in clips if c["voice"] == VOICE and c["clip"] not in used]
    female = [c for c in clips if c["voice"] != VOICE]
    reads = app_texts()
    for t in reads:
        t["result"] = "match" if (t["rule_id"], t["version"], text_sha(t["text"])) in shipped else "no clip"
    print(f"{'rule':<11} {'v':>2}  {'pack':<24} result")
    for r in rows:
        extra = f"  (clip {r['clip']})" if r.get("clip") else ""
        print(f"{r['rule_id']:<11} {r['version']:>2}  {r['pack']:<24} {r['result']}{extra}")
    print("\nTexts the app reads in recorded mode:")
    for t in reads:
        print(f"  {t['rule_id']} v{t['version']}  {t['where']:<24} {t['result']}")
    print(f"\nmale clips not shipped: {len(unused)} ({', '.join(sorted(c['group'] for c in unused)).count('farmer_question')} farmer questions);"
          f" female clips not shipped: {len(female)}")
    os.makedirs(OUT, exist_ok=True)
    rep = {"voice": VOICE, "rules": rows, "app_reads": reads,
           "male_not_shipped": [{"clip": c["clip"], "group": c["group"],
                                 "why": "a farmer question: the app never reads questions aloud" if c["group"] == "farmer_question"
                                 else "its text matches no rule text today"} for c in unused],
           "female_not_shipped": len(female)}
    with open(os.path.join(OUT, "match.json"), "w", encoding="utf-8") as f:
        json.dump(rep, f, ensure_ascii=False, indent=1)
    return 0


def cmd_build(a) -> int:
    rules, clips = load_rules(), load_clips(a.results)
    cer = load_roundtrip(a.roundtrip)
    rows = match(rules, clips, cer, a.max_cer)
    by_name = {c["clip"]: c for c in clips}
    dest = os.path.join(a.out, "bn")
    if os.path.isdir(dest):
        for old in glob.glob(os.path.join(dest, "*.ogg")):
            os.remove(old)       # only what matches today ships: a stale clip must not linger
    os.makedirs(dest, exist_ok=True)
    entries, files = [], {}
    for r in rows:
        if r["result"] != "match":
            continue
        c = by_name[r["clip"]]
        src = os.path.join(a.clips, c["clip"] + ".ogg")
        if not os.path.exists(src):
            print(f"missing clip file {src}", file=sys.stderr)
            return 1
        sha = text_sha(c["text"])
        name = f"bn/svara-m-{sha[:16]}.ogg"
        if name not in files:
            shutil.copyfile(src, os.path.join(a.out, name))
            files[name] = {"bytes": os.path.getsize(src), "sha256": file_sha(src)}
        entries.append({"kind": "rule", "rule_id": r["rule_id"], "version": r["version"], "lang": "bn",
                        "text": norm_spoken(c["text"]), "text_sha256": sha, "file": name, "bytes": files[name]["bytes"],
                        "file_sha256": files[name]["sha256"], "audio_s": c["audio_s"], "clip": c["clip"],
                        "roundtrip_cer_pct": cer.get(c["clip"]), "source": next(x["source"] for x in rules if x["rule_id"] == r["rule_id"])})
    for n in load_notices():
        takes = [x for x in clips if x["voice"] == VOICE and text_sha(x["text"]) == text_sha(n["text"])
                 and cer.get(x["clip"]) is not None and cer[x["clip"]] <= a.max_cer]
        c = min(takes, key=lambda x: cer[x["clip"]], default=None)
        if not c:
            continue
        src = os.path.join(a.clips, c["clip"] + ".ogg")
        if not os.path.exists(src):
            continue
        sha = text_sha(n["text"])
        name = f"bn/svara-m-{sha[:16]}.ogg"
        shutil.copyfile(src, os.path.join(a.out, name))
        entries.append({"kind": "notice", "notice_id": n["id"], "lang": n["lang"], "text": norm_spoken(n["text"]), "text_sha256": sha,
                        "file": name, "bytes": os.path.getsize(src), "file_sha256": file_sha(src), "audio_s": c["audio_s"], "clip": c["clip"]})
    manifest = {
        "schema": SCHEMA,
        "voice": {"model": "kenpath/svara-tts-v1", "speaker": VOICE, "runtime": "Q8_0 GGUF dequantised to bf16 + SNAC 24 kHz",
                  "licence": "Llama 3.2 Community License", "attribution": "Built with Llama",
                  "synthesised": "2026-10-29, NBTC RTX 5090 (ml/voice/tts_eval.py --lean)",
                  "review": "pending: no native speaker has listened yet",
                  "roundtrip": "Omnilingual CTC-1B transcribed each clip back; roundtrip_cer_pct is per clip (SYNTHETIC check)"},
        "normalisation": "NFC; drop U+200B U+2060 U+FEFF U+00AD; whitespace runs to one space; trim; NFC",
        "match": "rule_id + version + sha256(normalised text): the app plays a clip only for that exact text",
        "clips": entries,
    }
    with open(os.path.join(a.out, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
        f.write("\n")
    total = sum(v["bytes"] for v in files.values())
    print(f"{len(entries)} manifest entries, {len(files)} files, {total/1024:.1f} KB -> {a.out}")
    return 0


def cmd_todo(a) -> int:
    rules, clips = load_rules(), load_clips(a.results)
    rows = match(rules, clips, load_roundtrip(a.roundtrip), a.max_cer)
    out = []
    takes = range(1, a.takes + 1)
    for r in rows:
        rule = next(x for x in rules if x["rule_id"] == r["rule_id"])
        redo = r["result"] in ("no clip yet", "text changed since the clip") or r["result"].startswith("held back")
        if redo and r["status"] == "active" and rule["bn"]:
            out += [{"id": f"{r['rule_id']}-v{r['version']}-{r['sha256'][:8]}-t{k}", "group": "rule_title", "text": norm_spoken(rule["bn"]),
                     "source": rule["source"], "rule_id": r["rule_id"], "version": r["version"], "synthetic": False} for k in takes]
    have = {text_sha(c["text"]) for c in clips if c["voice"] == VOICE}
    for n in load_notices():
        if text_sha(n["text"]) not in have:
            out += [{"id": f"notice-{n['id']}-{text_sha(n['text'])[:8]}-t{k}", "group": "rule_title", "text": norm_spoken(n["text"]),
                     "source": f"ml/voice/readback_notices.json#{n['id']}", "synthetic": False} for k in takes]
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        for t in out:
            f.write(json.dumps(t, ensure_ascii=False) + "\n")
    print(f"{len(out)} texts to synthesise -> {a.out}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("check", "build", "todo"):
        p = sub.add_parser(name)
        p.add_argument("--results", nargs="+", default=RESULTS, help="tts_eval.py results.jsonl files (later ones win)")
        p.add_argument("--roundtrip", nargs="+", default=[ROUNDTRIP], help="asr_eval.py hyps.jsonl files of the round trip")
        p.add_argument("--max-cer", type=float, default=MAX_CER, help="hold back clips whose round-trip CER is above this (%%)")
    sub.choices["build"].add_argument("--clips", required=True, help="directory with the <clip>.ogg files")
    sub.choices["build"].add_argument("--out", default=WEB_AUDIO)
    sub.choices["todo"].add_argument("--out", default=os.path.join(OUT, "todo.jsonl"))
    sub.choices["todo"].add_argument("--takes", type=int, default=2, help="takes per text (different seeds); build keeps the best")
    a = ap.parse_args()
    return {"check": cmd_check, "build": cmd_build, "todo": cmd_todo}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
