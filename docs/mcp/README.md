# KrishiLoop MCP servers

Status: **implemented** (`services/mcp/`, tests in `tests/test_mcp.py`). Three read-only servers built with the official MCP Python SDK (`mcp==2.3.0`; its `MCPServer` class is the v2 name of FastMCP). Each one runs over **stdio** and **streamable HTTP**.

Why MCP: other AI advisers and agents can check a KrishiLoop receipt, read our sourced rules, and see the same weather facts our planner sees, without integrating our API. None of the servers plans or advises. Advice comes only from the deterministic planner (`services/engine/planner.py`), with a signed receipt. The planner calls the engine directly; it does not go through MCP.

## Servers and tools

| Server | Code | Tools | Reads | Network |
|---|---|---|---|---|
| `krishiloop-weather` | [`services/mcp/weather/server.py`](../../services/mcp/weather/server.py) | `weather_parameters`, `forecast_snapshot` | rule packs; Open-Meteo forecast (GloFAS discharge optional) through `services/engine/snapshot.py` | Open-Meteo |
| `krishiloop-satellite` | [`services/mcp/satellite/server.py`](../../services/mcp/satellite/server.py) | `list_collections`, `search_scenes`, `scene_metadata` | STAC catalogues: Element 84 Earth Search, Microsoft Planetary Computer | STAC APIs |
| `krishiloop-knowledge` | [`services/mcp/knowledge/server.py`](../../services/mcp/knowledge/server.py) | `verify_credential`, `list_packs`, `get_rule`, `area_photo_trust` | trust store (official and demo sandboxes) through `TrustStore.verify`; rule packs and `corpus/manifest.yaml` through `services/engine/rules.py`; area ledgers | none |

| Tool | What it returns |
|---|---|
| `weather_parameters(pack_id)` | The weather facts a pack's planner derives (`forecast_humid_mild_days`, `forecast_heavy_rain_days`), the reviewer-set parameters behind them, with who set each and the note, and the rule conditions that read them. Offline. |
| `forecast_snapshot(lat, lon, pack_id, include_flood=false)` | A 7-day forecast snapshot: `data_mode` (`live`, or `snapshot` when Open-Meteo did not answer and the last cached forecast is used), `data_as_of`, `stale_for_planner`, the derived facts with their parameters, and the daily values. A null fact means unknown, never "no risk". It returns no plan and no advice. |
| `list_collections()` | The catalogues and collections it can search, how their assets can be read, and the limits. Offline. |
| `search_scenes(bbox, start_date, end_date, collection, provider, max_cloud_cover, limit)` | Sentinel-2 L2A, Sentinel-1 GRD (both catalogues) or Sentinel-1 RTC (Planetary Computer) scenes, newest first, with cloud cover, tile, orbit and polarisations. Cloud cover filters Sentinel-2 only. |
| `scene_metadata(scene_id, collection, provider)` | One scene's full STAC properties and asset links. Nothing is downloaded. |
| `verify_credential(credential_id)` | The public verifier's answer for an advice receipt or an AreaTrustCredential: `authentic`, `recalled` or `invalid`, with the verified credential. A test checks it equals `GET /api/verify/<id>`. |
| `list_packs()` | Packs with crops, rules, review levels, source documents with licence status, and whether the pack's own tests pass. |
| `get_rule(rule_id, version?)` | One rule: condition, action, reviewer parameters, review status, and each source's document, publisher, link, page, verbatim quote, quote hash, licence status and acknowledgement. |
| `area_photo_trust(area, session_id?)` | Whether a photo model has earned trust in an area such as `potato@KE`: the ledger (officer verdicts on suggestions frozen beforehand, Wilson lower bound, gate open or closed, gate events), the status of its AreaTrustCredential, and the photo-trust policy (draft; team-set numbers). |

## Permissions

