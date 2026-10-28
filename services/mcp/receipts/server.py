"""KrishiLoop receipts MCP server: verify a credential, read a stored credential, and read a status list. Read-only.

- verify_credential: the public verifier's answer (authentic | recalled | invalid) through TrustStore.verify, for
  advice receipts and AreaTrustCredentials, from the official store or a live demo sandbox (as GET /api/verify/<id>);
- get_credential: the credential as stored (as GET /api/credentials/<id>), unverified;
- status_list_info: a status list's counters and the rule versions recalled in it, and optionally the signed
  BitstringStatusListCredential (as GET /status/<id>).

Recall is NOT a tool here: it stays behind the API's admin token (POST /api/admin/recall).
Stores are reopened on every call, so a recall made through the API shows at once; no call creates a file. This is the
only KrishiLoop MCP server that needs the issuer seed (KRISHILOOP_ISSUER_SEED, from the environment, never logged),
because TrustStore rebuilds and signs the status list from its local state; no tool issues, signs or revokes anything.

Run:  python -m services.mcp.receipts [--transport stdio|http] [--port 8103]
Environment: see services/mcp/stores.py.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

if __package__ in (None, ""):  # run as a script (python services/mcp/receipts/server.py): make `services` importable
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

from services.mcp import stores
from services.mcp.common import READ_LOCAL, serve
from services.trust.store import CRED_ID
from services.trust.vc import STATUS_LIST_BITS

STATUS_MEANING = {"authentic": "issued by KrishiLoop and unaltered; not a guarantee that the advice is correct",
                  "recalled": "withdrawn: a rule (or the area photo trust) it relied on was recalled",
                  "invalid": "altered, unknown here, expired demo session, or could not be verified"}
CredentialId = Annotated[str, Field(max_length=100, description="Credential id: urn:uuid:<uuid> or a bare uuid, from a "
                                                                "receipt's QR code or link")]
SessionId = Annotated[str | None, Field(description="Demo session id (16 hex characters); omit for the official store")]

server = MCPServer(
    "krishiloop-receipts", title="KrishiLoop receipts", version="0.2.0",
    instructions="Read-only. Verify a KrishiLoop credential (an advice receipt or an area photo-trust credential): "
                 "authentic, recalled or invalid. Read a stored credential, and read a status list with the rule "
                 "versions recalled in it. Recall is not available here: it needs the admin token on the API.")


@server.tool(annotations=READ_LOCAL, structured_output=True)
def verify_credential(credential_id: CredentialId) -> dict[str, Any]:
    """Verify a KrishiLoop advice receipt or AreaTrustCredential, exactly as the public verifier does: authentic
    (issued by KrishiLoop and unaltered), recalled (a rule it used, or the area's photo trust, was withdrawn) or
    invalid. Returns the verified credential, so only signed content is shown."""
    found = stores.locate(credential_id)
    st = stores.open_store(*found) if found else None
    if st is None or not st.has(credential_id):
        return {"status": "invalid", "reason": "unknown credential", "meaning": STATUS_MEANING["invalid"]}
    result = st.verify(credential_id)
    return {**result, "meaning": STATUS_MEANING.get(result["status"], ""), "sandbox": st.status_id != "1",
            "status_list": st.status.url, "verifier_page": f"{st.base_url}/verify/{credential_id}"}


@server.tool(annotations=READ_LOCAL, structured_output=True)
def get_credential(credential_id: CredentialId) -> dict[str, Any]:
    """A KrishiLoop credential exactly as stored (advice receipt, rule credential or area photo-trust credential),
    unverified. Use verify_credential before relying on it."""
    found = stores.locate(credential_id)
    if not found:
        raise ToolError("unknown credential")
    trust_dir, status_id = found
    cred = json.loads((trust_dir / "creds" / f"{CRED_ID.match(credential_id).group(1).lower()}.json")
                      .read_text(encoding="utf-8"))
    return {"note": "Unverified copy as stored; call verify_credential to check its signature and recall status.",
            "type": [t for t in cred.get("type", []) if t != "VerifiableCredential"], "sandbox": status_id != "1",
            "status_list": f"{stores.identity()[0]}/status/{status_id}", "credential": cred}


@server.tool(annotations=READ_LOCAL, structured_output=True)
def status_list_info(
    session_id: SessionId = None,
    include_credential: Annotated[bool, Field(description="Also return the signed BitstringStatusListCredential "
                                                          "(needs the issuer seed on this server)")] = False,
) -> dict[str, Any]:
    """A status list (W3C Bitstring Status List, purpose revocation): its URL, size, entries used and revoked, when it
    last changed, and the rule versions recalled in it with when and why. One entry is used per rule-version credential
    and per area photo-trust credential; advice receipts use none, since recall is per rule version."""
    trust_dir, status_id, _ = stores.scope(session_id)
    state = stores.read_state(trust_dir)
    if not state:
        raise ToolError("no trust store here yet")
    url = f"{stores.identity()[0]}/status/{status_id}"
    out = {"status_list": url, "scope": "official store" if session_id is None else f"demo session {session_id}",
           "purpose": "revocation", "size_bits": STATUS_LIST_BITS, "entries_used": state.get("next_index", 0),
           "entries_revoked": len(state.get("revoked", [])), "updated_at": state.get("status_updated_at"),
           "recalled_rule_versions": [{"rule_version": k, **v} for k, v in sorted(state.get("recalls", {}).items())]}
    if include_credential:
        st = stores.open_store(trust_dir, status_id)
        out["credential"] = st.status.credential() if st else None
    return out


def main(argv: list[str] | None = None) -> None:
    serve(server, 8103, argv)


if __name__ == "__main__":
    main()
