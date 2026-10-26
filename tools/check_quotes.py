"""Quote-integrity check for the rule registry (Constitution Art. 1 & 6).

For every rule in rules/registry/**/*.yaml and every source quote:
  1. quote_sha256 == sha256(quote)                      (the quote was not edited after hashing)
  2. the doc_id exists in corpus/manifest.yaml          (no unknown sources)
  3. if the document text is available (committed corpus/text/ or --private-dir), the quote occurs
     VERBATIM (after whitespace / line-break-hyphen normalisation) on the declared page
  4. documents with licence_status 'cited_permission_requested' only allow quotes of <= 25 words
Exit 1 on any failure. Quotes whose source text is not available are reported as UNVERIFIED-IN-CI
(allowed only for 'cited_permission_requested' documents, which must then be checked locally).

Note: this proves a quote exists where we say it does. It does NOT prove the rule encodes it
correctly; that is what PR review (team/expert) is for.
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
import unicodedata
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFC", text).replace("­", "")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"(\w)- (\w)", r"\1\2", text)  # undo line-break hyphenation, applied to quote and source alike
    return text.strip()


def load_pages(path: Path) -> dict[int, str]:
    raw = path.read_text(encoding="utf-8")
    pages = {int(n): normalise(body) for n, body in re.findall(r"=== PAGE (\d+) ===\n(.*?)(?==== PAGE |\Z)", raw, re.S)}
    if not pages:  # un-paged text: treat everything as page 0
        pages = {0: normalise(raw)}
    return pages


def check(root: Path, private_dir: Path | None) -> int:
    manifest = yaml.safe_load((root / "corpus" / "manifest.yaml").read_text(encoding="utf-8"))
    docs = {d["doc_id"]: d for d in manifest["documents"]}
    page_cache: dict[str, dict[int, str] | None] = {}

    def pages_for(doc_id: str):
        if doc_id not in page_cache:
            doc = docs[doc_id]
            candidates = [root / doc["text"]] if doc.get("text") else []
            if private_dir:
                candidates.append(private_dir / f"{doc_id}.txt")
            found = next((c for c in candidates if c.exists()), None)
            page_cache[doc_id] = load_pages(found) if found else None
        return page_cache[doc_id]

    failures, verified, unverified, rules = [], 0, 0, 0
    for path in sorted((root / "rules" / "registry").rglob("*.yaml")):
        rule = yaml.safe_load(path.read_text(encoding="utf-8"))
        rules += 1
        rid = rule.get("rule_id", path.stem)
        for src in rule.get("sources", []):
            quote, doc_id = src["quote"], src["doc_id"]
            if hashlib.sha256(quote.encode("utf-8")).hexdigest() != src.get("quote_sha256"):
                failures.append(f"{rid}: quote_sha256 does not match the quote text")
            if doc_id not in docs:
                failures.append(f"{rid}: unknown doc_id {doc_id} (add it to corpus/manifest.yaml)")
                continue
            status = docs[doc_id]["licence_status"]
            if status == "cited_permission_requested" and len(quote.split()) > 25:
                failures.append(f"{rid}: quote from {doc_id} exceeds 25 words (permission still pending)")
            pages = pages_for(doc_id)
            if pages is None:
                if status == "cited_permission_requested":
                    unverified += 1
                    print(f"UNVERIFIED-IN-CI  {rid} ({doc_id} p.{src['page']}): text not committed; run locally with --private-dir")
                else:
                    failures.append(f"{rid}: no text available for {doc_id} (status {status}) - commit corpus text")
                continue
            q = normalise(quote)
            page = int(src["page"]) if str(src["page"]).isdigit() else 0
            if q in pages.get(page, ""):
                verified += 1
            elif any(q in body for body in pages.values()):
                failures.append(f"{rid}: quote found in {doc_id} but NOT on declared page {src['page']}")
            else:
                failures.append(f"{rid}: quote NOT FOUND in {doc_id}: \"{quote[:70]}...\"")
    for f in failures:
        print("FAIL ", f)
    print(f"\n{rules} rules · {verified} quotes verified verbatim · {unverified} unverified-in-CI · {len(failures)} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--private-dir", type=Path, default=None, help="folder with <doc_id>.txt for documents not committed")
    args = ap.parse_args()
    sys.exit(check(args.root, args.private_dir))
