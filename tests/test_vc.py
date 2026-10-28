"""Signed receipts: authentic -> tamper = invalid -> rule recall = recalled. Plus schema conformance."""
import copy
import json

import pytest
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

import base58
from nacl.signing import SigningKey

from services.trust.vc import (Issuer, StatusList, decode_bits, encode_bits, get_bit, issue_credential, set_bit, sign,
                               verify_key_from_multibase, verify_receipt, verify_signature)

ROOT = Path(__file__).resolve().parents[1]
DID = "did:web:krishiloop.example"


def _world():
    issuer = Issuer.generate(DID)
    status = StatusList("https://krishiloop.example/status/1", issuer)
    store: dict[str, dict] = {}
    keys = {issuer.verification_method: issuer.public_key_multibase}

    def fetch(url):
        return status.credential() if url == status.url else store[url]

    def resolve(vm):
        return verify_key_from_multibase(keys[vm])
    return issuer, status, store, fetch, resolve


def _rule_and_receipt(issuer, status, store):
    rule = issue_credential("RuleCredential", {"rule_id": "R-PLB-002", "version": 1, "pack_id": "pack-potato-late-blight",
                            "doc_id": "DOC-CIP-001", "page": 27, "quote_sha256": "0" * 64, "rule_sha256": "1" * 64,
                            "review_level": "pending"}, issuer, status)
    store[rule["id"]] = rule
    subject = json.loads((ROOT / "contracts/examples/receipt.example.json").read_text(encoding="utf-8"))
    subject["rule_refs"][0]["credential_id"] = rule["id"]
    receipt = issue_credential("AdviceReceiptCredential", subject, issuer)  # receipts are recalled via their rules
    return rule, receipt


def test_bits_roundtrip():
    bits = bytearray(16384)
    set_bit(bits, 0); set_bit(bits, 12345)
    back = decode_bits(encode_bits(bits))
    assert get_bit(back, 0) and get_bit(back, 12345) and not get_bit(back, 1)


def test_authentic_then_recalled():
    issuer, status, store, fetch, resolve = _world()
    rule, receipt = _rule_and_receipt(issuer, status, store)
    assert verify_receipt(receipt, fetch, resolve)["status"] == "authentic"
    status.revoke(int(rule["credentialStatus"]["statusListIndex"]))  # recall the rule version
    result = verify_receipt(receipt, fetch, resolve)
    assert result["status"] == "recalled" and "R-PLB-002 v1" in result["reason"]


def test_tampered_receipt_is_invalid():
    issuer, status, store, fetch, resolve = _world()
    _, receipt = _rule_and_receipt(issuer, status, store)
    forged = copy.deepcopy(receipt)
    forged["credentialSubject"]["sources"][0]["quote"] = "Spray every day."
    assert verify_receipt(forged, fetch, resolve)["status"] == "invalid"


def test_foreign_key_is_rejected():
    issuer, status, store, fetch, resolve = _world()
    _, receipt = _rule_and_receipt(issuer, status, store)
    other = Issuer.generate(DID)
    assert not verify_signature(receipt, lambda vm: other.signing_key.verify_key)


def test_credentials_match_contract_schema():
    issuer, status, store, fetch, resolve = _world()
    rule, receipt = _rule_and_receipt(issuer, status, store)
    registry = Registry()
    schemas = {}
    for p in (ROOT / "contracts/schemas").glob("*.schema.json"):
        s = json.loads(p.read_text(encoding="utf-8"))
        schemas[p.name] = s
        registry = registry.with_resource(s["$id"], Resource.from_contents(s))
    v = Draft202012Validator(schemas["credential.schema.json"], registry=registry)
    for cred in (rule, receipt):
        errors = list(v.iter_errors(cred))
        assert not errors, [e.message for e in errors]


# W3C vc-di-eddsa REC, test vector B.3 (eddsa-jcs-2022): key pair and expected proofValue (Example 38)
TV_PUB = "z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2"
TV_SEC = "z3u2en7t5LR2WtQH5PfFqMqwVHBeXouLzo6haApm8XHqvjxq"
TV_UNSIGNED = {
    "@context": ["https://www.w3.org/ns/credentials/v2", "https://www.w3.org/ns/credentials/examples/v2"],
    "id": "urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33",
    "type": ["VerifiableCredential", "AlumniCredential"],
    "name": "Alumni Credential",
    "description": "A minimum viable example of an Alumni Credential.",
    "issuer": "https://vc.example/issuers/5678",
    "validFrom": "2023-01-01T00:00:00Z",
    "credentialSubject": {"id": "did:example:abcdefgh", "alumniOf": "The School of Examples"},
}
TV_PROOF_VALUE = "z2HnFSSPPBzR36zdDgK8PbEHeXbR56YF24jwMpt3R1eHXQzJDMWS93FCzpvJpwTWd3GAVFuUfjoJdcnTMuVor51aX"


class _TVIssuer:
    def __init__(self):
        self.signing_key = SigningKey(base58.b58decode(TV_SEC[1:])[2:])
        self.verification_method = f"did:key:{TV_PUB}#{TV_PUB}"


def test_w3c_test_vector_b3():
    tv = _TVIssuer()
    signed = sign(copy.deepcopy(TV_UNSIGNED), tv, created="2023-02-24T23:36:38Z")
    assert signed["proof"]["proofValue"] == TV_PROOF_VALUE
    assert signed["proof"]["@context"] == TV_UNSIGNED["@context"]  # §3.3.1 step 2: the proof keeps @context
    assert verify_signature(signed, lambda vm: verify_key_from_multibase(TV_PUB))


def test_verifier_rejects_bad_proof_metadata():
    tv = _TVIssuer()
    signed = sign(copy.deepcopy(TV_UNSIGNED), tv, created="2023-02-24T23:36:38Z")
    resolve = lambda vm: verify_key_from_multibase(TV_PUB)
    for key, value in (("proofValue", "Q" + TV_PROOF_VALUE[1:]), ("proofPurpose", "authentication"), ("created", "not-a-date")):
        bad = copy.deepcopy(signed); bad["proof"][key] = value
        assert not verify_signature(bad, resolve), key
    bad = copy.deepcopy(signed); bad["@context"] = ["https://www.w3.org/ns/credentials/v2"]
    assert not verify_signature(bad, resolve)  # document context must start with the proof context


def test_advice_text_is_signed():
    issuer, status, store, fetch, resolve = _world()
    _, receipt = _rule_and_receipt(issuer, status, store)
    forged = copy.deepcopy(receipt)
    forged["credentialSubject"]["advice"]["title"]["en"] = "Spray now."
    assert verify_receipt(forged, fetch, resolve)["status"] == "invalid"


def test_status_list_capacity_is_enforced():
    issuer, status, *_ = _world()
    status.next_index = 131072
    with pytest.raises(RuntimeError):
        status.allocate()
