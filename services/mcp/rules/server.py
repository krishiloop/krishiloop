"""KrishiLoop rules MCP server: the rule packs as data, each rule with its sources, page and verbatim quote. Read-only.

- list_packs: packs with crops, rules, review levels, source documents (with licence status) and pack-test results;
- get_rule: one rule with its condition, action, reviewer parameters, review status and every source;
- search_rules: deterministic keyword search over rule text, conditions, parameters and source quotes (no model).

A rule is knowledge, not advice for a field: only the deterministic planner decides which rules apply, and it signs a
receipt for every action it serves. Needs no secret.

Run:  python -m services.mcp.rules [--transport stdio|http] [--port 8104]
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

if __package__ in (None, ""):  # run as a script (python services/mcp/rules/server.py): make `services` importable
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from collections import Counter
from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

from services.engine.rules import REGISTRY, load_pack, manifest, run_pack_tests
from services.mcp import stores
from services.mcp.common import READ_LOCAL, serve

RULE_ID = re.compile(r"^R-[A-Z]{2,8}-[0-9]{3}$")
RULE_NOTE = ("A rule is knowledge, not advice for a field: it applies only when its condition holds, as decided by "
             "KrishiLoop's deterministic planner, which signs a receipt for every action it serves.")
QUOTE_INTEGRITY = ("tools/check_quotes.py (run in CI) checks every quote's sha256 and that the quote occurs verbatim "
                   "on the declared page whenever the document's text is available; quotes from documents whose text "
                   "is not committed are reported as UNVERIFIED-IN-CI and checked locally.")

server = MCPServer(
    "krishiloop-rules", title="KrishiLoop rule packs", version="0.2.0",
    instructions="Read-only. KrishiLoop's rule packs as data: list the packs, read a rule with its source document, "
                 "page and verbatim quote, or search the rules by keyword (English or Bangla). A rule is knowledge, "
                 "not advice for a field: only KrishiLoop's deterministic planner applies rules, with receipts.")


def _packs() -> list[str]:
    return sorted(p.name for p in REGISTRY.iterdir() if p.is_dir())


def _recalls() -> dict:
    """Rule versions recalled in the official store (plain state; no secret needed)."""
    return stores.read_state(stores.official_dir()).get("recalls", {})


def _fold(text: str) -> str:
    return unicodedata.normalize("NFC", text).casefold()


def _search_fields(rule: dict) -> dict[str, str]:
    """The text of a rule a keyword search looks at, by field name."""
    docs = manifest()
    action = rule["action"]
    return {
        "rule_id": rule["rule_id"], "crop": rule.get("crop", ""),
        "title": " ".join(action.get("title", {}).values()),
        "action": " ".join(str(action.get(k, "")) for k in ("kind", "decision", "traffic_light")),
        "condition": json.dumps(rule.get("when") or {}, ensure_ascii=False),
        "parameters": " ".join(f"{p['name']} {p.get('note', '')}" for p in rule.get("reviewer_parameters", [])),
        "basis_note": rule.get("basis_note", ""),
        "quote": " ".join(s["quote"] for s in rule["sources"]),
        "source": " ".join(f"{s['doc_id']} {docs[s['doc_id']]['title']} {docs[s['doc_id']]['publisher']}"
                           for s in rule["sources"]),
    }


@server.tool(annotations=READ_LOCAL, structured_output=True)
def list_packs() -> dict[str, Any]:
    """The rule packs (crop, rules, review levels, source documents and their licence status) and whether each
    pack's own tests pass. Packs are data: a new crop or country is a new pack, not new engine code."""
    docs, recalls, out = manifest(), _recalls(), []
    for pack_id in _packs():
        rules = load_pack(pack_id)
        failures = run_pack_tests(pack_id)
        doc_ids = sorted({s["doc_id"] for r in rules for s in r["sources"]})
        out.append({
            "pack_id": pack_id, "crops": sorted({r.get("crop", "") for r in rules}), "rule_count": len(rules),
            "review_levels": dict(sorted(Counter(r.get("review", {}).get("level", "pending") for r in rules).items())),
            "rules": [{"rule_id": r["rule_id"], "version": r["version"], "status": r.get("status", "active"),
                       "kind": r["action"]["kind"], "traffic_light": r["action"].get("traffic_light"),
                       "review_level": r.get("review", {}).get("level", "pending"),
                       "recalled_in_official_store": f"{r['rule_id']}@{r['version']}" in recalls} for r in rules],
            "source_documents": [{"doc_id": d, "title": docs[d]["title"], "publisher": docs[d]["publisher"],
                                  "licence_status": docs[d]["licence_status"]} for d in doc_ids],
            "pack_tests": {"passed": not failures, "failures": failures},
        })
    return {"packs": out, "signatures": "planned: pack signatures come from the Knowledge Compiler (not built yet)"}


