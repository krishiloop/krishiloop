"""Climate-Smart Shield (services/engine/climate.py) and the visit booking (services/engine/climate_visit.py).

The shield is a pure function of the planner's snapshot: each check is warn / clear / unknown (unknown is never "no
risk"), a warning tied to a sourced rule cites it (and never a recalled version), every threshold says it is team-set,
and the recorded answers the web app shows without an API are exactly what this code computes.
"""
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from services.engine import climate, climate_visit, inbox
from services.engine.planner import DEMO_FIELDS, DEMO_PROFILES

ROOT = Path(__file__).resolve().parents[1]
TODAY = date(2026, 11, 19)
BD = {**DEMO_FIELDS["BD-SAMPLE-02"]}          # rice, tillering
BD_GRAIN = {**DEMO_FIELDS["BD-SAMPLE-01"]}    # rice, grain fill
KE = {**DEMO_FIELDS["KE-SAMPLE-01"]}          # potato, vegetative


def snap(days, flood=None, country="BD", mode="live", created="2026-11-19T06:00:00Z"):
    out = []
    for i, d in enumerate(days):
        out.append({"date": (TODAY + timedelta(days=i)).isoformat(), **d})
    return {"snapshot_id": "snap-test", "field_id": "x", "mode": mode, "created_at": created,
            "location": {"country": country, "precision": "sample_location"},
            "forecast": {"source": "open-meteo:forecast", "issued_at": created, "days": out}, "flood": flood}


CALM_BD = [{"precip_mm": 0.0, "tmax_c": 30.0, "tmin_c": 20.0, "rh_mean_pct": 65}] * 7
CALM_KE = [{"precip_mm": 1.0, "tmax_c": 19.0, "tmin_c": 7.0, "rh_mean_pct": 80}] * 7


def by_kind(report):
    return {c["kind"]: c for c in report["checks"]}


def test_a_calm_week_is_clear_but_no_river_forecast_is_unknown_never_no_risk():
    r = climate.shield(snap(CALM_BD), BD, DEMO_PROFILES["demo-farmer-d"], TODAY)
    k = by_kind(r)
    assert [c["kind"] for c in r["checks"]] == list(climate.KINDS)
    assert k["heavy_rain"]["level"] == k["heat"]["level"] == k["disease"]["level"] == "clear"
    assert k["flood"]["level"] == "unknown" and k["flood"]["reason"] == "no_river_forecast"
    assert r["warnings"] == 0 and r["window"] == {"from": "2026-11-19", "to": "2026-11-25", "days": 7}


def test_heavy_rain_at_tillering_cites_brri_no_urea_after_a_thunderstorm():
    days = [dict(d) for d in CALM_BD]
    days[2]["precip_mm"] = 48.0
    days[3]["precip_mm"] = 20.0      # exactly the pack's team-set 20 mm/day counts
    k = by_kind(climate.shield(snap(days), BD, DEMO_PROFILES["demo-farmer-d"], TODAY))
    rain = k["heavy_rain"]
    assert rain["level"] == "warn" and rain["days"] == ["2026-11-21", "2026-11-22"]
    assert rain["peak"] == {"date": "2026-11-21", "value": 48.0, "unit": "mm"}
    assert rain["rule"]["rule_id"] == "R-BDR-009" and rain["rule"]["applies"] is True
    assert "urea" in rain["rule"]["title"]["en"] and rain["rule"]["title"]["bn"]
    assert rain["rule"]["source"]["page"] == 2 and rain["rule"]["source"]["quote"] == "ঝড়োবৃষ্টির পর ইউরিয়া সার দেয়া যাবে না"
    # the threshold is the pack's reviewer parameter, labelled team-set and not from the source
    th = rain["thresholds"][0]
    assert th["name"] == "heavy_rain_mm" and th["value"] == 20 and th["set_by"] == "team" and "NOT from source" in th["note"]


def test_the_urea_rule_is_not_cited_at_a_stage_it_does_not_cover():
    days = [dict(d) for d in CALM_BD]
    days[1]["precip_mm"] = 60.0
    rain = by_kind(climate.shield(snap(days), BD_GRAIN, DEMO_PROFILES["demo-farmer-d"], TODAY))["heavy_rain"]
    assert rain["level"] == "warn" and rain["rule"] is None          # R-BDR-009 is for tillering, booting, heading


def test_a_recalled_rule_is_never_cited_and_the_warning_says_it_was_withdrawn():
    days = [dict(d) for d in CALM_BD]
    days[0]["precip_mm"] = 30.0
    rain = by_kind(climate.shield(snap(days), BD, None, TODAY,
                                  is_recalled=lambda r, v: (r, v) == ("R-BDR-009", 1)))["heavy_rain"]
    assert rain["level"] == "warn" and rain["rule"] is None and rain["rule_withdrawn"] == "R-BDR-009 v1"


