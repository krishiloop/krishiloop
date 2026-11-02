"""Short verify codes: 8 Crockford base32 characters (40 random bits), shown as two groups of four, e.g. 7KQ2-MX4P.

A code is a LOOKUP HANDLE, not a secret and not a proof. It only finds a receipt's credential id; whether the receipt is
authentic always comes from checking its signature (and the status lists of the rules it cites).

Typing rules (Crockford): any case; dashes and spaces are ignored; O reads as 0, I and L read as 1. U is not in the
alphabet, so a code with U is not a code.
"""
from __future__ import annotations

import re
import secrets

ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"   # Crockford base32: no I, L, O, U
LENGTH = 8
_CONFUSED = str.maketrans({"O": "0", "I": "1", "L": "1"})
_SEPARATORS = re.compile(r"[\s\-‐-―_.]+")
_VALID = re.compile(f"^[{ALPHABET}]{{{LENGTH}}}$")


def new_code() -> str:
    """A fresh random code (canonical form, no dash). The caller checks it for collisions before storing it."""
    n = secrets.randbits(5 * LENGTH)
    return "".join(ALPHABET[(n >> (5 * i)) & 31] for i in reversed(range(LENGTH)))


def normalize(text: str | None) -> str | None:
    """What a person typed -> the canonical code (8 characters, upper case, no dash), or None if it cannot be a code."""
    if not isinstance(text, str) or len(text) > 32:
        return None
    s = _SEPARATORS.sub("", text.strip()).upper().translate(_CONFUSED)
    return s if _VALID.match(s) else None


def display(code: str) -> str:
    """The canonical code as people read it: 7KQ2-MX4P."""
    return f"{code[:4]}-{code[4:]}"
