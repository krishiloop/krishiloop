"""Verifiable Credentials for KrishiLoop: sign, verify, and recall.

Implements W3C VC Data Model 2.0 with a Data Integrity proof using the `eddsa-jcs-2022` cryptosuite
(JSON Canonicalization Scheme, RFC 8785; Ed25519), and W3C Bitstring Status List for recall.

- RuleCredential: one per rule *version*; its status bit is flipped to recall the rule.
- AdviceReceiptCredential: one per recommendation. It signs the advice itself (text, decision, plan window)
  and references the rule credentials it used. Receipts carry no status entry of their own: recall is per
  rule version, so issuing receipts never consumes status-list capacity.
- verify_receipt(): "authentic" | "recalled" | "invalid". Never says "correct": a valid signature proves
  who issued the receipt and that it was not altered, not that the advice is right.

Extra contexts: none. VC DM 2.0's base context maps undefined terms to the issuer-dependent vocabulary,
so our custom terms stay processable; a published KrishiLoop context is planned.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

import base58
import rfc8785
from nacl.signing import SigningKey, VerifyKey

VC_V2 = "https://www.w3.org/ns/credentials/v2"
ED25519_MULTICODEC = b"\xed\x01"
STATUS_LIST_BITS = 131072  # 16 KiB minimum recommended by the spec, for herd privacy
XSD_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


# ---------------------------------------------------------------- keys
@dataclass
class Issuer:
    did: str                 # e.g. "did:web:krishiloop.github.io"
    signing_key: SigningKey

    @property
    def verification_method(self) -> str:
        return f"{self.did}#key-1"

    @property
    def public_key_multibase(self) -> str:
        return public_multibase(self.signing_key.verify_key)

    @classmethod
    def generate(cls, did: str) -> "Issuer":
        return cls(did, SigningKey.generate())

    @classmethod
    def from_seed_hex(cls, did: str, seed_hex: str) -> "Issuer":
        return cls(did, SigningKey(bytes.fromhex(seed_hex)))


def public_multibase(vk: VerifyKey) -> str:
    return "z" + base58.b58encode(ED25519_MULTICODEC + bytes(vk)).decode()


def verify_key_from_multibase(mb: str) -> VerifyKey:
    raw = base58.b58decode(mb[1:])
    if not mb.startswith("z") or raw[:2] != ED25519_MULTICODEC:
        raise ValueError("not an Ed25519 multikey")
    return VerifyKey(raw[2:])


# ---------------------------------------------------------------- eddsa-jcs-2022
def _hash_data(unsecured: dict, proof_config: dict) -> bytes:
    return hashlib.sha256(rfc8785.dumps(proof_config)).digest() + hashlib.sha256(rfc8785.dumps(unsecured)).digest()


def sign(document: dict, issuer: Issuer, created: str | None = None) -> dict:
    """vc-di-eddsa §3.3.1. The returned proof keeps `@context` (step 2); dropping it breaks other verifiers."""
    proof_config = {
        "type": "DataIntegrityProof",
        "cryptosuite": "eddsa-jcs-2022",
        "created": created or now_iso(),
        "verificationMethod": issuer.verification_method,
        "proofPurpose": "assertionMethod",
    }
    if "@context" in document:
        proof_config["@context"] = document["@context"]
    unsecured = {k: v for k, v in document.items() if k != "proof"}
    signature = issuer.signing_key.sign(_hash_data(unsecured, proof_config)).signature
    proof = dict(proof_config)
    proof["proofValue"] = "z" + base58.b58encode(signature).decode()
    return {**unsecured, "proof": proof}


def verify_signature(secured: dict, resolve_key: Callable[[str], VerifyKey],
                     expected_purpose: str = "assertionMethod") -> bool:
    """vc-di-eddsa §3.3.2, followed literally (no context injection)."""
    proof = secured.get("proof")
    if not isinstance(proof, dict) or proof.get("type") != "DataIntegrityProof" \
            or proof.get("cryptosuite") != "eddsa-jcs-2022" or proof.get("proofPurpose") != expected_purpose:
        return False
    proof_value = proof.get("proofValue")
    if not isinstance(proof_value, str) or not proof_value.startswith("z") \
            or not XSD_DATETIME.match(str(proof.get("created", ""))):
        return False
    unsecured = {k: v for k, v in secured.items() if k != "proof"}
    proof_options = {k: v for k, v in proof.items() if k != "proofValue"}
    if "@context" in proof_options:  # step 4: the document's @context must start with the proof's
        ctx = proof_options["@context"] if isinstance(proof_options["@context"], list) else [proof_options["@context"]]
        doc_ctx = unsecured.get("@context")
        doc_ctx = doc_ctx if isinstance(doc_ctx, list) else [doc_ctx]
        if doc_ctx[:len(ctx)] != ctx:
            return False
        unsecured["@context"] = proof_options["@context"]
    try:
        signature = base58.b58decode(proof_value[1:])
        resolve_key(proof["verificationMethod"]).verify(_hash_data(unsecured, proof_options), signature)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------- bitstring status list
def encode_bits(bits: bytearray) -> str:
    return "u" + base64.urlsafe_b64encode(gzip.compress(bytes(bits))).decode().rstrip("=")


def decode_bits(encoded: str) -> bytearray:
    data = encoded[1:] + "=" * (-len(encoded[1:]) % 4)
    return bytearray(gzip.decompress(base64.urlsafe_b64decode(data)))


def get_bit(bits: bytearray, index: int) -> bool:
    return bool(bits[index // 8] & (0x80 >> (index % 8)))  # index 0 = left-most bit


def set_bit(bits: bytearray, index: int, value: bool = True) -> None:
    mask = 0x80 >> (index % 8)
    bits[index // 8] = (bits[index // 8] | mask) if value else (bits[index // 8] & ~mask)


class StatusList:
    """Revocation status list for one issuer; publish `credential()` at `url`."""

    def __init__(self, url: str, issuer: Issuer, bits: bytearray | None = None):
        self.url, self.issuer = url, issuer
        self.bits = bits if bits is not None else bytearray(STATUS_LIST_BITS // 8)
        self.next_index = 0
        self.updated_at = now_iso()
        self._signed: dict | None = None

    def allocate(self) -> dict:
        if self.next_index >= STATUS_LIST_BITS:
            raise RuntimeError("status list full; roll over to a new list")
        idx, self.next_index = self.next_index, self.next_index + 1
        return {"id": f"{self.url}#{idx}", "type": "BitstringStatusListEntry", "statusPurpose": "revocation",
                "statusListIndex": str(idx), "statusListCredential": self.url}

    def revoke(self, index: int) -> None:
        set_bit(self.bits, index, True)
        self.updated_at, self._signed = now_iso(), None

    def credential(self) -> dict:
        """Signed once per change (cacheable), not on every fetch."""
        if self._signed is None:
            self._signed = sign({
                "@context": [VC_V2], "id": self.url, "type": ["VerifiableCredential", "BitstringStatusListCredential"],
                "issuer": self.issuer.did, "validFrom": self.updated_at,
                "credentialSubject": {"id": f"{self.url}#list", "type": "BitstringStatusList",
                                      "statusPurpose": "revocation", "encodedList": encode_bits(self.bits)},
            }, self.issuer)
        return self._signed


# ---------------------------------------------------------------- KrishiLoop credentials
def issue_credential(kind: str, subject: dict, issuer: Issuer, status: StatusList | None = None,
                     valid_until: str | None = None) -> dict:
    assert kind in ("RuleCredential", "AdviceReceiptCredential", "AreaTrustCredential", "ModelCredential")
    doc = {
        "@context": [VC_V2],
        "id": f"urn:uuid:{uuid.uuid4()}",
        "type": ["VerifiableCredential", kind],
        "issuer": issuer.did,
        "validFrom": now_iso(),
        "credentialSubject": subject,
    }
    if valid_until:
        doc["validUntil"] = valid_until
    if status is not None:
        doc["credentialStatus"] = status.allocate()
    return sign(doc, issuer)


def is_revoked(cred: dict, fetch: Callable[[str], dict], resolve_key: Callable[[str], VerifyKey]) -> bool:
    """Bitstring Status List §3.2 checks; any failure raises ValueError (the caller reports 'invalid')."""
    st = cred.get("credentialStatus")
    if not st:
        return False
    if st.get("type") != "BitstringStatusListEntry" or st.get("statusPurpose") != "revocation":
        raise ValueError("unsupported status entry")
    status_cred = fetch(st["statusListCredential"])
    if not verify_signature(status_cred, resolve_key):
        raise ValueError("status list signature invalid")
    subject = status_cred.get("credentialSubject") or {}
    if "BitstringStatusListCredential" not in status_cred.get("type", []) or subject.get("type") != "BitstringStatusList" \
            or subject.get("statusPurpose") != st["statusPurpose"] or status_cred.get("issuer") != cred.get("issuer"):
        raise ValueError("status list does not match the entry")
    bits = decode_bits(subject["encodedList"])
    if len(bits) * 8 < STATUS_LIST_BITS:
        raise ValueError("status list too short")
    index = int(st["statusListIndex"])
    if not 0 <= index < len(bits) * 8:
        raise ValueError("status index out of range")
    return get_bit(bits, index)


def verify_receipt(receipt_cred: dict, fetch: Callable[[str], dict], resolve_key: Callable[[str], VerifyKey]) -> dict[str, Any]:
    """Verifier semantics shown to officers/auditors: authentic | recalled | invalid (never 'correct').

    The verified credential is returned, so pages render only signed content.
    """
    try:
        if "AdviceReceiptCredential" not in receipt_cred.get("type", []):
            return {"status": "invalid", "reason": "not a KrishiLoop advice receipt"}
        if not verify_signature(receipt_cred, resolve_key):
            return {"status": "invalid", "reason": "signature does not verify (altered or not issued by us)"}
        now = datetime.now(timezone.utc)
        if parse_iso(receipt_cred["validFrom"]) > now:
            return {"status": "invalid", "reason": "receipt is not valid yet"}
        if is_revoked(receipt_cred, fetch, resolve_key):
            return {"status": "recalled", "reason": "this receipt was withdrawn", "credential": receipt_cred}
        recalled = []
        for ref in receipt_cred["credentialSubject"].get("rule_refs", []):
            rule_cred = fetch(ref["credential_id"])
            rs = rule_cred.get("credentialSubject") or {}
            if not verify_signature(rule_cred, resolve_key) or rule_cred.get("id") != ref["credential_id"] \
                    or "RuleCredential" not in rule_cred.get("type", []) or rule_cred.get("issuer") != receipt_cred.get("issuer") \
                    or rs.get("rule_id") != ref["rule_id"] or rs.get("version") != ref["version"]:
                return {"status": "invalid", "reason": f"rule credential for {ref['rule_id']} does not match"}
            if is_revoked(rule_cred, fetch, resolve_key):
                recalled.append(f"{ref['rule_id']} v{ref['version']}")
        area_ref = receipt_cred["credentialSubject"].get("area_trust_ref")
        if area_ref:   # a photo reading informed this advice: the area's earned trust must still stand
            at = fetch(area_ref["credential_id"])
            ats = at.get("credentialSubject") or {}
            if not verify_signature(at, resolve_key) or at.get("id") != area_ref["credential_id"] \
                    or "AreaTrustCredential" not in at.get("type", []) or at.get("issuer") != receipt_cred.get("issuer") \
                    or ats.get("area") != area_ref["area"] or ats.get("model") != area_ref["model"]:
                return {"status": "invalid", "reason": "area photo-trust credential does not match"}
            if is_revoked(at, fetch, resolve_key):
                recalled.append(f"photo trust for {area_ref['model']} in {area_ref['area']}")
        model_ref = (receipt_cred["credentialSubject"].get("photo_reading") or {}).get("model_ref")
        if model_ref:   # a photo model's reading informed this advice: the model must not have been recalled
            mc = fetch(model_ref["credential_id"])
            ms = mc.get("credentialSubject") or {}
            if not verify_signature(mc, resolve_key) or mc.get("id") != model_ref["credential_id"]                     or "ModelCredential" not in mc.get("type", []) or mc.get("issuer") != receipt_cred.get("issuer")                     or ms.get("model") != model_ref["model"] or ms.get("sha256") != model_ref["sha256"]:
                return {"status": "invalid", "reason": "photo model credential does not match"}
            if is_revoked(mc, fetch, resolve_key):
                recalled.append(f"photo model {model_ref['model']}")
    except Exception as e:  # malformed input or an unreachable status list must never look authentic
        return {"status": "invalid", "reason": f"could not verify: {type(e).__name__}"}
    if recalled:
        return {"status": "recalled", "reason": "rule(s) withdrawn: " + ", ".join(recalled), "rules": recalled,
                "credential": receipt_cred}
    expired = "validUntil" in receipt_cred and parse_iso(receipt_cred["validUntil"]) < now
    reason = "issued by KrishiLoop and unaltered (this is not a guarantee of correctness)"
    if expired:
        reason += "; this advice was for an earlier week and has expired"
    return {"status": "authentic", "reason": reason, "expired": expired, "credential": receipt_cred}


def verify_area_trust(cred: dict, fetch: Callable[[str], dict], resolve_key: Callable[[str], VerifyKey]) -> dict[str, Any]:
    """An area's earned photo trust: authentic while its gate stands, recalled once the gate closed (drift)."""
    try:
        if "AreaTrustCredential" not in cred.get("type", []):
            return {"status": "invalid", "reason": "not a KrishiLoop area-trust credential"}
        if not verify_signature(cred, resolve_key):
            return {"status": "invalid", "reason": "signature does not verify (altered or not issued by us)"}
        if parse_iso(cred["validFrom"]) > datetime.now(timezone.utc):
            return {"status": "invalid", "reason": "not valid yet"}
        if is_revoked(cred, fetch, resolve_key):
            return {"status": "recalled", "reason": "photo trust in this area was withdrawn: the officer's recent verdicts "
                                                    "no longer clear the bar", "credential": cred}
    except Exception as e:  # never look authentic on malformed input
        return {"status": "invalid", "reason": f"could not verify: {type(e).__name__}"}
    return {"status": "authentic", "reason": "issued by KrishiLoop and unaltered: this photo model had earned trust in "
                                             "this area when it was issued (this is not a guarantee of correctness)",
            "credential": cred}


def verify_model(cred: dict, fetch: Callable[[str], dict], resolve_key: Callable[[str], VerifyKey]) -> dict[str, Any]:
    """A photo model's credential (services/vision/agritriage.py): authentic until the model is recalled."""
    try:
        if "ModelCredential" not in cred.get("type", []):
            return {"status": "invalid", "reason": "not a KrishiLoop model credential"}
        if not verify_signature(cred, resolve_key):
            return {"status": "invalid", "reason": "signature does not verify (altered or not issued by us)"}
        if is_revoked(cred, fetch, resolve_key):
            return {"status": "recalled", "reason": "this photo model was recalled: receipts that used its readings are "
                                                    "withdrawn", "credential": cred}
    except Exception as e:  # never look authentic on malformed input
        return {"status": "invalid", "reason": f"could not verify: {type(e).__name__}"}
    return {"status": "authentic", "reason": "issued by KrishiLoop and unaltered: the photo model file and gate this "
                                             "receipt cites (this is not a guarantee of correctness)", "credential": cred}