def test_potato_rain_cites_the_cip_quote_only_never_the_no_spray_action():
    days = [dict(d) for d in CALM_KE]
    days[4]["precip_mm"] = 14.0
    rain = by_kind(climate.shield(snap(days, country="KE"), KE, DEMO_PROFILES["demo-farmer-a"], TODAY))["heavy_rain"]
    assert rain["level"] == "warn" and rain["rule"]["rule_id"] == "R-PLB-011"
    assert rain["rule"]["title"] is None and rain["rule"]["applies"] is False
    assert "washed away by rain" in rain["rule"]["source"]["quote"] and rain["rule"]["source"]["page"] == 24


def test_late_blight_weather_cites_the_potato_rule_only_where_its_whole_condition_holds():
    humid = [{"precip_mm": 2.0, "tmax_c": 19.0, "tmin_c": 11.0, "rh_mean_pct": 92}] * 3 + CALM_KE[:4]
    s = snap(humid, country="KE")
    open_crop = by_kind(climate.shield(s, KE, DEMO_PROFILES["demo-farmer-a"], TODAY))["disease"]
    assert open_crop["level"] == "warn" and open_crop["peak"]["value"] == 3 and len(open_crop["days"]) == 3
    assert open_crop["rule"]["rule_id"] == "R-PLB-008" and open_crop["rule"]["applies"] is True
    assert "contact your officer" in open_crop["rule"]["title"]["en"]
    assert "moderate temperatures and high humidity" in open_crop["rule"]["source"]["quote"]
    names = {t["name"] for t in open_crop["thresholds"]}
    assert names == {"humid_rh_pct_min", "mild_temp_c_range", "humid_mild_days_min"}
    assert all(t["set_by"] == "team" for t in open_crop["thresholds"])
    protected = by_kind(climate.shield(s, KE, DEMO_PROFILES["demo-farmer-b"], TODAY))["disease"]
    assert protected["level"] == "warn" and protected["rule"] is None   # R-PLB-008 is for unprotected crops


def test_without_the_farmer_profile_the_rule_is_quoted_but_its_action_is_not_shown():
    humid = [{"precip_mm": 2.0, "tmax_c": 19.0, "tmin_c": 11.0, "rh_mean_pct": 92}] * 3 + CALM_KE[:4]
    d = by_kind(climate.shield(snap(humid, country="KE"), KE, None, TODAY))["disease"]
    assert d["rule"]["rule_id"] == "R-PLB-008" and d["rule"]["applies"] is False and d["rule"]["title"] is None


def test_heat_uses_the_team_threshold_and_a_verified_fact_for_why_it_matters():
    days = [dict(d) for d in CALM_BD]
    days[5]["tmax_c"] = 36.4
    heat = by_kind(climate.shield(snap(days), BD, None, TODAY))["heat"]
    assert heat["level"] == "warn" and heat["days"] == ["2026-11-24"]
    assert heat["thresholds"] == [climate.TEAM_PARAMS["heat_tmax_c"]] and heat["thresholds"][0]["set_by"] == "team"
    assert heat["context"]["fact_id"] == "B9" and "21,292 ha" in heat["context"]["text"]["en"]
    # no Bangladesh fact for a Kenyan field
    ke_days = [dict(d) for d in CALM_KE]
    ke_days[0]["tmax_c"] = 35.0
    assert by_kind(climate.shield(snap(ke_days, country="KE"), KE, None, TODAY))["heat"]["context"] is None


def test_a_rising_glofas_trend_warns_and_a_falling_one_is_clear():
    q = [{"date": (TODAY + timedelta(days=i)).isoformat(), "m3s": v} for i, v in enumerate([400, 450, 520, 600, 640, 700, 760])]
    rising = by_kind(climate.shield(snap(CALM_BD, flood={"source": "glofas:open-meteo-flood", "trend": "rising", "discharge": q}),
                                    BD, None, TODAY))["flood"]
    assert rising["level"] == "warn" and rising["peak"]["value"] == 760 and rising["context"]["fact_id"] == "B6"
    falling = by_kind(climate.shield(snap(CALM_BD, flood={"trend": "falling", "discharge": q[::-1]}), BD, None, TODAY))["flood"]
    assert falling["level"] == "clear"


