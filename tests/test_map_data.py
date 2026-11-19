"""The Disease map's offline build (tools/build_map_data.py, builder M): GBIF counts with a MOCKED GBIF, the GADM-name
matching, the outline builder, and the files it wrote (they must agree with each other and with the rule packs)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from tools import build_map_data as bmd

ROOT = Path(__file__).resolve().parents[1]
MAP = ROOT / "apps" / "web" / "src" / "data" / "map"
RADAR = ROOT / "apps" / "web" / "src" / "features" / "officer" / "radar" / "geo"


# ------------------------------------------------------------------ name matching
def test_match_names_exact_variant_alias_fuzzy_and_unmatched():
    gadm = [
        {"id": "G.1_1", "name": "Dhaka"},                                   # exact
        {"id": "G.2_1", "name": "Chattogram", "variants": ["Chittagong"]},  # variant
        {"id": "G.3_1", "name": "Jashore"},                                 # alias
        {"id": "G.4_1", "name": "Narayangonj"},                             # fuzzy (one letter off)
        {"id": "G.5_1", "name": "Atlantis"},                                # nothing like it
    ]
    ours = [{"code": "BD-dhaka", "name": "Dhaka"}, {"code": "BD-chittagong", "name": "Chittagong"},
            {"code": "BD-jessore", "name": "Jessore"}, {"code": "BD-narayanganj", "name": "Narayanganj"},
            {"code": "BD-sylhet", "name": "Sylhet"}]
    m = bmd.match_names(gadm, ours, bmd.ALIASES["BD"])
    assert m["map"] == {"G.1_1": "BD-dhaka", "G.2_1": "BD-chittagong", "G.3_1": "BD-jessore", "G.4_1": "BD-narayanganj"}
    assert m["how"]["G.1_1"] == "exact" and m["how"]["G.2_1"] == "variant" and m["how"]["G.3_1"] == "alias"
    assert m["how"]["G.4_1"].startswith("fuzzy:")
    assert m["unmatched_gadm"] == [{"id": "G.5_1", "name": "Atlantis"}]
    assert m["unmatched_ours"] == [{"code": "BD-sylhet", "name": "Sylhet"}]


def test_accents_and_ampersands_do_not_block_a_match():
    m = bmd.match_names([{"id": "I.1_1", "name": "Andaman & Nicobar Islands"}, {"id": "I.2_1", "name": "Tamil Nadu"}],
                        [{"code": "IN-a", "name": "Andaman and Nicobar Islands"}, {"code": "IN-t", "name": "Tamil Nādu"}], {})
    assert m["map"] == {"I.1_1": "IN-a", "I.2_1": "IN-t"}


def test_an_alias_folds_two_merged_units_into_one_but_exact_matches_never_double_up():
    ours = [{"code": "IN-dnhdd", "name": "Dadra and Nagar Haveli and Daman and Diu"}, {"code": "IN-goa", "name": "Goa"}]
    gadm = [{"id": "I.8_1", "name": "Dadra and Nagar Haveli"}, {"id": "I.9_1", "name": "Daman and Diu"},
            {"id": "I.10_1", "name": "Goa"}, {"id": "I.11_1", "name": "Goa"}]
    m = bmd.match_names(gadm, ours, bmd.ALIASES["IN"])
    assert m["map"]["I.8_1"] == m["map"]["I.9_1"] == "IN-dnhdd"
    assert m["map"]["I.10_1"] == "IN-goa"
    assert "I.11_1" not in m["map"]                                       # a second "Goa" is reported, not merged
    assert m["unmatched_gadm"] == [{"id": "I.11_1", "name": "Goa"}]


# ------------------------------------------------------------------ GBIF, mocked
class FakeGbif:
    """Answers the three endpoints the build uses, from small fixed tables, and records every call."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def __call__(self, path: str, params: dict):
        self.calls.append((path, dict(params)))
        if path == "species/match":
            keys = {"Spodoptera frugiperda": 5109855, "Nilaparvata lugens": 2056628}
            k = keys.get(params["name"])
            return {"usageKey": k, "matchType": "EXACT", "scientificName": params["name"], "status": "ACCEPTED"} if k \
                else {"matchType": "NONE"}
        if path.startswith("geocode/gadm/"):
            gid = path.split("/")[2]
            return {
                "BGD": [{"id": "BGD.1_1", "name": "Dhaka"}, {"id": "BGD.2_1", "name": "Rajshahi"}],
                "BGD.1_1": [{"id": "BGD.1.1_1", "name": "Dhaka"}, {"id": "BGD.1.2_1", "name": "Tangail"}],
                "BGD.2_1": [],                                             # GADM lists no district here
                "KEN": [{"id": "KEN.1_1", "name": "Nakuru"}, {"id": "KEN.2_1", "name": "Tharaka-Nithi"}],
            }.get(gid, [])
        assert path == "occurrence/search"
        assert params["limit"] == 0                                        # facet counts only, never records
        c, k = params["country"], params["taxonKey"]
        if "gadmGid" in params:                                            # one area's years
            years = {("BD", 2056628, "BGD.1_1"): [("2019", 3), ("2020", 2)], ("BD", 2056628, "BGD.1.2_1"): [("2019", 3), ("2020", 1)],
                     ("BD", 2056628, "BGD.1.1_1"): [("2020", 1)], ("KE", 5109855, "KEN.2_1"): [("2018", 4)]}
            ys = years.get((c, k, params["gadmGid"]), [])
            return {"count": sum(n for _, n in ys), "facets": [{"field": "YEAR", "counts": [{"name": y, "count": n} for y, n in ys]}]}
        table = {
            ("BD", 2056628): {"count": 9, "YEAR": [("2019", 3), ("2020", 3)], "LICENSE": [("CC_BY_4_0", 8), ("CC0_1_0", 1)],
                              "BASIS_OF_RECORD": [("MATERIAL_SAMPLE", 9)], "GADM_LEVEL_1_GID": [("BGD.1_1", 6)],
                              "GADM_LEVEL_2_GID": [("BGD.1.2_1", 4), ("BGD.1.1_1", 1), ("XXX.9_1", 1)]},
            ("KE", 5109855): {"count": 7, "YEAR": [("2018", 4)], "LICENSE": [("CC_BY_4_0", 7)], "BASIS_OF_RECORD": [],
                              "GADM_LEVEL_1_GID": [("KEN.2_1", 5)]},
        }
        row = table.get((c, k), {"count": 0})
        facets = [{"field": f, "counts": [{"name": n, "count": v} for n, v in row.get(f, [])]}
                  for f in ("YEAR", "LICENSE", "BASIS_OF_RECORD", "GADM_LEVEL_1_GID", "GADM_LEVEL_2_GID")]
        return {"count": row["count"], "facets": facets}


