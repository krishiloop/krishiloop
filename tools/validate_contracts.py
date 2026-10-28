"""Validate KrishiLoop contracts: every schema is valid JSON Schema 2020-12, and every example validates.

Example files are named <schema-name>.<anything>.json or <schema-name>.example.json
(e.g. plan.ok.example.json -> plan.schema.json). credential.schema.json has no example file here:
issued rule credentials and receipts are validated against it, and their proofs verified, by
tests/test_vc.py (the signing code is services/trust/vc.py).
Exit code 0 = all good.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "contracts" / "schemas"
EXAMPLES = ROOT / "contracts" / "examples"


def load_registry() -> tuple[Registry, dict[str, dict]]:
    schemas: dict[str, dict] = {}
    registry = Registry()
    for path in sorted(SCHEMAS.glob("*.schema.json")):
        schema = json.loads(path.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)  # raises if the schema itself is invalid
        schemas[path.name.removesuffix(".schema.json")] = schema
        resource = Resource.from_contents(schema)
        registry = registry.with_resource(schema["$id"], resource)
    return registry, schemas


def main() -> int:
    registry, schemas = load_registry()
    failures = 0
    checked = 0
    for path in sorted(EXAMPLES.glob("*.json")):
        name = path.name.split(".")[0]
        if name not in schemas:
            print(f"SKIP  {path.name}: no schema named {name}")
            continue
        validator = Draft202012Validator(schemas[name], registry=registry, format_checker=FormatChecker())
        instance = json.loads(path.read_text(encoding="utf-8"))
        errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
        checked += 1
        if errors:
            failures += 1
            print(f"FAIL  {path.name}")
            for err in errors[:10]:
                print(f"      at {'/'.join(map(str, err.path)) or '<root>'}: {err.message}")
        else:
            print(f"OK    {path.name}")
    print(f"\n{len(schemas)} schemas valid; {checked} examples checked; {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