- **All 9 tools are read-only.** Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`. `openWorldHint` is true only for the 3 tools that call a public web API (`forecast_snapshot`, `search_scenes`, `scene_metadata`). A test enforces this (`test_every_tool_only_reads_and_recall_is_not_a_tool`).
- **Recall is not an MCP tool.** It stays behind the admin token on the API (`POST /api/admin/recall` with `X-Admin-Token`). No tool issues, signs, recalls or revokes a credential.
- **Writes:** the weather server writes only its own forecast cache (`data/mcp_cache/weather/`, git-ignored), for the offline fallback. It never touches the planner's snapshots (tested). The knowledge server creates no file: it opens a store only if its state file already exists (tested).
- **Freshness:** the knowledge server reopens the trust store on every call, so a recall made through the API shows on the next call (tested).
- **Secrets:** `verify_credential` and the credential part of `area_photo_trust` need `KRISHILOOP_ISSUER_SEED` from the environment, because `TrustStore` rebuilds and signs the status list from its local state. The seed is never logged or echoed, even when it is malformed (tested). Without it, `list_packs`, `get_rule` and the ledger part of `area_photo_trust` still work. *Planned:* a public-key-only verifier that reads the published status list over HTTPS, so the server holds no key.
- **Privacy:** the weather server rounds coordinates to 0.01° (about 1 km) before sending them to Open-Meteo. STAC boxes are capped at 2° a side and are sent to the catalogue as given, so send a coarse box. No tool handles photos, names or phone numbers.
- **Authentication:** none. The tools return public open data or what the public API already shows (the verifier, the packs, a demo session's area). HTTP binds to `127.0.0.1` by default, where the SDK turns on DNS-rebinding protection. *Planned:* an authenticating proxy before any server is exposed beyond localhost.

## Transports

| Transport | Command (from the repository root) | Endpoint |
|---|---|---|
| stdio (default) | `python -m services.mcp.weather` · `python -m services.mcp.satellite` · `python -m services.mcp.knowledge` | stdin/stdout |
| streamable HTTP | `python -m services.mcp.weather --transport http` (ports 8101, 8102, 8103; `--host`, `--port` to change) | `http://127.0.0.1:<port>/mcp` |

Each server also runs by script path (`python <repo>/services/mcp/weather/server.py`), from any folder. This is the form host configurations use.

Environment for the knowledge server: `PUBLIC_BASE_URL` and `ISSUER_DID` (as for the API), `KRISHILOOP_ISSUER_SEED`, and `KRISHILOOP_DATA_DIR` (default `<repo>/data`, the folder the API writes).

Host configuration, in the usual `mcpServers` shape (**not yet tested in any host**, see below):

```json
{
  "mcpServers": {
    "krishiloop-weather":   {"command": "<repo>/.venv/Scripts/python.exe", "args": ["<repo>/services/mcp/weather/server.py"]},
    "krishiloop-satellite": {"command": "<repo>/.venv/Scripts/python.exe", "args": ["<repo>/services/mcp/satellite/server.py"]},
    "krishiloop-knowledge": {"command": "<repo>/.venv/Scripts/python.exe", "args": ["<repo>/services/mcp/knowledge/server.py"],
                             "env": {"PUBLIC_BASE_URL": "http://localhost:8000", "KRISHILOOP_ISSUER_SEED": "<from your secret store>"}}
  }
}
```

On Linux and macOS the interpreter is `<repo>/.venv/bin/python`.

## Clients and hosts tested

| Client or host | Transport | Result | Where and when |
|---|---|---|---|
| Official MCP Python SDK client (`mcp.Client` 2.3.0) in `tools/mcp_demo_client.py` | stdio | all 9 tools called against the live APIs (output below) | Windows 11, Python 3.13.2, Oct 28, 2026 |
| same | streamable HTTP | all 9 tools called; same results, with different credential ids and timestamps | Windows 11, Oct 28, 2026 |
| same, launched by absolute script path from another folder | stdio | all three servers list their tools | Windows 11, Oct 28, 2026 |
| `tests/test_mcp.py` (SDK client: in-process, stdio subprocess and streamable-HTTP subprocess) | all three | 23 tests pass with no network | Windows 11 locally. CI (Windows and Ubuntu) runs on the next push; it has not run yet |
| Claude Code, Claude Desktop, Cursor, MCP Inspector | — | **not tested yet** | — |

