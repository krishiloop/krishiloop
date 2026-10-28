"""Per-area photo model: a linear probe on frozen image features, anchored to the zero-shot text classifier.

W = 100 * (T + D), with T the L2-normalised text embeddings of the class descriptions. D minimises the class-balanced
cross-entropy on the area's officer-confirmed photos plus (lam / 2) * ||D||^2 (CLAP-style, Silva-Rodriguez et al.,
CVPR 2024). With no confirmed photos it is exactly zero-shot. Confidence uses a temperature fitted on the area's own
prequential record (suggestions frozen before their verdicts). Same maths as ml/vision/analysis/earned_trust_sim_v2.py.
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import minimize

LOGIT_SCALE = 100.0
DEFAULT_LAMBDA = 0.3


def l2n(X: np.ndarray) -> np.ndarray:
    return X / (np.linalg.norm(X, axis=-1, keepdims=True) + 1e-8)


def log_softmax(Z: np.ndarray) -> np.ndarray:
    Z = Z - Z.max(-1, keepdims=True)
    return Z - np.log(np.exp(Z).sum(-1, keepdims=True))


def fit(X: np.ndarray, y: np.ndarray, T: np.ndarray, lam: float = DEFAULT_LAMBDA, D0: np.ndarray | None = None) -> np.ndarray:
    """Return D (classes x dim). X: L2-normalised features of confirmed photos; y: their class indices."""
    C = T.shape[0]
    counts = np.bincount(y, minlength=C).astype(float)
    w = 1.0 / (counts[y] * (counts > 0).sum())      # each confirmed class carries equal total weight
    Y = np.eye(C)[y]

    def f(flat):
        D = flat.reshape(T.shape)
        lp = log_softmax(LOGIT_SCALE * X @ (T + D).T)
        loss = -(w * (Y * lp).sum(1)).sum() + 0.5 * lam * (D * D).sum()
        grad = LOGIT_SCALE * ((np.exp(lp) - Y) * w[:, None]).T @ X + lam * D
        return loss, grad.ravel()
    start = np.zeros_like(T) if D0 is None else D0
    return minimize(f, start.ravel(), jac=True, method="L-BFGS-B", options={"maxiter": 200}).x.reshape(T.shape)


def logits(X: np.ndarray, T: np.ndarray, D: np.ndarray) -> np.ndarray:
    return LOGIT_SCALE * X @ (T + D).T


def fit_temperature(Z: np.ndarray, y: np.ndarray) -> float:
    """Temperature that best explains past verdicts given the logits frozen before them."""
    temps = np.exp(np.linspace(np.log(0.25), np.log(8.0), 60))
    nll = [-log_softmax(Z / t)[np.arange(len(y)), y].mean() for t in temps]
    return float(temps[int(np.argmin(nll))])


def probabilities(Z: np.ndarray, temperature: float) -> np.ndarray:
    return np.exp(log_softmax(Z / temperature))