def test_missing_or_short_or_stale_forecasts_make_every_check_unknown():
    none = climate.shield({"snapshot_id": "s", "mode": "unavailable", "forecast": None, "created_at": "2026-11-19T00:00:00Z"},
                          BD, None, TODAY)
    assert {c["level"] for c in none["checks"]} == {"unknown"} and none["window"] is None
    short = climate.shield(snap(CALM_BD[:3]), BD, None, TODAY)
    assert {c["reason"] for c in short["checks"] if c["kind"] != "flood"} == {"too_few_days"}
    gap = [dict(d) for d in CALM_BD]
    del gap[2]["precip_mm"]
    assert by_kind(climate.shield(snap(gap), BD, None, TODAY))["heavy_rain"]["reason"] == "missing_variable"
    stale = climate.shield(snap(CALM_BD, mode="snapshot", created="2026-11-01T00:00:00Z"), BD, None, TODAY, max_age_h=36)
    assert {c["reason"] for c in stale["checks"]} == {"data_stale"}


def test_days_before_today_are_ignored():
    days = [dict(d) for d in CALM_BD]
    days[0]["precip_mm"] = 80.0          # yesterday's storm is not this week's warning
    r = climate.shield(snap(days), BD, None, TODAY + timedelta(days=1))
    assert by_kind(r)["heavy_rain"]["level"] == "clear" and r["window"]["days"] == 6


def test_no_check_ever_carries_a_dose():
    days = [dict(d) for d in CALM_BD]
    days[0]["precip_mm"] = 50.0
    text = json.dumps(climate.shield(snap(days), BD, None, TODAY), ensure_ascii=False).lower()
    for unit in ("kg/", "g/l", "ml/", "per bigha", "per acre", "per hectare", "/ha"):
        assert unit not in text


def test_the_recorded_answers_the_web_app_shows_are_exactly_this_code():
    assert json.loads(climate.RECORDED_OUT.read_text(encoding="utf-8")) == json.loads(json.dumps(climate.recorded())), \
        "run: python -m services.engine.climate --record"


def test_the_simulated_week_is_marked_simulated_and_shows_the_rule_linked_warnings():
    sim = climate.recorded()["simulated"]["BD-SAMPLE-02|demo-farmer-d"]
    assert sim["data_mode"] == "simulated" and sim["snapshot_id"].endswith("-SIMULATED")
    k = by_kind(sim)
    assert k["heavy_rain"]["rule"]["rule_id"] == "R-BDR-009" and k["heat"]["level"] == "warn" and k["flood"]["level"] == "warn"


# ---------------------------------------------------------------------------------------------- visit booking
def test_a_visit_request_becomes_an_officer_case_with_the_phone_masked(tmp_path):
    r = climate_visit.create("BD-SAMPLE-02", "demo-farmer-d",
                             {"date": "2026-11-21", "slot": "morning", "mode": "call", "phone": "+880 1712-345678",
                              "note": "Leaves turning yellow\x07 near the canal"}, tmp_path, today=TODAY)
    assert r["phone_masked"] == "+880" + "•" * 8 + "78" and r["status"] == "open"
    item = inbox.get_item(r["item_id"], tmp_path)
    assert item["reason_code"] == "visit_request" and item["question"] == "Leaves turning yellow near the canal"
    assert item["details"]["requested_date"] == "2026-11-21" and item["details"]["slot"] == "morning"
    raw = (tmp_path / f"{r['item_id']}.json").read_text(encoding="utf-8")
    assert "1712345678" not in raw and "712345678" not in raw            # the full number is never written


@pytest.mark.parametrize("req,why", [
    ({"date": "2026-11-18", "slot": "morning"}, "within the next"),
    ({"date": "2026-12-04", "slot": "morning"}, "within the next"),
    ({"date": "21-11-2026", "slot": "morning"}, "YYYY-MM-DD"),
    ({"date": "2026-11-20", "slot": "midnight"}, "slot"),
    ({"date": "2026-11-20", "slot": "evening", "mode": "fax"}, "mode"),
    ({"date": "2026-11-20", "slot": "evening", "phone": "12ab"}, "phone"),
    ({"date": "2026-11-20", "slot": "evening", "mode": "call"}, "phone number"),
])
def test_bad_bookings_are_refused_with_a_plain_reason(req, why):
    with pytest.raises(climate_visit.VisitError, match=why):
        climate_visit.check(req, TODAY)


def test_the_booking_window_is_today_to_14_days_ahead():
    assert climate_visit.check({"date": TODAY.isoformat(), "slot": "afternoon"}, TODAY)["date"] == "2026-11-19"
    assert climate_visit.check({"date": "2026-12-03", "slot": "afternoon"}, TODAY)["date"] == "2026-12-03"
    long = climate_visit.check({"date": "2026-11-20", "slot": "afternoon", "note": "x" * 999}, TODAY)
    assert len(long["note"]) == climate_visit.NOTE_MAX and long["phone"] is None
