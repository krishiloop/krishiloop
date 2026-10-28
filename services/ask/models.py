"""Optional ONNX text models for the Ask router: a multilingual embedder (dense retrieval) and a cross-encoder reranker.

Install them with ml/ask/export_text_models.py into a folder OUTSIDE the repo, then point KRISHILOOP_ASK_MODELS at it:
  <dir>/embedder/{model.onnx, tokenizer.json, meta.json}     multilingual-e5-small (MIT)
  <dir>/reranker/{model.onnx, tokenizer.json, meta.json}     gte-multilingual-reranker-base (Apache-2.0)
Without them the router runs on BM25 alone and says so. Both models run on CPU through ONNX Runtime and only score
text; neither writes any. onnxruntime and tokenizers are imported only here, so the rest of the API runs without them.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

import numpy as np

ENV = "KRISHILOOP_ASK_MODELS"
BATCH = 16


class _OnnxTextModel:
    kind = ""

    def __init__(self, d: Path):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        self.meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        onnx_path = d / "model.onnx"
        want = self.meta["files"]["model.onnx"]
        if onnx_path.stat().st_size != want["size"]:     # a partial or swapped file never loads (sha256: at install)
            raise ValueError(f"{self.kind} model.onnx does not match its meta.json; reinstall it")
        self.sha256 = want["sha256"]
        self.name = f"{self.meta['name']}@{self.meta['revision'][:12]}"
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        self.session = ort.InferenceSession(str(onnx_path), sess_options=opts, providers=["CPUExecutionProvider"])
        self.inputs = {i.name for i in self.session.get_inputs()}
        self.tok = Tokenizer.from_file(str(d / "tokenizer.json"))
        self.tok.enable_truncation(max_length=int(self.meta.get("max_length", 512)))
        pad = self.tok.token_to_id("<pad>")
        self.tok.enable_padding(pad_id=1 if pad is None else pad, pad_token="<pad>")

    def _run(self, encodings) -> tuple[np.ndarray, np.ndarray]:
        ids = np.array([e.ids for e in encodings], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)
        feed = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self.inputs:      # XLM-R vocabularies use a single segment id
            feed["token_type_ids"] = np.zeros_like(ids)
        return self.session.run(None, feed)[0], mask

    def describe(self) -> dict:
        keys = ("name", "repo", "revision", "base_model", "licence", "bangla_evidence", "parameters", "variant", "card")
        return {**{k: self.meta[k] for k in keys if k in self.meta}, "sha256": self.sha256}


class Embedder(_OnnxTextModel):
    """Mean-pooled, L2-normalised sentence vectors; e5 wants 'query: ' / 'passage: ' prefixes (meta.json)."""
    kind = "embedder"

    def embed(self, texts: list[str], kind: str) -> np.ndarray:
        prefix = self.meta.get(f"{kind}_prefix", "")
        out = []
        for i in range(0, len(texts), BATCH):
            hidden, mask = self._run(self.tok.encode_batch([prefix + t for t in texts[i:i + BATCH]]))
            m = mask[..., None].astype(np.float32)
            v = (hidden * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)
            out.append(v / np.clip(np.linalg.norm(v, axis=1, keepdims=True), 1e-12, None))
        return np.vstack(out).astype(np.float32) if out else np.zeros((0, 1), dtype=np.float32)


class Reranker(_OnnxTextModel):
    """Cross-encoder: reads the question and one passage together; sigmoid(logit) is the relevance in [0, 1]."""
    kind = "reranker"

    def score(self, query: str, passages: list[str]) -> list[float]:
        out: list[float] = []
        for i in range(0, len(passages), BATCH):
            logits, _ = self._run(self.tok.encode_batch([(query, p) for p in passages[i:i + BATCH]]))
            out += (1.0 / (1.0 + np.exp(-logits.reshape(-1).astype(np.float64)))).tolist()
        return out


_lock = threading.Lock()
_loaded: dict[tuple[str, str], object] = {}
_errors: dict[str, str] = {}


def models_dir() -> Path | None:
    d = os.environ.get(ENV, "")
    return Path(d) if d else None


def _load(kind: str, cls):
    d = models_dir()
    key = (kind, str(d or ""))
    with _lock:
        if key not in _loaded:
            obj = None
            if d is None:
                _errors[kind] = f"not installed ({ENV} is not set)"
            elif not (d / kind / "model.onnx").exists():
                _errors[kind] = "not installed (run ml/ask/export_text_models.py)"
            else:
                try:
                    obj = cls(d / kind)
                    _errors.pop(kind, None)
                except Exception as e:      # never pretend: the stage stays off and health says why
                    _errors[kind] = f"failed to load: {type(e).__name__}"
            _loaded[key] = obj
        return _loaded[key]


def load_embedder() -> Embedder | None:
    return _load("embedder", Embedder)


def load_reranker() -> Reranker | None:
    return _load("reranker", Reranker)


def load_errors() -> dict[str, str]:
    return dict(_errors)