@pytest.fixture
def small(monkeypatch):
    monkeypatch.setattr(bmd, "TAXA", [{"id": "faw", "names": ["Spodoptera frugiperda"], "problems": ["fall_armyworm"]},
                                      {"id": "bph", "names": ["Nilaparvata lugens"], "problems": ["brown_planthopper"]},
                                      {"id": "ghost", "names": ["Nonexistus fakeus"], "problems": []}])
    monkeypatch.setattr(bmd, "COUNTRIES", {"BD": {"iso3": "BGD", "levels": {"division": 1, "district": 2}},
                                           "KE": {"iso3": "KEN", "levels": {"county": 1}}})
    ours = {("BD", "division"): [{"code": "BD-div-dhaka", "name": "Dhaka"}, {"code": "BD-div-rajshahi", "name": "Rajshahi"}],
            ("BD", "district"): [{"code": "BD-dhaka", "name": "Dhaka"}, {"code": "BD-tangail", "name": "Tangail"},
                                 {"code": "BD-rajshahi", "name": "Rajshahi"}],
            ("KE", "county"): [{"code": "KE-nakuru", "name": "Nakuru"}, {"code": "KE-tharaka", "name": "Tharaka"}]}
    gbif = FakeGbif()
    data, prov = bmd.build_sightings(gbif, "2026-11-19", areas_of=lambda c, lv: ours[(c, lv)])
    return gbif, data, prov


def test_taxa_resolve_through_species_match_and_an_unknown_name_is_kept_as_unresolved(small):
    _, data, prov = small
    assert [t["key"] for t in data["taxa"]] == [5109855, 2056628, None]
    assert prov["taxa"][2]["matchType"] == "NONE"


def test_counts_per_area_with_years_and_unplaced_records(small):
    _, data, _ = small
    bph = data["countries"]["BD"]["taxa"]["bph"]
    assert bph["total"] == 9 and bph["years"] == [2019, 2020] and bph["dated"] == 6
    assert bph["licences"] == {"CC_BY_4_0": 8, "CC0_1_0": 1}
    div = bph["levels"]["division"]
    assert div == {"placed": 6, "unplaced": 0, "areas": {"BD-div-dhaka": {"n": 6, "y": [[2019, 3], [2020, 2]]}}}
    dist = bph["levels"]["district"]
    assert dist["areas"]["BD-tangail"] == {"n": 4, "y": [[2019, 3], [2020, 1]]}
    assert dist["areas"]["BD-dhaka"] == {"n": 1, "y": [[2020, 1]]}
    assert dist["placed"] == 5 and dist["unplaced"] == 1                   # the GADM id with no outline is counted apart
    # Kenya: GADM's "Tharaka-Nithi" reaches our "Tharaka" through the alias list
    assert data["countries"]["KE"]["taxa"]["faw"]["levels"]["county"]["areas"] == {"KE-tharaka": {"n": 5, "y": [[2018, 4]]}}
    # a pest with no records is still there, at zero
    assert data["countries"]["KE"]["taxa"]["bph"]["total"] == 0


