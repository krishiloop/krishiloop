"""tools/build_offices.py: the offices data build, with the network mocked, and the distance sort."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import build_offices as bo  # noqa: E402


def square(lon: float, lat: float, d: float = 0.1) -> dict:
    return {"type": "Polygon", "coordinates": [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]]}


ADM3 = {"features": [
    {"properties": {"shapeName": "Trishal"}, "geometry": square(90.4, 24.56)},
    {"properties": {"shapeName": "Gauripur"}, "geometry": square(90.58, 24.75)},
    {"properties": {"shapeName": "Teknaf"}, "geometry": square(92.3, 21.0)},
]}
ADM2 = {"features": [
    {"properties": {"shapeName": "Mymensingh"}, "geometry": square(90.5, 24.7, 0.5)},
    {"properties": {"shapeName": "Cox's Bazar"}, "geometry": square(92.0, 21.2, 0.8)},
]}

PAGE = """
<table><tbody>
<tr><td>নাম</td><td>মেহেদী হাসান</td></tr>
<tr><td>পদবি</td><td><rt-renderer encoded-content="x">উপজেলা কৃষি অফিসার</rt-renderer></td></tr>
<tr><td>অফিস</td><td>কৃষি সম্প্রসারণ অধিদপ্তর, ত্রিশাল, ময়মনসিংহ</td></tr>
<tr><td>ইমেইল</td><td>uao<wbr>@gmail.com</td></tr></tbody></table>
<table><tbody><tr><td>ফোন (অফিস)</td><td>০৯০৩২৫৬০০৫</td></tr><tr><td>মোবাইল</td><td>০১৭০০৭১৫৭৯৫</td></tr></tbody></table>
<span class="download-vcard-btn">ভিকার্ড ডাউনলোড করুন</span>
<tr><td>নাম</td><td>অন্য কেউ</td></tr><tr><td>পদবি</td><td>উপ-সহকারী কৃষি কর্মকর্তা</td></tr><tr><td>মোবাইল</td><td>০১৯০০০০০০০০</td></tr> ভিকার্ড
"""


def fake_fetch(url: str, data=None) -> bytes:
    if url == "https://dae.trishal.mymensingh.gov.bd/pages/officers":
        return PAGE.encode("utf8")
    raise RuntimeError("404")


def test_digits_and_haversine():
    assert bo._digits("০৯০৩২৫৬০০৫") == "0903256005"
    assert bo.haversine_km(0, 0, 1, 0) == pytest.approx(111.2, abs=0.2)
    assert bo.haversine_km(24.75, 90.4, 24.75, 90.4) == 0


def test_parse_officers_takes_only_the_head_and_drops_non_gov_email():
    got = bo.parse_officers(PAGE)
    assert got["name_bn"] == "মেহেদী হাসান"
    assert got["designation_bn"] == "উপজেলা কৃষি অফিসার"
    assert got["email"] is None  # a gmail address is not kept
    assert bo.bn_places(got["office_line_bn"]) == ("ত্রিশাল", "ময়মনসিংহ")
    assert bo.parse_officers("<p>nothing</p>") is None


def test_gov_email_is_kept():
    page = PAGE.replace("uao<wbr>@gmail.com", "uao.trishal@dae.gov.bd")
    assert bo.parse_officers(page)["email"] == "uao.trishal@dae.gov.bd"


def test_centre_inside_and_district_assignment():
    lon, lat = bo.centre_of(square(90.4, 24.56))
    assert (lon, lat) == pytest.approx((90.4, 24.56), abs=1e-6)
    assert bo.in_geom(lon, lat, ADM2["features"][0]["geometry"])


def test_build_with_mocked_network():
    d = bo.build(ADM3, ADM2, "2026-11-20", fake_fetch, workers=2)
    assert d["meta"]["count"] == 3
    by = {o["upazila_en"]: o for o in d["offices"]}
    t = by["Trishal"]
    assert t["district_en"] == "Mymensingh" and t["geo"] == "upazila_centre"
    assert t["phone"] == "0903256005"
    assert t["officer"]["mobile"] == "01700715795" and t["officer"]["designation_en"] == "Upazila Agriculture Officer"
    assert t["source_url"].startswith("https://dae.trishal.mymensingh.gov.bd") and t["source_read"] == "2026-11-20"
    assert t["name_bn"] == "উপজেলা কৃষি অফিস, ত্রিশাল"
    # no page found: no contact, no officer, no source invented
    g = by["Gauripur"]
    assert g["phone"] is None and g["officer"] is None and g["source_url"] is None and g["name_bn"] is None
    assert by["Teknaf"]["district_en"] == "Cox's Bazar"
    assert d["national"]["phone"] == "16123"
    assert d["meta"]["with_phone"] == 1 and d["meta"]["with_officer"] == 1
    json.dumps(d, ensure_ascii=False)


def test_osm_point_replaces_the_centre():
    pts = [{"lat": 24.57, "lon": 90.41, "name": "Upazila Agriculture Office", "id": "node/1", "phone": None}]
    d = bo.build(ADM3, ADM2, "2026-11-20", fake_fetch, portal=False, osm=pts)
    t = next(o for o in d["offices"] if o["upazila_en"] == "Trishal")
    assert t["geo"] == "osm_point" and (t["lat"], t["lon"]) == (24.57, 90.41) and "node/1" in t["geo_source"]
    assert t["phone"] is None


def test_osm_points_survive_a_failing_tile():
    calls = {"n": 0}

    def f(url, data=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("timeout")
        return json.dumps({"elements": [{"type": "node", "id": 7, "lat": 24.5, "lon": 90.3, "tags": {"name": "Trishal Upazila Agriculture Office", "phone": "0123"}}]}).encode()

    pts = bo.osm_points(f, [(24, 90, 25, 91), (24, 90, 25, 91)])
    assert len(pts) == 1 and pts[0]["id"] == "node/7"


def test_nearest_sort():
    offices = [{"id": "far", "lat": 26.0, "lon": 90.0}, {"id": "near", "lat": 24.76, "lon": 90.41}, {"id": "mid", "lat": 24.9, "lon": 90.4}]
    r = bo.nearest(offices, 24.75, 90.4, 2)
    assert [o["id"] for _, o in r] == ["near", "mid"]
    assert r[0][0] < r[1][0]


def test_committed_data_is_honest():
    p = Path(__file__).resolve().parents[1] / "apps" / "web" / "src" / "data" / "offices" / "bd.json"
    if not p.exists():
        pytest.skip("data not built")
    d = json.loads(p.read_text("utf8"))
    assert d["national"]["phone"] == "16123"
    ids = [o["id"] for o in d["offices"]]
    assert len(ids) == len(set(ids)) and len(ids) > 400
    for o in d["offices"]:
        assert 20 < o["lat"] < 27 and 87 < o["lon"] < 93
        assert o["geo"] in ("upazila_centre", "osm_point")
        if o["phone"] or o["officer"]:
            assert o["source_url"] and o["source_read"]  # no contact without a source
        if o["email"]:
            assert o["email"].endswith(".gov.bd")
    assert any(o["district_en"] == "Mymensingh" for o in d["offices"])