@server.tool(annotations=READ_LOCAL, structured_output=True)
def get_rule(
    rule_id: Annotated[str, Field(description="Rule id as listed by list_packs, e.g. R-PLB-008")],
    version: Annotated[int | None, Field(ge=1, description="Rule version; the latest if omitted")] = None,
) -> dict[str, Any]:
    """One rule with its condition, action, reviewer-set parameters, review status and every source: document,
    publisher, link, page, verbatim quote, quote hash, licence status and acknowledgement."""
    if not RULE_ID.fullmatch(rule_id):
        raise ToolError("rule_id must look like R-PLB-008")
    matches = [r for pack in _packs() for r in load_pack(pack) if r["rule_id"] == rule_id]
    if not matches:
        raise ToolError(f"unknown rule {rule_id}")
    if version is None:
        rule = max(matches, key=lambda r: r["version"])
    else:
        rule = next((r for r in matches if r["version"] == version), None)
        if rule is None:
            raise ToolError(f"{rule_id} has no version {version}; it has {sorted(r['version'] for r in matches)}")
    docs = manifest()
    sources = []
    for s in rule["sources"]:
        d = docs[s["doc_id"]]
        sources.append({"doc_id": s["doc_id"], "title": d["title"], "publisher": d["publisher"], "url": d["url"],
                        "page": s["page"], "quote": s["quote"], "quote_sha256": s["quote_sha256"],
                        "language": d.get("language", "en"), "licence_status": d["licence_status"],
                        "licence_note": d.get("licence_note", ""), "acknowledgement": d.get("acknowledgement", "")})
    return {"note": RULE_NOTE, "rule_id": rule["rule_id"], "version": rule["version"], "pack_id": rule["pack_id"],
            "status": rule.get("status", "active"), "crop": rule.get("crop"), "condition": rule.get("when"),
            "action": rule["action"], "sources": sources, "quote_integrity": QUOTE_INTEGRITY,
            "reviewer_parameters": rule.get("reviewer_parameters", []), "review": rule.get("review", {}),
            "basis_note": rule.get("basis_note"), "rule_sha256": rule["rule_sha256"],
            "pack_tests": len(rule.get("tests", [])),
            "recall_in_official_store": _recalls().get(f"{rule['rule_id']}@{rule['version']}")}


@server.tool(annotations=READ_LOCAL, structured_output=True)
def search_rules(
    query: Annotated[str, Field(min_length=1, max_length=200, description="Keywords, English or Bangla; every word "
                                                                         "must match (case-insensitive)")],
    pack_id: Annotated[str | None, Field(description="Only this pack (see list_packs)")] = None,
    limit: Annotated[int, Field(ge=1, le=50, description="Most rules to return")] = 10,
) -> dict[str, Any]:
    """Find rules whose title, decision, condition, parameters, basis note, source quote or source document contain
    every keyword. Plain word matching, no model; results rank title matches first. Use get_rule for the full rule."""
    terms = [_fold(t) for t in query.split()]
    packs = _packs()
    if pack_id is not None and pack_id not in packs:
        raise ToolError(f"unknown pack {pack_id!r}; known packs: {', '.join(packs)}")
    hits = []
    for pack in [pack_id] if pack_id else packs:
        for rule in load_pack(pack):
            fields = {k: _fold(v) for k, v in _search_fields(rule).items()}
            if not all(any(t in v for v in fields.values()) for t in terms):
                continue
            matched = sorted(k for k, v in fields.items() if any(t in v for t in terms))
            title = rule["action"].get("title", {})
            hits.append(((-sum(t in fields["title"] for t in terms), -len(matched), rule["rule_id"]), {
                "rule_id": rule["rule_id"], "version": rule["version"], "pack_id": rule["pack_id"],
                "crop": rule.get("crop"), "kind": rule["action"]["kind"], "decision": rule["action"].get("decision"),
                "traffic_light": rule["action"].get("traffic_light"),
                "title": title.get("en") or next(iter(title.values()), ""),
                "matched_in": matched, "sources": [f"{s['doc_id']} p.{s['page']}" for s in rule["sources"]]}))
    hits.sort(key=lambda h: h[0])
    return {"note": RULE_NOTE, "query": query, "total": len(hits), "rules": [h for _, h in hits[:limit]]}


def main(argv: list[str] | None = None) -> None:
    serve(server, 8104, argv)


if __name__ == "__main__":
    main()
