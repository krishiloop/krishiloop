"""Heads on frozen features (PROTOCOL_v1 section M) and the metrics used by RQ1.

H1  text-anchored linear probe (ml/vision protocol 2, unchanged): logits = 100 * X (T + D)^T, minimising class-balanced
    cross-entropy + (lam / 2) ||D||^2 with lam = 0.3, L-BFGS-B, 200 iterations. With D = 0 it is the zero-shot classifier.
H3  logistic regression on the source domains: standardised on source-train; weight decay chosen on source
    validation from {1e-4, 1e-3, 1e-2} (the ml/vision probe grid); class-balanced weights.
Both heads: temperature fitted on source validation (NLL grid 0.05..20), never on the target.
Metrics: macro-F1 over the labels present in the evaluated set, accuracy, ECE (15 equal-width bins, top-1).
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import minimize

LAM_H1 = 0.3
WD_GRID = (1e-4, 1e-3, 1e-2)
TEMPS = np.exp(np.linspace(np.log(0.05), np.log(20.0), 120))


def log_softmax(Z):
    Z = Z - Z.max(1, keepdims=True)
    return Z - np.log(np.exp(Z).sum(1, keepdims=True))


def softmax(Z):
    return np.exp(log_softmax(Z))


def balanced_weights(y, C):
    counts = np.bincount(y, minlength=C).astype(float)
    return 1.0 / (counts[y] * (counts > 0).sum())   # every seen class carries the same total weight; sum = 1


def fit_temperature(Z, y):
    nll = [-log_softmax(Z / t)[np.arange(len(y)), y].mean() for t in TEMPS]
    return float(TEMPS[int(np.argmin(nll))])


def macro_f1(y, pred, C: int | None = None):
    """Macro-F1 over the labels present in y (same as sklearn f1_score(labels=present, average='macro',
    zero_division=0)), from a confusion matrix so the bootstrap stays fast."""
    y, pred = np.asarray(y, dtype=np.int64), np.asarray(pred, dtype=np.int64)
    C = C or int(max(y.max(), pred.max())) + 1
    cm = np.bincount(y * C + pred, minlength=C * C).reshape(C, C)
    tp = np.diag(cm).astype(float)
    denom = 2 * tp + (cm.sum(0) - tp) + (cm.sum(1) - tp)
    f1 = np.where(denom > 0, 2 * tp / np.maximum(denom, 1e-12), 0.0)
    return float(f1[np.unique(y)].mean())


def ece(P, y, bins=15):
    """Expected calibration error, 15 equal-width bins on the top-1 confidence (bin (lo, hi])."""
    conf, pred = P.max(1), P.argmax(1)
    idx = np.clip(np.ceil(conf * bins).astype(int) - 1, 0, bins - 1)
    acc = (pred == np.asarray(y)).astype(float)
    cnt = np.bincount(idx, minlength=bins)
    s_acc = np.bincount(idx, weights=acc, minlength=bins)
    s_conf = np.bincount(idx, weights=conf, minlength=bins)
    return float(np.abs(s_acc - s_conf).sum() / max(len(conf), 1))


# ------------------------------------------------------------------ H1
class TextAnchoredProbe:
    def __init__(self, T: np.ndarray, lam: float = LAM_H1, iters: int = 200):
        self.T, self.lam, self.iters = T.astype(np.float64), lam, iters
        self.D = np.zeros_like(self.T)
        self.temp = 1.0

    def logits(self, X):
        return 100.0 * X.astype(np.float64) @ (self.T + self.D).T

    def fit(self, X, y):
        X = X.astype(np.float64)
        C = len(self.T)
        w = balanced_weights(y, C)
        Y = np.eye(C)[y]
        T, lam = self.T, self.lam

        def f(flat):
            D = flat.reshape(T.shape)
            Z = 100.0 * X @ (T + D).T
            lp = log_softmax(Z)
            loss = -(w * (Y * lp).sum(1)).sum() + 0.5 * lam * (D * D).sum()
            G = 100.0 * ((np.exp(lp) - Y) * w[:, None]).T @ X + lam * D
            return loss, G.ravel()
        r = minimize(f, self.D.ravel(), jac=True, method="L-BFGS-B", options={"maxiter": self.iters})
        self.D = r.x.reshape(T.shape)
        return self

    def calibrate(self, X, y):
        self.temp = fit_temperature(self.logits(X), y)
        return self

    def proba(self, X):
        return softmax(self.logits(X) / self.temp)


# ------------------------------------------------------------------ H3
def _fit_linear(X, y, w, wd, C, iters=500):
    d = X.shape[1]
    Y = np.eye(C)[y]

    def f(flat):
        W = flat[:d * C].reshape(d, C)
        b = flat[d * C:]
        Z = X @ W + b
        lp = log_softmax(Z)
        loss = -(w * (Y * lp).sum(1)).sum() + 0.5 * wd * (W * W).sum()
        Gz = (np.exp(lp) - Y) * w[:, None]
        gW = X.T @ Gz + wd * W
        gb = Gz.sum(0)
        return loss, np.concatenate([gW.ravel(), gb])
    r = minimize(f, np.zeros(d * C + C), jac=True, method="L-BFGS-B", options={"maxiter": iters})
    return r.x[:d * C].reshape(d, C), r.x[d * C:]


class LogReg:
    def __init__(self, C: int):
        self.C = C

    def fit(self, X, y, Xv, yv):
        X = X.astype(np.float64)
        self.mu, self.sd = X.mean(0), X.std(0) + 1e-6
        Zt, Zv = (X - self.mu) / self.sd, (Xv.astype(np.float64) - self.mu) / self.sd
        w = balanced_weights(y, self.C)
        best = None
        for wd in WD_GRID:
            W, b = _fit_linear(Zt, y, w, wd, self.C)
            f1 = macro_f1(yv, (Zv @ W + b).argmax(1))
            if best is None or f1 > best[0]:
                best = (f1, wd, W, b)
        self.val_f1, self.wd, self.W, self.b = best
        self.temp = fit_temperature(Zv @ self.W + self.b, yv)
        return self

    def logits(self, X):
        return ((X.astype(np.float64) - self.mu) / self.sd) @ self.W + self.b

    def proba(self, X):
        return softmax(self.logits(X) / self.temp)
