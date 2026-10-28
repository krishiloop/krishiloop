"""Earned trust per area (services/vision/ledger.py): prequential evidence, Wilson gate, hysteresis, audit."""
import pytest

from services.vision.ledger import AreaLedger, LedgerError, Policy, wilson_lower_bound

LABELS = ["healthy", "blast", "brown_spot"]
SURE, UNSURE = [0.02, 0.95, 0.03], [0.30, 0.40, 0.30]


@pytest.fixture()
def policy():
    return Policy.load()


def test_policy_file_is_the_source_of_the_thresholds(policy):
    assert (policy.sure_threshold, policy.window, policy.min_sure_answers) == (0.85, 50, 30)
    assert (policy.open_lower_bound, policy.close_lower_bound, policy.audit_rate) == (0.85, 0.80, 0.10)


def test_wilson_lower_bound():
    assert wilson_lower_bound(0, 0) == 0.0
    assert round(wilson_lower_bound(30, 30), 3) == 0.886
    assert round(wilson_lower_bound(48, 50), 3) == 0.865
    assert round(wilson_lower_bound(45, 50), 3) == 0.786


def test_verdicts_need_a_suggestion_frozen_first(policy):
    led = AreaLedger("rice@BD-30", "m@1", policy)
    with pytest.raises(LedgerError):
        led.judge("c-1", "blast", "officer-1")               # no suggestion yet: not an honest test
    led.suggest("c-1", LABELS, SURE)
    with pytest.raises(LedgerError):
        led.suggest("c-1", LABELS, UNSURE)                   # a suggestion cannot be changed after the fact
    led.judge("c-1", "blast", "officer-1")
    with pytest.raises(LedgerError):
        led.judge("c-1", "healthy", "officer-1")             # judged once


def test_gate_opens_only_on_enough_sure_right_verdicts(policy):
    led = AreaLedger("rice@BD-30", "m@1", policy)
    for i in range(40):                                      # unsure suggestions never count, however right
        assert led.suggest(f"u-{i}", LABELS, UNSURE)["route"] == "officer"
        assert led.judge(f"u-{i}", "blast", "o") is None
    for i in range(29):
        led.suggest(f"s-{i}", LABELS, SURE)
        assert led.judge(f"s-{i}", "blast", "o") is None     # 29 < min_sure_answers
    assert led.stats()["gate_open"] is False
    led.suggest("s-29", LABELS, SURE)
    event = led.judge("s-29", "blast", "o")
    assert event["event"] == "opened" and event["sure_in_window"] == 30 and event["lower_bound"] >= 0.85


def test_wrong_sure_answers_keep_the_gate_shut(policy):
    led = AreaLedger("rice@BD-30", "m@1", policy)
    for i in range(50):                                      # 90% right: the lower bound stays under 0.85
        led.suggest(f"s-{i}", LABELS, SURE)
        led.judge(f"s-{i}", "blast" if i % 10 else "healthy", "o")
    s = led.stats()
    assert s["precision"] == 0.9 and s["lower_bound"] < 0.85 and s["gate_open"] is False


def _open(led):
    for i in range(30):
        led.suggest(f"s-{i}", LABELS, SURE)
        led.judge(f"s-{i}", "blast", "o")
    assert led.gate_open


def test_open_gate_answers_sure_cases_and_still_audits(policy):
    led = AreaLedger("rice@BD-30", "m@1", policy)
    _open(led)
    routes = [led.suggest(f"n-{i}", LABELS, SURE)["route"] for i in range(1000)]
    audited = routes.count("officer") / len(routes)
    assert 0.07 < audited < 0.13                             # about audit_rate
    assert led.suggest("unsure", LABELS, UNSURE)["route"] == "officer"


def test_drift_closes_the_gate(policy):
    led = AreaLedger("rice@BD-30", "m@1", policy)
    _open(led)
    event = None
    for i in range(30):                                      # the officer starts overruling sure answers
        led.suggest(f"d-{i}", LABELS, SURE)
        event = led.judge(f"d-{i}", "healthy", "o") or event
        if event:
            break
    assert event["event"] == "closed" and event["lower_bound"] < 0.80
    assert led.suggest("after", LABELS, SURE)["route"] == "officer"


def test_audit_choice_depends_only_on_the_server_case_id(policy):
    a, b = AreaLedger("rice@BD-30", "m@1", policy), AreaLedger("rice@BD-30", "m@1", policy)
    assert [a._audit_draw(f"c-{i}") for i in range(20)] == [b._audit_draw(f"c-{i}") for i in range(20)]


def test_ledger_persists_and_refuses_another_area(policy, tmp_path):
    path = tmp_path / "ledger.json"
    led = AreaLedger("rice@BD-30", "m@1", policy, path)
    _open(led)
    again = AreaLedger("rice@BD-30", "m@1", policy, path)
    assert again.stats() == led.stats() and again.gate_open
    with pytest.raises(LedgerError):
        AreaLedger("rice@BD-10", "m@1", policy, path)
    with pytest.raises(LedgerError):
        AreaLedger("rice@BD-30", "m@2", policy, path)        # a new model version starts from zero elsewhere
