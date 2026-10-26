"""The quote check must pass on the real registry and must catch tampering."""
import hashlib
import shutil
from pathlib import Path

import yaml

from tools.check_quotes import check, normalise

ROOT = Path(__file__).resolve().parents[1]


def test_real_registry_passes():
    assert check(ROOT, None) == 0


def test_normalise_handles_line_break_hyphens():
    assert normalise("micro- climates  that") == normalise("microclimates that")


def _copy_repo_subset(tmp_path: Path) -> Path:
    for sub in ("corpus", "rules"):
        shutil.copytree(ROOT / sub, tmp_path / sub)
    return tmp_path


def test_edited_quote_is_caught(tmp_path):
    root = _copy_repo_subset(tmp_path)
    rule_path = next((root / "rules" / "registry").rglob("R-PLB-002.yaml"))
    rule = yaml.safe_load(rule_path.read_text(encoding="utf-8"))
    rule["sources"][0]["quote"] = "Use of certified seed tubers for planting must be guaranteed."  # invented wording
    rule_path.write_text(yaml.safe_dump(rule, sort_keys=False), encoding="utf-8")
    assert check(root, None) == 1  # hash mismatch AND not found


def test_rehashed_invented_quote_is_still_caught(tmp_path):
    root = _copy_repo_subset(tmp_path)
    rule_path = next((root / "rules" / "registry").rglob("R-PLB-002.yaml"))
    rule = yaml.safe_load(rule_path.read_text(encoding="utf-8"))
    fake = "Spray every three days during the season."
    rule["sources"][0].update(quote=fake, quote_sha256=hashlib.sha256(fake.encode()).hexdigest())
    rule_path.write_text(yaml.safe_dump(rule, sort_keys=False), encoding="utf-8")
    assert check(root, None) == 1  # hash ok, but the source never says it


def test_wrong_page_is_caught(tmp_path):
    root = _copy_repo_subset(tmp_path)
    rule_path = next((root / "rules" / "registry").rglob("R-PLB-002.yaml"))
    rule = yaml.safe_load(rule_path.read_text(encoding="utf-8"))
    rule["sources"][0]["page"] = 24
    rule_path.write_text(yaml.safe_dump(rule, sort_keys=False), encoding="utf-8")
    assert check(root, None) == 1
