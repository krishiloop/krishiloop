"""Combine the raw benchmark files into ml/sovereign/sovereign_benchmark.json, with capacity and energy under stated,
editable assumptions.

  python ml/sovereign/summarise.py [--raw ml/sovereign/raw] [--out ml/sovereign/sovereign_benchmark.json]
                                   [--active-hours 12] [--utilisation 0.5] [--weeks 17] [--price-per-kwh <number>]

Nothing here is measured from farmers. The farmer-week bundle, active hours, utilisation and season length are
assumptions, written into the output next to every number that depends on them. Energy is GPU board power from
nvidia-smi only (no wall meter): CPU, memory, disks and power-supply losses are not included.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUNDLE = {"session": 1, "plan": 1, "ask": 2, "photo": 1, "verify": 1}


def load(p: Path):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def best(rows: list[dict], key: str = "per_s") -> dict | None:
    rows = [r for r in rows or [] if r.get(key) is not None]
    return max(rows, key=lambda r: r[key]) if rows else None


def latency_table(api: dict) -> dict:
    lat = api["latency_sequential"]
    keys = ("plan_fresh_store", "plan_warm_store", "verify", "verify_official", "recall", "ask", "photo")
    return {k: {m: lat[k].get(m) for m in ("n", "p50_ms", "p95_ms", "mean_ms")} for k in keys if k in lat}


def throughput_table(api: dict) -> dict:
    return {ep: [{k: r.get(k) for k in ("concurrency", "per_s", "p50_ms", "p95_ms", "errors")} |
                 ({"gpu_w": r["gpu"].get("power_mean_w"), "gpu_util_pct": r["gpu"].get("util_mean_pct")} if r.get("gpu") else {})
                 for r in rows] for ep, rows in api.get("throughput", {}).items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=str(HERE / "raw"))
    ap.add_argument("--out", default=str(HERE / "sovereign_benchmark.json"))
    ap.add_argument("--active-hours", type=float, default=12.0)
    ap.add_argument("--utilisation", type=float, default=0.5)
    ap.add_argument("--weeks", type=float, default=17.0)
    ap.add_argument("--pilot-farmers", type=int, default=10000)
    ap.add_argument("--price-per-kwh", type=float, default=None)
    a = ap.parse_args()
    raw = Path(a.raw)
    gpu_api, cpu_api = load(raw / "api_nbtc5090_gpu.json"), load(raw / "api_laptop_cpu.json")
    # model run 2 started on a quiet GPU (idle 34 W); run 1 shared the GPU with another track's job (baseline ~260 W)
    gpu_model = load(raw / "model_nbtc5090_gpu_run2.json") or load(raw / "model_nbtc5090_gpu.json")
    gpu_model_shared = load(raw / "model_nbtc5090_gpu.json") if (raw / "model_nbtc5090_gpu_run2.json").exists() else None
    cpu_model = load(raw / "model_laptop_cpu.json")
    clean_idle_w = ((gpu_model or {}).get("gpu_idle_before_load") or {}).get("power_mean_w")
    serve = {k: load(raw / f"serve_{k}_report.json") for k in ("nbtc5090", "laptop")}

    out: dict = {
        "what": "KrishiLoop sovereign mode: the whole API (deterministic planner, signed receipts, recall, Ask router, "
                "BioCLIP 2 photo reading) on one in-country PC with an RTX 5090, no cloud calls; the laptop's CPU-only "
                "API as the baseline. Same script, same code, same inputs on both machines.",
        "licence_note": "The RTX 5090 is a GeForce card: NVIDIA's GeForce driver licence does not allow data-centre "
                        "deployment. This is a benchmark and proof of concept; production in-country deployments would "
                        "use data-centre GPUs.",
        "no_cloud_evidence": {k: (v or {}).get("outbound_requests_refused") for k, v in serve.items()},
        "machines": {"nbtc5090": (gpu_api or gpu_model or {}).get("machine"), "laptop": (cpu_api or cpu_model or {}).get("machine")},
        "latency_sequential_ms": {},
        "throughput_per_s": {},
    }
    if gpu_api:
        out["latency_sequential_ms"]["nbtc5090_gpu"] = latency_table(gpu_api)
        out["throughput_per_s"]["nbtc5090_gpu"] = throughput_table(gpu_api)
        out["gpu_idle_with_api_loaded"] = gpu_api.get("gpu_idle")
        out["gpu_apps"] = {"start": gpu_api.get("gpu_apps_at_start"), "end": gpu_api.get("gpu_apps_at_end")}
    if cpu_api:
        out["latency_sequential_ms"]["laptop_cpu"] = latency_table(cpu_api)
        out["throughput_per_s"]["laptop_cpu"] = throughput_table(cpu_api)
    if gpu_model:
        out["photo_model_gpu"] = {"parity": {k: v for k, v in (gpu_model.get("parity") or {}).items() if k != "rows"},
                                  "providers_active": gpu_model.get("providers_active"), "model": gpu_model.get("model"),
                                  "batched": [{k: r.get(k) for k in ("batch", "photos_per_s", "ms_per_batch", "vram_above_idle_mib")} |
                                              {"gpu_w": (r.get("gpu") or {}).get("power_mean_w"),
                                               "j_per_photo_gross": (r.get("gpu_energy") or {}).get("gross_j_per_item"),
                                               "j_per_photo_net": (r.get("gpu_energy") or {}).get("net_j_per_item")}
                                              for r in gpu_model.get("model_throughput", [])],
                                  "pipeline": gpu_model.get("pipeline_throughput"),
                                  "gpu_idle_before_load": gpu_model.get("gpu_idle_before_load")}
    if gpu_model_shared:
        out["photo_model_gpu_shared_run"] = {
            "note": "first run, while another track's job kept the GPU about 60% busy (baseline 259 W)",
            "batched": [{k: r.get(k) for k in ("batch", "photos_per_s", "ms_per_batch", "vram_above_idle_mib")}
                        for r in gpu_model_shared.get("model_throughput", [])],
            "pipeline_photos_per_s": (gpu_model_shared.get("pipeline_throughput") or {}).get("photos_per_s")}
    if cpu_model:
        out["photo_model_laptop_cpu"] = {"batched": [{k: r.get(k) for k in ("batch", "photos_per_s", "ms_per_batch")}
                                                     for r in cpu_model.get("model_throughput", [])],
                                         "pipeline": cpu_model.get("pipeline_throughput")}

    # ---------------- capacity and energy (assumptions written next to the numbers)
    assumptions = {
        "farmer_week_bundle": BUNDLE,
        "farmer_week_note": "ASSUMED weekly use per farmer: one session, one weekly plan, two questions, one photo, one "
                            "receipt check. Recalls are officer actions per rule version, not per farmer, so they are "
                            "left out. Not measured from farmers.",
        "active_hours_per_day": a.active_hours, "target_utilisation": a.utilisation,
        "season_weeks": a.weeks,
        "season_note": "ASSUMED season length (about 120 days); a parameter, not a fact-register value.",
        "electricity_price_per_kwh": a.price_per_kwh,
        "price_note": "No price is assumed: multiply kWh by your tariff." if a.price_per_kwh is None else "price given on the command line",
    }
    out["assumptions"] = assumptions
    cap = {}
    for name, api in (("nbtc5090_gpu", gpu_api), ("laptop_cpu", cpu_api)):
        if not api or not api.get("mixed_farmer_week"):
            continue
        m = best(api["mixed_farmer_week"])
        per_day_planning = m["per_s"] * 3600 * a.active_hours * a.utilisation
        entry = {"measured_bundles_per_s": m["per_s"], "at_concurrency": m["concurrency"], "bundle_p50_ms": m.get("p50_ms"),
                 "bundle_p95_ms": m.get("p95_ms"), "errors": m.get("errors"),
                 "farmer_weeks_per_day_planning": round(per_day_planning),
                 "farmer_weeks_per_day_ceiling_24h_full_load": round(m["per_s"] * 86400),
                 "farmers_served_weekly_planning": round(per_day_planning * 7),
                 "formula": "bundles/s x 3600 x active_hours x utilisation; farmers = farmer-weeks/day x 7"}
        g = m.get("gpu")
        if g and g.get("power_mean_w") is not None:
            idle_w = (api.get("gpu_idle") or {}).get("power_mean_w")
            wh_gross = g["power_mean_w"] / m["per_s"] / 3600
            entry["gpu_power_mean_w_under_mix"] = g["power_mean_w"]
            entry["gpu_util_mean_pct_under_mix"] = g.get("util_mean_pct")
            entry["gpu_wh_per_farmer_week_gross"] = round(wh_gross, 6)
            per_1000_season_kwh = wh_gross * 1000 * a.weeks / 1000
            entry["gpu_kwh_per_1000_farmers_per_season_while_serving"] = round(per_1000_season_kwh, 4)
            if idle_w is not None:
                wh_net = max(0.0, g["power_mean_w"] - idle_w) / m["per_s"] / 3600
                entry["gpu_baseline_w_measured_before_load"] = idle_w
                entry["gpu_baseline_note"] = ("measured just before the load with the API idle; on this shared PC it "
                                              "includes other tracks' GPU work, so 'net' is this workload's marginal "
                                              "energy and 'gross' over-counts")
                entry["gpu_wh_per_farmer_week_net_of_baseline"] = round(wh_net, 6)
                if clean_idle_w is not None:
                    entry["gpu_board_idle_w_quiet"] = clean_idle_w
                    entry["gpu_wh_per_farmer_week_upper_bound"] = round(
                        max(0.0, g["power_mean_w"] - clean_idle_w) / m["per_s"] / 3600, 6)
                    entry["upper_bound_note"] = "all board power above the quiet idle floor during the load, other tracks included"
                    idle_w = clean_idle_w                          # the always-on floor uses the quiet idle
                season_h = a.weeks * 7 * 24
                always_on_kwh = idle_w * season_h / 1000          # GPU idles all season, whatever the load
                farmers_cap = per_day_planning * 7
                entry["always_on_gpu"] = {
                    "season_kwh_idle_floor": round(always_on_kwh, 1),
                    "kwh_per_1000_farmers_per_season_at_capacity": round(
                        (always_on_kwh + wh_net * farmers_cap * a.weeks / 1000) / (farmers_cap / 1000), 4),
                    f"kwh_per_1000_farmers_per_season_at_{a.pilot_farmers}_farmers": round(
                        (always_on_kwh + wh_net * a.pilot_farmers * a.weeks / 1000) / (a.pilot_farmers / 1000), 3),
                    "note": "GPU board power only, idle floor for the whole season plus the measured load energy"}
            if a.price_per_kwh is not None:
                entry["gpu_cost_per_1000_farmers_per_season_while_serving"] = round(per_1000_season_kwh * a.price_per_kwh, 4)
        cap[name] = entry
    out["capacity_and_energy"] = cap
    out["not_measured"] = ["CPU, RAM, disk and power-supply energy (no wall-power meter; nvidia-smi reports the GPU board only)",
                           "real farmers' usage (the bundle is an assumption)", "network and phone-side time",
                           "more than one API process (the file-based stores take in-process locks, so one process is the "
                           "tested configuration)"]
    Path(a.out).write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps(out["capacity_and_energy"], indent=1))
    print("wrote", a.out)


if __name__ == "__main__":
    main()