def test_provenance_lists_the_matching_and_the_query_count(small):
    gbif, data, prov = small
    assert prov["queries"] == len(gbif.calls)
    ke = prov["countries"]["KE"]["levels"]["county"]
    assert ke["matched"] == 2 and ke["how"]["Tharaka-Nithi"] == "alias -> KE-tharaka"
    assert prov["countries"]["BD"]["levels"]["district"]["unmatched_ours"] == [{"code": "BD-rajshahi", "name": "Rajshahi"}]
    assert data["citation"].startswith("GBIF.org (19 November 2026)")
    assert "CC BY-NC 4.0" in data["citation"]
    # the site never calls GBIF: every query here was a facet count (limit=0) or a name lookup
    assert all(p != "occurrence/search" or q["limit"] == 0 for p, q in gbif.calls)


def test_bangladesh_shows_districts_only_when_records_reach_enough_districts(small):
    _, data, _ = small
    assert bmd.choose_bd_level(data, min_districts=10) == "division"
    assert bmd.choose_bd_level(data, min_districts=2) == "district"


# ------------------------------------------------------------------ outlines
def test_build_geo_projects_simplifies_and_fixes_the_source_typo():
    sq = lambda x0, y0: [[[x0, y0], [x0 + 1, y0], [x0 + 1, y0 + 1], [x0, y0 + 1], [x0, y0]]]  # noqa: E731
    gj = {"features": [{"properties": {"shapeName": "Rajshani"}, "geometry": {"type": "Polygon", "coordinates": sq(88, 24)}},
                       {"properties": {"shapeName": "Dhākā"}, "geometry": {"type": "Polygon", "coordinates": sq(90, 23)}}]}
    web, rings = bmd.build_geo("BD", "division", gj, tolerance=0.01, min_island=0.0, code_prefix="BD-div-", meta={"source": "s", "licence": "l", "url": "u"})
    assert [a["code"] for a in web["areas"]] == ["BD-div-dhaka", "BD-div-rajshahi"]
    assert [a["name"] for a in web["areas"]] == ["Dhaka", "Rajshahi"]
    assert web["viewBox"][2] == 1000 and all(a["d"].startswith("M") and a["d"].endswith("z") for a in web["areas"])
    # the label point is inside its own square, and inverts back to the square's centre
    p = web["projection"]
    for a, (cx, cy) in zip(web["areas"], [(90.5, 23.5), (88.5, 24.5)]):
        lon = p["lon_min"] + a["label"][0] / (p["k"] * p["scale"])
        lat = p["lat_max"] - a["label"][1] / p["scale"]
        assert abs(lon - cx) < 0.01 and abs(lat - cy) < 0.01


# ------------------------------------------------------------------ the files in the repo
def _load(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def test_every_counted_area_exists_in_its_outline_file():
    s = _load(MAP / "sightings.json")
    outlines = {("BD", "district"): RADAR / "bd.json", ("BD", "division"): MAP / "geo-bd-div.json",
                ("IN", "state"): MAP / "geo-in.json", ("KE", "county"): RADAR / "ke.json"}
    for (c, lv), f in outlines.items():
        codes = {a["code"] for a in _load(f)["areas"]}
        for t in s["countries"][c]["taxa"].values():
            assert set(t["levels"][lv]["areas"]) <= codes, (c, lv)
            assert t["levels"][lv]["placed"] == sum(a["n"] for a in t["levels"][lv]["areas"].values())
            assert t["levels"][lv]["placed"] <= t["total"]


def test_name_matching_rate_is_recorded_and_complete_where_it_can_be():
    prov = _load(MAP / "sightings_provenance.json")
    for c, lv in (("BD", "division"), ("BD", "district"), ("KE", "county"), ("IN", "state")):
        m = prov["countries"][c]["levels"][lv]
        assert m["unmatched_gadm"] == [], (c, lv)                          # every GADM unit found an outline
    # GADM has no Ladakh unit (it sits inside GADM's Jammu and Kashmir, filed under the disputed-area code Z01)
    assert [a["name"] for a in prov["countries"]["IN"]["levels"]["state"]["unmatched_ours"]] == ["Ladakh"]


def test_bangladesh_divisions_hold_all_64_districts_once():
    div = _load(MAP / "geo-bd-div.json")
    kids = [d for a in div["areas"] for d in a["districts"]]
    assert len(div["areas"]) == 8 and len(kids) == 64 == len(set(kids))
    assert set(kids) == {a["code"] for a in _load(RADAR / "bd.json")["areas"]}


def test_india_outline_carries_its_source_licence_and_caveat():
    g = _load(MAP / "geo-in.json")
    assert len(g["areas"]) == 36 and g["licence"] == "CC BY 2.5 IN" and "disputed" in g["caveat"]


def test_what_to_watch_matches_the_rule_packs_exactly():
    """watch.json is the rules' own titles and sources: rebuilding it from the YAML gives the same file (no drift)."""
    assert bmd.build_watch() == _load(MAP / "watch.json")
