"""Rule packs as code: load YAML rules, resolve reviewer parameters, evaluate conditions, run pack tests."""
from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "rules" / "registry"
OPS = {
    "eq": lambda a, b: a == b, "ne": lambda a, b: a != b,
    "lt": lambda a, b: a < b, "lte": lambda a, b: a <= b, "gt": lambda a, b: a > b, "gte": lambda a, b: a >= b,
    "in": lambda a, b: a in b,
}


class MissingFact(Exception):
    pass


@lru_cache(maxsize=None)
def manifest() -> dict[str, dict]:
    docs = yaml.safe_load((ROOT / "corpus" / "manifest.yaml").read_text(encoding="utf-8"))["documents"]
    return {d["doc_id"]: d for d in docs}


@lru_cache(maxsize=None)
def load_pack(pack_id: str) -> tuple[dict, ...]:
    rules = []
    for path in sorted((REGISTRY / pack_id).glob("*.yaml")):
        text = path.read_text(encoding="utf-8")
        rule = yaml.safe_load(text)
        rule["rule_sha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
        rules.append(rule)
    if not rules:
        raise KeyError(f"unknown or empty pack {pack_id}")
    return tuple(rules)


def pack_parameters(pack_id: str) -> dict[str, Any]:
    """All reviewer-set parameters in a pack (name -> value). Conflicting values are an error."""
    params: dict[str, Any] = {}
    for rule in load_pack(pack_id):
        for p in rule.get("reviewer_parameters", []):
            if p["name"] in params and params[p["name"]] != p["value"]:
                raise ValueError(f"parameter {p['name']} has conflicting values in pack {pack_id}")
            params[p["name"]] = p["value"]
    return params


def _value(v: Any, rule: dict) -> Any:
    if isinstance(v, str) and v.startswith("param:"):
        name = v.split(":", 1)[1]
        for p in rule.get("reviewer_parameters", []):
            if p["name"] == name:
                return p["value"]
        raise KeyError(f"{rule['rule_id']}: parameter {name} not defined")
    return v


def pack_parameter_defs(pack_id: str) -> dict[str, dict]:
    """Full reviewer-parameter records by name (value, unit, set_by, note), for receipts."""
    defs: dict[str, dict] = {}
    for rule in load_pack(pack_id):
        for p in rule.get("reviewer_parameters", []):
            defs.setdefault(p["name"], p)
    return defs


def _cond3(c: dict, facts: dict, rule: dict) -> tuple[bool | None, set[str]]:
    """Kleene three-valued logic: None = unknown because a fact is missing (never treated as False).

    Returns the value and the missing facts that made it unknown (only those that actually matter).
    """
    if "all" in c or "any" in c:
        res = [_cond3(x, facts, rule) for x in c.get("all", c.get("any"))]
        vals = [v for v, _ in res]
        decisive = False if "all" in c else True
        if decisive in vals:
            return decisive, set()
        if None in vals:
            return None, set().union(*(m for v, m in res if v is None))
        return not decisive, set()
    if facts.get(c["fact"]) is None:
        return None, {c["fact"]}
    return bool(OPS[c["op"]](facts[c["fact"]], _value(c["value"], rule))), set()


def evaluate(rule: dict, facts: dict, when: dict | None = None) -> tuple[bool | None, set[str]]:
    """(True | False | None, missing facts). None means the rule might fire but a needed fact is missing."""
    if rule.get("status", "active") != "active":
        return False, set()
    return _cond3(when if when is not None else (rule.get("when") or {"all": []}), facts, rule)


def fires(rule: dict, facts: dict) -> bool:
    """True if the rule's condition holds. Raises MissingFact if the answer depends on a missing fact."""
    result, missing = evaluate(rule, facts)
    if result is None:
        raise MissingFact(sorted(missing)[0])
    return result


def run_pack_tests(pack_id: str) -> list[str]:
    failures = []
    for rule in load_pack(pack_id):
        for t in rule.get("tests", []):
            try:
                got = "fires" if fires(rule, t["facts"]) else "silent"
            except MissingFact as e:
                got = f"missing fact {e}"
            if got != t["expect"]:
                failures.append(f"{rule['rule_id']} test '{t['name']}': expected {t['expect']}, got {got}")
    return failures