Who uses the servers today: the demo client. The orchestration graph that would call them (MASTER_PLAN P1 #21) is planned and not built.

## Data sources and terms

- **Open-Meteo** forecast and GloFAS flood API: the free API is for non-commercial use (`services/engine/snapshot.py`; checked in the team's research notes, `research/data_sources_verified.md`, which live outside the repository).
- **Earth Search** and **Planetary Computer** STAC: Copernicus Sentinel data, free and open, with attribution. Both catalogues answered for Sentinel-2 L2A and Sentinel-1 GRD on Oct 28, 2026; Planetary Computer also has Sentinel-1 RTC. Planetary Computer asset reads need a SAS token, which this server does not fetch. Earth Search's Sentinel-1 items carry `storage:requester_pays: true`.
- **Rule sources:** the licence status of each document comes from `corpus/manifest.yaml`. The CIP manual (`DOC-CIP-001`) is quoted under its publisher's acknowledgement statement and is **not** CC BY. The BRRI fact sheets are `cited_permission_requested`: cited only, with short quotes.

## Demo client output

`python tools/mcp_demo_client.py` (stdio). Weather and satellite results are live. The knowledge server reads a **demo fixture** in a temporary folder:
- a throwaway issuer key;
- one plan for the sample Kenyan location (no farmer) from the live forecast;
- an area ledger built from **synthetic** photo features and scripted officer verdicts, used only to exercise `area_photo_trust`. It is not evidence about any model.

The recall in the middle is made through the trust store, as the admin endpoint does; it is not an MCP call.

```text
KrishiLoop MCP demo client: transport=stdio, 2026-10-28

== krishiloop-weather over stdio: 2 tools, all readOnlyHint=True, destructiveHint=False
   weather_parameters, forecast_snapshot (web)
-> weather_parameters {"pack_id": "pack-potato-late-blight"}
   forecast_humid_mild_days: humid_rh_pct_min=90% (team), mild_temp_c_range=10-25C (team); read by R-PLB-008 gte 2, R-PLB-011 lt 2
   forecast_heavy_rain_days: heavy_rain_mm=10mm/day (team); read by R-PLB-009 gte 1, R-PLB-011 eq 0
-> forecast_snapshot {"lat": -0.75, "lon": 36.6, "pack_id": "pack-potato-late-blight", "include_flood": true}
   data_mode=live data_as_of=2026-10-28T05:27:59Z stale_for_planner=False source=open-meteo:forecast window_from=2026-10-28
   facts: forecast_humid_mild_days=1, forecast_heavy_rain_days=2; flood trend=stable
   day 1 of 7: {"date": "2026-10-28", "tmax_c": 17.9, "tmin_c": 10.3, "precip_mm": 12.3, "rh_mean_pct": 90}
   note: Weather facts only, not advice. KrishiLoop advice comes only from its deterministic planner, with a signed receipt. A null fact is unknown, never 'no risk': the planner then abstains and asks an officer.

== krishiloop-satellite over stdio: 3 tools, all readOnlyHint=True, destructiveHint=False
   list_collections, search_scenes (web), scene_metadata (web)
-> list_collections {}
   earth-search: sentinel-2-l2a, sentinel-1-grd
   planetary-computer: sentinel-2-l2a, sentinel-1-grd, sentinel-1-rtc
-> search_scenes {"bbox": [36.55, -0.8, 36.65, -0.7], "start_date": "2026-09-28", "end_date": "2026-10-28", "collection": "sentinel-2-l2a", "provider": "earth-search", "max_cloud_cover": 40, "limit": 3}
   S2B_36MZE_20261024_0_L2A  2026-10-24T08:00:12.758000Z  cloud=17.370951%  tile=MGRS-36MZE
   S2B_37MBV_20261024_0_L2A  2026-10-24T08:00:10.640000Z  cloud=26.819468%  tile=MGRS-37MBV
   S2A_36MZE_20261021_0_L2A  2026-10-21T08:00:21.640000Z  cloud=34.627864%  tile=MGRS-36MZE
   returned=3 matched=14 more_available=True
-> search_scenes {"bbox": [36.55, -0.8, 36.65, -0.7], "start_date": "2026-09-28", "end_date": "2026-10-28", "collection": "sentinel-1-rtc", "provider": "planetary-computer", "limit": 2}
   S1C_IW_GRDH_1SDV_20261026T031918_20261026T031943_010050_0140F0_rtc  2026-10-26T03:19:30.774628Z  IW ['VV', 'VH'] orbit=descending
   S1D_IW_GRDH_1SDV_20261025T154734_20261025T154759_005173_009D0D_rtc  2026-10-25T15:47:46.661547Z  IW ['VV', 'VH'] orbit=ascending
-> scene_metadata {"scene_id": "S2B_36MZE_20261024_0_L2A", "collection": "sentinel-2-l2a"}
   S2B_36MZE_20261024_0_L2A: 43 properties, 38 assets; processing baseline 05.13, vegetation 29.726499%
   asset access: Sentinel-2 L2A assets are public cloud-optimised GeoTIFFs; Sentinel-1 GRD assets are in a requester-pays bucket.

== krishiloop-knowledge over stdio: 4 tools, all readOnlyHint=True, destructiveHint=False
   verify_credential, list_packs, get_rule, area_photo_trust
-> list_packs {}
   pack-bd-rice: crops=['rice'] rules=12 review={'pending': 12} pack_tests_passed=True sources=['DOC-BRRIKB-001', 'DOC-BRRIKB-002', 'DOC-BRRIKB-003', 'DOC-BRRIKB-004']
   pack-potato-late-blight: crops=['potato'] rules=11 review={'pending': 11} pack_tests_passed=True sources=['DOC-CIP-001']
   [fixture] plan for KE-SAMPLE-01 (sample location, no farmer): status=ok, data_mode=live
-> get_rule {"rule_id": "R-PLB-011", "version": 2}
   R-PLB-011 v2 (input_decision, green): No protective spray indicated this week: our forecast check found no period favourable to late blight, or y...
   source: DOC-CIP-001 p.24 [permitted] "If a farmer thinks his crop is not well protected during the period favorable to infection, he should consi..."
   review: pending; parameters: ['humid_mild_days_min']
-> verify_credential {"credential_id": "urn:uuid:3548612e-87a1-43a3-ac32-cd9147482864"}
   status=authentic sandbox=False: issued by KrishiLoop and unaltered (this is not a guarantee of correctness)
   [fixture] the admin recalls R-PLB-011 v2 through the trust store (not an MCP tool)
-> verify_credential {"credential_id": "urn:uuid:3548612e-87a1-43a3-ac32-cd9147482864"}
   status=recalled: rule(s) withdrawn: R-PLB-011 v2
-> verify_credential {"credential_id": "urn:uuid:00000000-0000-4000-8000-000000000000"}
   status=invalid: unknown credential
   [fixture] SYNTHETIC area ledger: fake photo features and scripted officer verdicts, only to exercise the tool
-> area_photo_trust {"area": "rice@BD", "session_id": "b52481c5ebcf14eb"}
   synthetic-leaf@fixture: gate_open=True verdicts=30 sure_right=30/30 lower_bound=0.8865 credential=authentic
   photo trust stands in rice@BD for synthetic-leaf@fixture: sure readings may answer low-risk practices automatically (a share is still audited by the officer)
-> verify_credential {"credential_id": "urn:uuid:ac42e678-9217-4303-9801-2e6fc3b05ab0"}
   status=authentic sandbox=True: issued by KrishiLoop and unaltered: this photo model had earned trust in this area when it was issued (this is not a ...
-> area_photo_trust {"area": "rice@BD"}
   no live photo trust in rice@BD: every photo goes to the officer
```

## Tests (`tests/test_mcp.py`, no network)

- Every tool is read-only, and no tool name recalls, revokes, issues, signs, resolves or judges.
- All three servers run over stdio; the knowledge server runs over streamable HTTP.
- Weather facts equal `snapshot.weather_facts` with the pack's parameters, and coordinates are rounded before sending. The output has no plan or advice keys. The planner's snapshots are untouched. When Open-Meteo is down, the cached forecast is used (`snapshot`) and flagged once stale. Fewer than 4 usable days gives unknown (null), never 0. Unknown packs and coordinates out of range are refused.
- STAC: the exact search body (box, dates, cloud filter, sort, limit) for both catalogues. Sentinel-1 ignores cloud cover. Inputs are validated before any request. Item path, 404 and unreachable catalogues are handled.
- `verify_credential` equals the API's `/api/verify` and sees a recall at once. Malformed and unknown ids are `invalid` and create no file. Without the seed, verification is refused; a malformed seed is never echoed.
- `area_photo_trust` matches the photo service's own ledger stats and credential. Sandboxes are separate from the official store. Revoked trust shows at once, and expired sessions are unknown, as in the API.
- Every rule's sources (document, page, quote) match the YAML, and every quote hash matches its quote.
