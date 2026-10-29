# Sovereign mode, measured (29 Oct 2026)

The RTX 5090 is a GeForce card, and NVIDIA's GeForce licence excludes data-centre deployment. This is a benchmark and proof of concept; production in-country deployments would use data-centre GPUs.

## Setup
- **Same code on both machines** (`g1/local-journey` at 67a0913, plus this track), the same launcher and the same client (`bench.py`, run on the same machine as the API).
- **Same inputs:**
  - the same 3 forecast snapshots;
  - 40 photos from public CC BY 4.0 dataset samples, resized as the app does (1024 px, JPEG q85);
  - the 77 SYNTHETIC seed questions.
- **5090 PC:** Ryzen 7 9700X, 31 GB, RTX 5090 (driver 621.01, CUDA 13.0), Python 3.12, onnxruntime-gpu 1.31.1.
- **Laptop:** Ryzen 5 5600H, 15 GB, Python 3.13, onnxruntime 1.31.1 on CPU.
- **No cloud, enforced:** `serve.py` points `HTTP(S)_PROXY` at a refuse-proxy inside its own process.
  - It refused 16,540 Open-Meteo calls on the 5090 and 6,192 on the laptop.
  - The planner then used its offline path (the saved snapshots).
  - Sovereign deployment still needs an in-country weather feed, which is not built.
- **Signing key:** a fresh random seed in memory on each machine, never written or printed, and gone when the process ends. It runs under the local identity `did:web:127.0.0.1%3A<port>`. Nothing was copied from the secrets folder.
- **Simulated farmers:** each request carries its own `X-Forwarded-For`, which uvicorn trusts only from 127.0.0.1. The limit of 20 requests a minute therefore applies per farmer.

## Latency, one request at a time (40 each, ms, p50 / p95)

| Operation | 5090 | Laptop |
|---|---|---|
| Plan, new store | 8.9 / 30.0 | 24.3 / 28.7 |
| Plan, store warm | 8.7 / 29.5 | 23.8 / 43.9 |
| Verify, official store | 1.5 / 2.2 | 5.6 / 26.3 |
| Verify, demo session | 1.7 / 2.5 | 40.3 / 45.0 |
| Recall | 1.3 / 1.5 | 18.8 / 24.3 |
| Ask (20 answered, 20 abstained) | 16.8 / 25.0 | 48.6 / 71.9 |
| **Photo, server reading** | **23.8 / 36.4** | **931.9 / 1,025.5** |

All 80 plans returned ok, every verify was authentic, and receipts checked after a recall verified as "recalled".

## Throughput (best of 1, 4, 8 and 16 clients; 15 s per level; 0 errors)

| Operation | 5090 | Laptop |
|---|---|---|
| Photos per second through the API | 82.8 | 1.33 |
| Asks per second | 138.9 | 68.7 |
| Plans per second | 131.8 | 64.3 |
| Verifies per second, official store | 752 | 312 |
| **Mixed farmer-weeks per second** (session + plan + 2 asks + photo + verify) | **17.9** (at 8 clients) | **1.33** |

At 16 clients the 5090 fell to 12.3 farmer-weeks per second: one API process contends for Python's lock.

## Photo model alone, batched on the GPU
- **Parity, GPU vs CPU,** on 20 photos:
  - cosine similarity min 0.9999919, mean 0.9999981 (the bar is 0.999);
  - the top label matched on 20 of 20;
  - max absolute difference 0.020, from TF32.
- **Photos per second at batch 1 / 8 / 16 / 32 / 64:** 99.9 / **336** / 311 / 304 / 284.
- **Full pipeline** (JPEG decode on 8 CPU threads plus GPU): 211 photos per second.
- **Laptop CPU:** about 1.0–1.1 photos per second.
- **Energy:** about 1.27–1.57 J per photo net of the 34 W idle at batch 8–64; 2.1 J at batch 1.
- **VRAM:** about 2.6 GB up to batch 32 and about 5.5 GB at batch 64. Use batch ≤ 32.

## Capacity and energy
**Assumptions** (all are parameters in `summarise.py`, none measured from farmers):
- a farmer-week is 1 session, 1 plan, 2 asks, 1 photo and 1 verify;
- 12 active hours a day at 50% load;
- a 17-week season;
- no electricity price assumed (multiply kWh by your tariff).

**Results:**
- **5090:** about **387,000 farmer-weeks a day**, which is weekly service for about 2.7 million farmers. The ceiling at 24 h full load is 1.55 million a day.
- **Laptop:** 28,700 farmer-weeks a day.
- **The limit is the single API process's CPU work, not the GPU.** The model alone does more than 300 photos per second, but the API passes about 83.
- **GPU energy per farmer-week:** 0.00057 Wh marginal (net of the baseline). The upper bound is 0.0029 Wh, counting all board power above the quiet idle, other tracks included.
- **Per 1,000 farmers per season, while serving:** 0.010–0.050 kWh.
- **Always-on GPU idle floor:** 34 W, which is 96.5 kWh per season whatever the load. Per 1,000 farmers that is 0.045 kWh at full capacity, but 9.7 kWh for a 10,000-farmer pilot.
- CPU and system power were not measured (no wall meter), so whole-system energy is higher.

## Caveats
- **Shared GPU:** other tracks' jobs ran on it during the API run (the baseline before the load was 188 W at 37% use), so energy is noisy. Quote the marginal ("net") figure. The second model run started quiet (34 W).
- **One uvicorn process:** the file stores use in-process locks. Scaling past one process needs the database store.
- **Demo endpoints only:** Ask and photo exist only on the demo-session endpoints.
- **Synthetic questions.**

## Reproduce
- The commands are in the `serve.py` and `bench.py` docstrings.
- On the 5090 the runner jobs are `run_model.ps1`, `run_api.ps1` and `run_bench.ps1` in `F:\krishiloop-5090\scripts\sovereign\`.
- Raw results: `sovereign_benchmark.json` and `raw/`.

## Licences
| Component | Licence and note |
|---|---|
| BioCLIP 2 | MIT |
| multilingual-e5-small | MIT |
| onnxruntime-gpu | MIT |
| CUDA 13 and cuDNN 9 | NVIDIA licence; from the PC owner's torch install, not redistributed |
| Test photos | CC BY 4.0 Mendeley samples, used locally and not committed |

RiceLeafBD (provenance conflict) and MangoLeafBD (CC BY-NC) were excluded.

## Earned-trust intervals
These are in `EARNED_TRUST_CI.md`: BioCLIP 2, protocol 2 unchanged, 200 stream orders per area.
