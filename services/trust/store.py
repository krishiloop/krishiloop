"""Persistent credential store: issuer key, rule credentials (one per rule version), receipts, recall registry.

Safety properties (each covered by tests):
- one folder per issuer DID, so switching identity never resets or reuses another identity's status list;
- one lock around issuance, recall and state writes; files are written atomically;
- a recall is recorded by rule version even before that version was ever issued, and a recalled
  version is never issued again (the planner skips it);
- credential ids must be UUIDs, so a request can never name a file outside the store.
"""
from __future__ import annotations

import json
import os
import re
import threading
import uuid
from pathlib import Path

from services.trust.vc import Issuer, StatusList, issue_credential, now_iso, verify_key_from_multibase, verify_receipt

ROOT = Path(__file__).resolve().parents[2]
CRED_ID = re.compile(r"^(?:urn:uuid:)?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$")


class RuleRecalled(Exception):
    pass


def _atomic_write(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def did_from_base_url(base_url: str) -> str:
    """did:web method: host (port as %3A), then path segments joined with ':'."""
    rest = re.sub(r"^https?://", "", base_url.rstrip("/"))
    host, _, path = rest.partition("/")
    return "did:web:" + ":".join([host.replace(":", "%3A")] + [p for p in path.split("/") if p])


class TrustStore:
    def __init__(self, base_url: str, did: str, seed_hex: str, data_dir: Path | None = None, status_id: str = "1"):
        """status_id names this store's status list (/status/<id>); demo sandboxes get their own list."""
        self.base_url = base_url.rstrip("/")
        self.issuer = Issuer.from_seed_hex(did, seed_hex)
        self.dir = data_dir or ROOT / "data" / "trust" / re.sub(r"[^A-Za-z0-9._-]+", "_", did)
        (self.dir / "creds").mkdir(parents=True, exist_ok=True)
        self.state_path = self.dir / "state.json"
        self._lock = threading.RLock()
        state = json.loads(self.state_path.read_text(encoding="utf-8")) if self.state_path.exists() else \
            {"did": did, "next_index": 0, "revoked": [], "rule_index": {}, "recalls": {}}
        if state.get("did") != did:
            raise RuntimeError(f"trust state in {self.dir} belongs to {state.get('did')}, not {did}; refusing to start")
        state.setdefault("recalls", {})
        self.state = state
        if not self.state_path.exists():  # claim the folder for this identity at once
            _atomic_write(self.state_path, json.dumps(state, indent=2))
        self.status_id = status_id
        self.status = StatusList(f"{self.base_url}/status/{status_id}", self.issuer)
        self.status.next_index = state["next_index"]
        for i in state["revoked"]:
            self.status.revoke(i)
        self.status.updated_at = state.get("status_updated_at", self.status.updated_at)

    @classmethod
    def from_env(cls, base_url: str) -> "TrustStore":
        return cls(base_url, os.environ.get("ISSUER_DID", did_from_base_url(base_url)), os.environ["KRISHILOOP_ISSUER_SEED"])

    # -------- persistence
    def _save_state(self) -> None:
        self.state["next_index"] = self.status.next_index
        self.state["status_updated_at"] = self.status.updated_at
        _atomic_write(self.state_path, json.dumps(self.state, indent=2))

    def _path(self, cred_id: str) -> Path:
        m = CRED_ID.match(cred_id or "")
        if not m:
            raise FileNotFoundError("malformed credential id")
        return self.dir / "creds" / f"{uuid.UUID(m.group(1))}.json"

    def put(self, cred: dict) -> dict:
        with self._lock:
            _atomic_write(self._path(cred["id"]), json.dumps(cred, ensure_ascii=False, indent=2))
            self._save_state()
        return cred

    def get(self, cred_id: str) -> dict:
        if cred_id == self.status.url:
            return self.status.credential()
        return json.loads(self._path(cred_id).read_text(encoding="utf-8"))

    # -------- issuing
    def is_recalled(self, rule_id: str, version: int) -> bool:
        return f"{rule_id}@{version}" in self.state["recalls"]

    def rule_credential(self, rule: dict) -> dict:
        key = f"{rule['pack_id']}/{rule['rule_id']}@{rule['version']}#{rule['rule_sha256'][:16]}"
        with self._lock:
            if self.is_recalled(rule["rule_id"], rule["version"]):
                raise RuleRecalled(f"{rule['rule_id']} v{rule['version']}")
            if key in self.state["rule_index"]:
                return self.get(self.state["rule_index"][key])
            src = rule["sources"][0]
            cred = issue_credential("RuleCredential", {
                "rule_id": rule["rule_id"], "version": rule["version"], "pack_id": rule["pack_id"],
                "doc_id": src["doc_id"], "page": src["page"], "quote_sha256": src["quote_sha256"],
                "rule_sha256": rule["rule_sha256"], "review_level": rule.get("review", {}).get("level", "pending"),
            }, self.issuer, self.status)
            self.state["rule_index"][key] = cred["id"]
            return self.put(cred)

    def receipt_credential(self, receipt: dict, valid_until: str | None = None) -> dict:
        return self.put(issue_credential("AdviceReceiptCredential", receipt, self.issuer, None, valid_until))

    def area_trust_credential(self, subject: dict) -> dict:
        """Earned photo trust in one area (plan/EARNED_TRUST_DESIGN.md); revoked when that area's gate closes.

        The index lives in this store, so a demo sandbox's evidence never opens the gate anywhere else."""
        with self._lock:
            cred = issue_credential("AreaTrustCredential", subject, self.issuer, self.status)
            self.state.setdefault("area_trust", {})[f"{subject['model']}|{subject['area']}"] = cred["id"]
            return self.put(cred)

    def trusted_photo_model(self, model: str, area: str) -> str | None:
        """The live AreaTrustCredential id for this model in this area, if its trust stands."""
        return self.state.get("area_trust", {}).get(f"{model}|{area}")

    def revoke(self, cred_id: str) -> None:
        """Withdraw one credential that has a status entry (e.g. an area's photo trust after its gate closed)."""
        with self._lock:
            idx = int(self.get(cred_id)["credentialStatus"]["statusListIndex"])
            self.status.revoke(idx)
            if idx not in self.state["revoked"]:
                self.state["revoked"].append(idx)
            index = self.state.get("area_trust", {})
            for key in [k for k, v in index.items() if v == cred_id]:
                del index[key]
            self._save_state()

    # -------- recall + verify
    def recall_rule(self, rule_id: str, version: int, reason: str = "", actor: str = "admin") -> list[str]:
        """Withdraw a rule version: every receipt that used it verifies as 'recalled', and it is never issued again."""
        with self._lock:
            self.state["recalls"].setdefault(f"{rule_id}@{version}", {"at": now_iso(), "reason": reason, "actor": actor})
            hits = []
            for key, cred_id in self.state["rule_index"].items():
                if key.split("/", 1)[-1].startswith(f"{rule_id}@{version}#"):
                    idx = int(self.get(cred_id)["credentialStatus"]["statusListIndex"])
                    self.status.revoke(idx)
                    if idx not in self.state["revoked"]:
                        self.state["revoked"].append(idx)
                    hits.append(cred_id)
            self._save_state()
        return hits

    def resolve_key(self, verification_method: str):
        if verification_method != self.issuer.verification_method:
            raise KeyError("unknown verification method")
        return verify_key_from_multibase(self.issuer.public_key_multibase)

    def has(self, cred_id: str) -> bool:
        try:
            return self._path(cred_id).exists()
        except FileNotFoundError:
            return False

    def stats(self) -> dict:
        creds = list((self.dir / "creds").glob("*.json"))
        return {"rule_versions_recalled": len(self.state["recalls"]), "status_entries_used": self.status.next_index,
                "status_entries_revoked": len(self.state["revoked"]), "credentials_stored": len(creds)}

    def verify(self, cred_id: str) -> dict:
        try:
            cred = self.get(cred_id)
        except (FileNotFoundError, ValueError):
            return {"status": "invalid", "reason": "unknown credential"}
        return verify_receipt(cred, self.get, self.resolve_key)

    def did_document(self) -> dict:
        vm = self.issuer.verification_method
        return {"@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
                "id": self.issuer.did,
                "verificationMethod": [{"id": vm, "type": "Multikey", "controller": self.issuer.did,
                                        "publicKeyMultibase": self.issuer.public_key_multibase}],
                "assertionMethod": [vm]}
