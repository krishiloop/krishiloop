"""Machine-translate a PREVIEW language for the web app (owner, 20 Nov: "an international competition: other languages,
Spanish also?"). It translates the same keys the Hindi and Swahili previews cover (the shared shell, the farmer app and
the verifier); every other key shows English, as for those previews. The result is labelled "preview, machine-translated"
in the language menu and needs a native speaker's review.

  python tools/translate_preview.py es Spanish          (GEMINI_API_KEY[_2.._4] from the environment; never printed)

Reads the English values of the keys in apps/web/src/lib/i18n/sw.{ui,farmer,verify}.ts and writes
apps/web/src/lib/i18n/<code>.{ui,farmer,verify}.ts. Every {placeholder} must survive word for word, or the run fails.
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
I18N = ROOT / "apps" / "web" / "src" / "lib" / "i18n"
API = "https://generativelanguage.googleapis.com/v1beta/models"
MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-lite-latest"]
MODEL = "Gemini"
PAIR = re.compile(r"^  '([^']+)': '((?:[^'\\]|\\.)*)',?\s*$", re.M)
PH = re.compile(r"\{[a-zA-Z0-9_]+\}")


def english() -> dict[str, str]:
    out: dict[str, str] = {}
    for f in glob.glob(str(I18N / "en.*.ts")):
        for k, v in PAIR.findall(Path(f).read_text(encoding="utf-8")):
            out[k] = v.replace("\\'", "'")
    return out


def ask(batch: dict[str, str], language: str, keys: list[str]) -> dict[str, str]:
    prompt = (
        f"Translate these user-interface strings of a farm-advice app for smallholder farmers from English into {language}. "
        "Plain, short, friendly words a farmer understands; keep it formal-neutral. Keep every {placeholder} exactly as "
        "written, keep product names (KrishiLoop, Krishi, QR, SMS, Telegram, DAE, BRRI, CIP, Gemini) and rule ids "
        "(like R-BDR-002) unchanged, keep numbers, and keep the same punctuation style. Answer with ONLY a JSON object "
        "mapping each key to its translation.\n\n" + json.dumps(batch, ensure_ascii=False, indent=0)
    )
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"}}
    last = ""
    for key in keys:
        for model in MODELS:
            req = urllib.request.Request(f"{API}/{model}:generateContent", data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json", "x-goog-api-key": key})
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    d = json.loads(r.read())
                text = "".join(p.get("text", "") for p in d["candidates"][0]["content"]["parts"])
                return json.loads(text[text.index("{"): text.rindex("}") + 1])
            except urllib.error.HTTPError as e:
                last = f"HTTP {e.code} from {model}: " + e.read()[:160].decode(errors="replace").replace(key, "***")
            except (json.JSONDecodeError, ValueError, KeyError) as e:
                last = f"{model}: {type(e).__name__}"
    raise SystemExit(f"no model answered; last: {last}")


def ts(code: str, language: str, part: str, rows: dict[str, str]) -> str:
    def q(s: str) -> str:
        return s.replace("\\", "\\\\").replace("'", "\\'")
    lines = [f"/** {language} copy for {part}: a machine-translated PREVIEW (labelled in the UI; tools/translate_preview.py, "
             f"{MODEL}). Partial: missing keys show English. Spread into {code}.ts. */",
             f"import type {part} from './en.{part}';", "",
             f"const d: Partial<Record<keyof typeof {part}, string>> = {{"]
    lines += [f"  '{k}': '{q(v)}'," for k, v in rows.items()]
    lines += ["};", "", "export default d;", ""]
    return "\n".join(lines)


def main() -> int:
    code, language = sys.argv[1], sys.argv[2]
    keys = [os.environ[n] for n in ("GEMINI_API_KEY_2", "GEMINI_API_KEY_3", "GEMINI_API_KEY_4", "GEMINI_API_KEY") if os.environ.get(n)]
    if not keys:
        print("no GEMINI_API_KEY is set")
        return 2
    en = english()
    for part in ("ui", "farmer", "verify"):
        keys = re.findall(r"^  '([^']+)':", (I18N / f"sw.{part}.ts").read_text(encoding="utf-8"), re.M)
        src = {k: en[k] for k in keys if k in en}
        out: dict[str, str] = {}
        items = list(src.items())
        for i in range(0, len(items), 40):
            batch = dict(items[i:i + 40])
            got = ask(batch, language, keys)
            for k, v in batch.items():
                t = (got.get(k) or "").strip()
                if not t or sorted(PH.findall(t)) != sorted(PH.findall(v)):
                    raise SystemExit(f"{k}: the translation lost or changed a placeholder: {v!r} -> {t!r}")
                out[k] = t
        (I18N / f"{code}.{part}.ts").write_text(ts(code, language, part, out), encoding="utf-8")
        print(f"{code}.{part}.ts: {len(out)} strings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
