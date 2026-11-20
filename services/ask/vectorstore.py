"""Vector store for the Ask index: the dense vectors (multilingual-e5-small, the same ones the router computes) in an
embedded LanceDB table on disk, with metadata (unit id, kind, pack, lang, doc, page).

- The index build writes the table (`build`) and a manifest.json beside it: model name, row count, dimension and a
  fingerprint of the units' ids and texts. Nothing here ever embeds text; it stores and searches vectors it is given.
- Dense retrieval asks the store for the cosine of the question with every unit of the field's pack (exhaustive
  search over the table; vectors are L2-normalised, so cosine = dot = 1 - LanceDB's dot distance). The rule pooling
  needs every unit's score (a rule's score is its best unit), so k defaults to the pack's whole row count.
- If lancedb is not installed, the folder is not writable or the stored table does not match the index, the store is
  simply absent and retrieval uses the in-memory matrix: same ranking, same answers.

Folder: $KRISHILOOP_VECTOR_DIR (an empty value turns the store off), default <repo>/data/ask_vectors (git-ignored).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ENV = "KRISHILOOP_VECTOR_DIR"
TABLE = "ask_units"
_SAFE = re.compile(r"[A-Za-z0-9_.\-]+")


def default_dir() -> Path | None:
    v = os.environ.get(ENV)
    if v is not None:
        return Path(v) if v else None
    return ROOT / "data" / "ask_vectors"


def fingerprint(units, model: str) -> str:
    h = hashlib.sha256(model.encode())
    for u in units:
        h.update(u.uid.encode() + b"\0" + u.text.encode() + b"\0")
    return h.hexdigest()


def _lang(u) -> str:
    return "multi" if u.kind == "rule" else "en"   # rule units carry every language's title; the CIP chunks are English


class VectorStore:
    def __init__(self, directory: Path, table, manifest: dict):
        self.dir, self.table, self.manifest = directory, table, manifest

    @classmethod
    def write(cls, directory: Path, units, vectors: np.ndarray, model: str) -> "VectorStore":
        import lancedb
        import pyarrow as pa
        if len(units) != len(vectors):
            raise ValueError("one vector per unit")
        dim = int(vectors.shape[1])
        directory.mkdir(parents=True, exist_ok=True)
        cols = {
            "idx": pa.array(range(len(units)), pa.int32()),
            "uid": pa.array([u.uid for u in units]),
            "kind": pa.array([u.kind for u in units]),
            "pack": pa.array([u.packs[0] if u.packs else "" for u in units]),
            "packs": pa.array(["|" + "|".join(u.packs) + "|" for u in units]),   # for the per-pack filter
            "lang": pa.array([_lang(u) for u in units]),
            "doc": pa.array([u.meta.get("doc_id", "") for u in units]),
            "page": pa.array([int(u.meta.get("page", 0)) for u in units], pa.int32()),
            "vec": pa.FixedSizeListArray.from_arrays(pa.array(np.asarray(vectors, np.float32).ravel()), dim),
        }
        db = lancedb.connect(str(directory))
        table = db.create_table(TABLE, data=pa.table(cols), mode="overwrite")
        manifest = {"model": model, "rows": table.count_rows(), "dim": dim, "fingerprint": fingerprint(units, model),
                    "engine": f"lancedb {lancedb.__version__}", "table": TABLE}
        (directory / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        return cls(directory, table, manifest)

    @classmethod
    def open(cls, directory: Path) -> "VectorStore | None":
        try:
            import lancedb
            manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
            return cls(directory, lancedb.connect(str(directory)).open_table(TABLE), manifest)
        except Exception:
            return None

    def matches(self, units, model: str) -> bool:
        return self.manifest.get("fingerprint") == fingerprint(units, model) and self.manifest.get("rows") == len(units)

    def search(self, qvec: np.ndarray, pack_id: str, k: int | None = None) -> list[tuple[int, float]]:
        """[(unit index, cosine)] of the k best units of the pack, best first (all of them when k is None)."""
        if not _SAFE.fullmatch(pack_id):
            raise ValueError("bad pack id")
        q = np.asarray(qvec, dtype=np.float32).reshape(-1)
        limit = int(k) if k else self.manifest["rows"]
        rows = (self.table.search(q).metric("dot").where(f"packs LIKE '%|{pack_id}|%'").limit(limit)
                .select(["idx", "_distance"]).to_list())
        return [(int(r["idx"]), 1.0 - float(r["_distance"])) for r in rows]

    def describe(self) -> dict:
        return {"engine": self.manifest.get("engine"), "path": str(self.dir), "table": TABLE,
                "rows": self.manifest["rows"], "model": self.manifest["model"], "dim": self.manifest["dim"]}


def build(units, vectors, model: str, directory: Path | None = None) -> VectorStore | None:
    """Write the table for these units; None (never an error) when the store is off or cannot be written."""
    d = directory if directory is not None else default_dir()
    if d is None or vectors is None:
        return None
    try:
        return VectorStore.write(d, units, vectors, model)
    except Exception:
        return None
