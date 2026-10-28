"""Per-area probe (services/vision/probe.py) on synthetic features: zero-shot start, learning, calibration."""
import numpy as np

from services.vision import probe


def _area(seed=0, n=300, dim=32, classes=3, shift=0.8):
    rng = np.random.RandomState(seed)
    T = probe.l2n(rng.randn(classes, dim))                         # text classifier: roughly right
    true = probe.l2n(T + shift * rng.randn(classes, dim))         # this area's photos look different
    y = rng.randint(0, classes, n)
    X = probe.l2n(true[y] + 0.35 * rng.randn(n, dim))
    return X, y, T


def test_no_confirmations_means_exactly_zero_shot():
    X, y, T = _area()
    D = np.zeros_like(T)
    assert np.allclose(probe.logits(X, T, D), 100.0 * X @ T.T)


def test_confirmed_photos_teach_the_area():
    X, y, T = _area()
    zero_shot = (probe.logits(X[100:], T, np.zeros_like(T)).argmax(1) == y[100:]).mean()
    D = probe.fit(X[:100], y[:100], T)
    adapted = (probe.logits(X[100:], T, D).argmax(1) == y[100:]).mean()
    assert adapted > zero_shot + 0.15


def test_stronger_anchor_stays_closer_to_the_text_classifier():
    X, y, T = _area()
    loose, tight = probe.fit(X[:50], y[:50], T, lam=0.03), probe.fit(X[:50], y[:50], T, lam=3.0)
    assert np.linalg.norm(tight) < np.linalg.norm(loose)


def test_temperature_softens_overconfident_logits():
    X, y, T = _area(shift=1.5)
    Z = probe.logits(X, T, np.zeros_like(T))                       # zero-shot on a shifted area: overconfident
    t = probe.fit_temperature(Z, y)
    assert t > 1.0
    p = probe.probabilities(Z, t)
    assert np.allclose(p.sum(1), 1.0)
