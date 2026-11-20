"""NASA IMERG rainfall build (tools/nasa_imerg.py): the OPeNDAP reply parser, the grid indices, and the per-district summing on a
tiny fake grid. No network and no key."""
from __future__ import annotations

import json
from pathlib import Path

from tools import nasa_imerg as ni

ROOT = Path(__file__).resolve().parents[1]


def test_grid_indices_match_the_0_1_degree_centres():
    assert ni.centre_lon(ni.lon_index(90.05)) == pytest_approx(90.05)
    assert ni.centre_lat(ni.lat_index(23.85)) == pytest_approx(23.85)
    assert ni.lon_index(88.05) == 2680  # checked against the file's own lon array


def pytest_approx(x):
    import pytest

    return pytest.approx(x, abs=1e-6)


def test_parse_ascii_reads_rows_by_coordinate_and_turns_the_fill_value_into_none():
    text = (
        "Dataset: x.nc4\n"
        "precipitation.lat, 20.65, 20.75, 20.85\n"
        "precipitation.precipitation[precipitation.time=17118][precipitation.lon=88.05], 36.5, -9999.9, 27.6\n"
        "precipitation.precipitation[precipitation.time=17118][precipitation.lon=88.15], 30.0, 29.75, 30.5\n"
    )
    cells = ni.parse_ascii(text)
    assert cells[(2680, ni.lat_index(20.65))] == 36.5
    assert cells[(2680, ni.lat_index(20.75))] is None  # fill value: no data, never a number
    assert cells[(2681, ni.lat_index(20.85))] == 30.5
    assert len(cells) == 6


def test_district_mean_uses_only_cell_centres_inside_and_skips_missing():
    # a square district from lon 90.0 to 90.2 and lat 23.0 to 23.2: centres 90.05/90.15 x 23.05/23.15 are inside
    sq = [(90.0, 23.0), (90.2, 23.0), (90.2, 23.2), (90.0, 23.2)]
    far = [(91.0, 24.0), (91.1, 24.0), (91.1, 24.1), (91.0, 24.1)]
    districts = {"Sq": {"rings": [sq], "label": (90.1, 23.1)}, "Far": {"rings": [far], "label": (91.05, 24.05)}}
    i, j = ni.lon_index(90.05), ni.lat_index(23.05)
    grid = {
        (i, j): 10.0,
        (i + 1, j): 20.0,
        (i, j + 1): 30.0,
        (i + 1, j + 1): None,  # missing: left out of the mean
        (i + 5, j): 999.0,  # outside both
    }
    res, fb = ni.district_means(grid, districts)
    assert res["Sq"] == 20.0  # (10 + 20 + 30) / 3
    assert res["Far"] is None and fb == []


def test_a_district_with_no_cell_centre_takes_the_cell_of_its_label_point():
    tiny = [(90.01, 23.01), (90.03, 23.01), (90.03, 23.03), (90.01, 23.03)]
    d = {"Tiny": {"rings": [tiny], "label": (90.02, 23.02)}}
    grid = {(ni.lon_index(90.05), ni.lat_index(23.05)): 7.5}
    res, fb = ni.district_means(grid, d)
    assert res["Tiny"] == 7.5 and fb == ["Tiny"]


def test_the_real_district_outlines_load_and_each_has_a_ring():
    geo = json.loads((ROOT / "apps/web/src/features/officer/radar/geo/bd.json").read_text(encoding="utf-8"))
    d = ni.district_rings(geo)
    assert len(d) == 64 and all(v["rings"] for v in d.values())
    # Dhaka's label point is inside Bangladesh's box
    lon, lat = d["Dhaka"]["label"]
    assert 90.0 < lon < 90.8 and 23.4 < lat < 24.2


def test_the_written_file_if_present_agrees_with_itself():
    p = ROOT / "apps/web/src/data/nasa/imerg_bd.json"
    if not p.exists():
        return
    doc = json.loads(p.read_text(encoding="utf-8"))
    assert len(doc["days"]) == 7 and doc["run"] == "Late"
    assert doc["districts"] and all(v is None or v >= 0 for v in doc["districts"].values())
