# KrishiLoop MCP servers

Status: **implemented** (`services/mcp/`, tests in `tests/test_mcp.py`). Five read-only servers with 14 tools, built with the official MCP Python SDK (`mcp==2.3.0`; its `MCPServer` class is the v2 name of FastMCP). Each server runs over **stdio** and **streamable HTTP**.

Why MCP: other AI advisers and agents can use KrishiLoop without integrating our API. They can:
- check a KrishiLoop receipt;
- read our sourced rules;
- see the weather facts our planner sees;
- see where a photo model has earned trust.

None of the servers plans or advises. Advice comes only from the deterministic planner (`services/engine/planner.py`), with a signed receipt. The planner calls the engine directly; it does not go through MCP.

## Servers and tools

| Server | Code | Tools | Reads | Network | Secret |
|---|---|---|---|---|---|
| `krishiloop-weather` | [`weather/server.py`](../../services/mcp/weather/server.py) | `weather_parameters`, `forecast_snapshot` | rule packs; Open-Meteo forecast (GloFAS discharge optional) through `services/engine/snapshot.py` | Open-Meteo | none |
| `krishiloop-satellite` | [`satellite/server.py`](../../services/mcp/satellite/server.py) | `list_collections`, `search_scenes`, `scene_metadata` | STAC catalogues: Element 84 Earth Search, Microsoft Planetary Computer | STAC APIs | none |
| `krishiloop-receipts` | [`receipts/server.py`](../../services/mcp/receipts/server.py) | `verify_credential`, `get_credential`, `status_list_info` | trust store (official and live demo sandboxes) through `TrustStore.verify` | none | issuer seed (to verify) |
| `krishiloop-rules` | [`rules/server.py`](../../services/mcp/rules/server.py) | `list_packs`, `get_rule`, `search_rules` | rule packs and `corpus/manifest.yaml` through `services/engine/rules.py`; recalls in the official store | none | none |
| `krishiloop-photo-trust` | [`photo_trust/server.py`](../../services/mcp/photo_trust/server.py) | `list_areas`, `area_photo_trust`, `trust_replay` | area ledgers through `services/vision/ledger.py` (imported, unchanged); the store's trust index; `ml/vision/artifacts/area_trust_replay.json` | none | none |

`services/mcp/stores.py` finds the trust data the way the API does: the official store first, then live demo sandboxes, with the same time to live. A test keeps the two equal.

| Tool | What it returns |
|---|---|
| `weather_parameters(pack_id)` | The weather facts a pack's planner derives (`forecast_humid_mild_days`, `forecast_heavy_rain_days`), the reviewer-set parameters behind them (with who set each and the note), and the rule conditions that read them. Offline. |
| `forecast_snapshot(lat, lon, pack_id, include_flood=false)` | A 7-day forecast snapshot, with the derived facts and their parameters and the daily values. `data_mode` is `live`, or `snapshot` when Open-Meteo did not answer and the last cached forecast is used; also `data_as_of` and `stale_for_planner`. A null fact means unknown, never "no risk". It returns no plan and no advice. |
| `list_collections()` | The catalogues and collections it can search, how their assets can be read, and the limits. Offline. |
| `search_scenes(bbox, start_date, end_date, collection, provider, max_cloud_cover, limit)` | Scenes newest first, with cloud cover, tile, orbit and polarisations: Sentinel-2 L2A and Sentinel-1 GRD (both catalogues), or Sentinel-1 RTC (Planetary Computer). Cloud cover filters Sentinel-2 only. |
| `scene_metadata(scene_id, collection, provider)` | One scene's full STAC properties and asset links. Nothing is downloaded. |
| `verify_credential(credential_id)` | The public verifier's answer for an advice receipt or an AreaTrustCredential (`authentic`, `recalled` or `invalid`), with the verified credential. A test checks it equals `GET /api/verify/<id>`. |
| `get_credential(credential_id)` | The credential exactly as stored, unverified (as `GET /api/credentials/<id>`, which a test checks). |
| `status_list_info(session_id?, include_credential=false)` | A Bitstring Status List: URL, size, entries used and revoked, last change, and the rule versions recalled in it with when and why. Optionally the signed status-list credential (as `GET /status/<id>`). |
| `list_packs()` | Packs with crops, rules, review levels, source documents with licence status, whether each rule is recalled in the official store, and whether the pack's own tests pass. |
| `get_rule(rule_id, version?)` | One rule: condition, action, reviewer parameters, review status, recall record, and every source. Each source gives the document, publisher, link, page, verbatim quote, quote hash, licence status and acknowledgement. |
| `search_rules(query, pack_id?, limit=10)` | Rules containing every keyword (English or Bangla, case-insensitive). It searches the title, decision, condition, parameters, basis note, source quote and source document. Plain word matching, no model; title matches rank first. |
| `list_areas(session_id?)` | The areas (`crop@area`) with a photo ledger or a live trust credential: verdicts so far, gate state, whether trust stands. |
| `area_photo_trust(area, session_id?)` | One area's ledger and whether its trust stands, plus the photo-trust policy (draft; team-set numbers). The ledger holds officer verdicts on suggestions frozen beforehand, the Wilson lower bound, the gate state and gate events. "Stands" uses the planner's own check (the store's live trust index). |
| `trust_replay(area?, backbone?)` | The replay on public CC BY rice datasets, whose labels stand in for officers' verdicts (the file says so in its own note). Per area: verdicts until the gate opened, automatic answers and their precision, gate closings, and the suggestion's value while the gate is closed. With `area`, it also returns the curve. |

## Permissions

- **All 14 tools are read-only.** Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`. `openWorldHint` is true only for the 3 tools that call a public web API (`forecast_snapshot`, `search_scenes`, `scene_metadata`). A test enforces this (`test_every_tool_only_reads_and_recall_is_not_a_tool`).
- **Recall is not an MCP tool.** It stays behind the admin token on the API (`POST /api/admin/recall` with `X-Admin-Token`). No tool issues, signs, recalls or revokes a credential, and no tool records an officer's verdict.
- **Writes:** the weather server writes only its own forecast cache (`data/mcp_cache/weather/`, git-ignored), for the offline fallback. It never touches the planner's snapshots (tested). The receipts, rules and photo-trust servers create no file: they read only stores and ledgers that already exist (tested).
- **Freshness:** stores and ledgers are reopened on every call, so a recall or a withdrawn area trust shows on the next call (tested).
- **Secrets (least privilege):** only the receipts server needs `KRISHILOOP_ISSUER_SEED`, from the environment. It needs it for `verify_credential` and for the signed list in `status_list_info`, because `TrustStore` rebuilds and signs the status list from its local state. The seed is never logged or echoed, even when it is malformed (tested). `get_credential` and the counters in `status_list_info` work without it, and the rules and photo-trust servers never need it (tested). *Planned:* a public-key-only verifier that reads the published status list over HTTPS, so no server holds a key.
- **Privacy:** the weather server rounds coordinates to 0.01° (about 1 km) before sending them to Open-Meteo. STAC boxes are capped at 2° a side and are sent to the catalogue as given, so send a coarse box. No tool returns photos, names or phone numbers; the photo-trust tools read ledger statistics, never photos or feature vectors.
- **Authentication:** none. The tools return public open data, or what the public API already shows (the verifier, credentials, status lists, packs, a demo session's area). HTTP binds to `127.0.0.1` by default, where the SDK turns on DNS-rebinding protection. *Planned:* an authenticating proxy before any server is exposed beyond localhost.

## Transports

| Transport | Command (from the repository root) | Endpoint |
|---|---|---|
| stdio (default) | `python -m services.mcp.weather` (likewise `.satellite`, `.receipts`, `.rules`, `.photo_trust`) | stdin/stdout |
| streamable HTTP | `python -m services.mcp.weather --transport http` (ports 8101 to 8105 in that order; `--host` and `--port` change them) | `http://127.0.0.1:<port>/mcp` |

Each server also runs by script path (`python <repo>/services/mcp/<name>/server.py`), from any folder. This is the form host configurations use.

Environment for the receipts, rules and photo-trust servers: `PUBLIC_BASE_URL` and `ISSUER_DID` (as for the API), and `KRISHILOOP_DATA_DIR` (default `<repo>/data`, the folder the API writes). `KRISHILOOP_ISSUER_SEED` goes to the receipts server only.

Host configuration, in the usual `mcpServers` shape (**not yet tested in any host**, see below):

```json
{
  "mcpServers": {
    "krishiloop-weather":     {"command": "<repo>/.venv/Scripts/python.exe", "args": ["<repo>/services/mcp/weather/server.py"]},
    "krishiloop-satellite":   {"command": "<repo>/.venv/Scripts/python.exe", "args": ["<repo>/services/mcp/satellite/server.py"]},
    "krishiloop-receipts":    {"command": "<repo>/.venv/Scripts/python.exe", "args": ["<repo>/services/mcp/receipts/server.py"],
                               "env": {"PUBLIC_BASE_URL": "http://localhost:8000", "KRISHILOOP_ISSUER_SEED": "<from your secret store>"}},
    "krishiloop-rules":       {"command": "<repo>/.venv/Scripts/python.exe", "args": ["<repo>/services/mcp/rules/server.py"]},
    "krishiloop-photo-trust": {"command": "<repo>/.venv/Scripts/python.exe", "args": ["<repo>/services/mcp/photo_trust/server.py"]}
  }
}
```

On Linux and macOS the interpreter is `<repo>/.venv/bin/python`.

## Clients and hosts tested

Only what we actually ran:

| Client or host | Transport | Result | Where and when |
|---|---|---|---|
| Official MCP Python SDK client (`mcp.Client` 2.3.0) in `tools/mcp_demo_client.py` | stdio | all 14 tools on the 5 servers called; weather and satellite against the live APIs (output below) | Windows 11, Python 3.13.2, Oct 28, 2026 |
| same | streamable HTTP | all 14 tools called; same results, with different credential ids and timestamps | Windows 11, Oct 28, 2026 |
| same, launched by absolute script path from another folder | stdio | all 5 servers list their tools | Windows 11, Oct 28, 2026 |
| `tests/test_mcp.py` (SDK client: in-process, stdio subprocess and streamable-HTTP subprocess) | all three | 28 tests pass with no network | Windows 11 locally. CI (Windows and Ubuntu) runs when the branch is pushed; it has not run yet |
| Claude Code, Claude Desktop, Cursor, MCP Inspector | — | **not tested yet** | — |

Who uses the servers today: the demo client. The orchestration graph that would call them (MASTER_PLAN P1 #21) is planned and not built.

## Data sources and terms

- **Open-Meteo** forecast and GloFAS flood API: the free API is for non-commercial use (`services/engine/snapshot.py`; checked in the team's research notes, `research/data_sources_verified.md`, which live outside the repository).
- **Earth Search** and **Planetary Computer** STAC: Copernicus Sentinel data, free and open, with attribution. Both catalogues answered for Sentinel-2 L2A and Sentinel-1 GRD on Oct 28, 2026; Planetary Computer also has Sentinel-1 RTC. Planetary Computer asset reads need a SAS token, which this server does not fetch. Earth Search's Sentinel-1 items carry `storage:requester_pays: true`.
- **Rule sources:** the licence status of each document comes from `corpus/manifest.yaml`. The CIP manual (`DOC-CIP-001`) is quoted under its publisher's acknowledgement statement and is **not** CC BY. The BRRI fact sheets are `cited_permission_requested`: cited only, with short quotes.
- **Replay:** `ml/vision/artifacts/area_trust_replay.json`, produced by `ml/vision/analysis/earned_trust_sim_v2.py --curves` (protocol 2, first random order only). It uses four CC BY 4.0 rice-leaf datasets, one per area (`ml/vision/MODEL_CARD.md`). The datasets' labels stand in for officers: not real officers, not real farms.

## Demo client output

`python tools/mcp_demo_client.py` (stdio). Weather and satellite results are live, and the replay is the committed file. The receipts, rules and photo-trust servers read a **demo fixture** in a temporary folder:
- a throwaway issuer key, given to the receipts server only;
- one plan for the sample Kenyan location (no farmer) from the live forecast;
- an area ledger built from **synthetic** photo features and scripted officer verdicts, used only to exercise the photo-trust tools. It is not evidence about any model.

The recall in the middle is made through the trust store, as the admin endpoint does; it is not an MCP call.

```text
KrishiLoop MCP demo client: transport=stdio, 2026-10-28

== krishiloop-weather over stdio: 2 tools, all readOnlyHint=True, destructiveHint=False
   weather_parameters, forecast_snapshot (web)
-> weather_parameters {"pack_id": "pack-potato-late-blight"}
   forecast_humid_mild_days: humid_rh_pct_min=90% (team), mild_temp_c_range=10-25C (team); read by R-PLB-008 gte 2, R-PLB-011 lt 2
   forecast_heavy_rain_days: heavy_rain_mm=10mm/day (team); read by R-PLB-009 gte 1, R-PLB-011 eq 0
-> forecast_snapshot {"lat": -0.75, "lon": 36.6, "pack_id": "pack-potato-late-blight", "include_flood": true}
   data_mode=live data_as_of=2026-10-28T05:40:44Z stale_for_planner=False source=open-meteo:forecast window_from=2026-10-28
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

== krishiloop-receipts over stdio: 3 tools, all readOnlyHint=True, destructiveHint=False
   verify_credential, get_credential, status_list_info
   [fixture] plan for KE-SAMPLE-01 (sample location, no farmer): status=ok, data_mode=live
-> verify_credential {"credential_id": "urn:uuid:f4b9aa69-d132-4b4e-8afb-0f9558fd69cd"}
   status=authentic sandbox=False: issued by KrishiLoop and unaltered (this is not a guarantee of correctness)
-> get_credential {"credential_id": "urn:uuid:f4b9aa69-d132-4b4e-8afb-0f9558fd69cd"}
   ['AdviceReceiptCredential'] issued by did:web:localhost%3A8000; advice: No protective spray indicated this week: our forecast check found no period favourable ...
   rule refs: [('R-PLB-011', 2)]; sources: [('DOC-CIP-001', 24), ('DOC-CIP-001', 19), ('DOC-CIP-001', 24)]
-> status_list_info {}
   http://localhost:8000/status/1: entries used=2 revoked=0 recalled=[]
   [fixture] the admin recalls R-PLB-011 v2 through the trust store (not an MCP tool)
-> verify_credential {"credential_id": "urn:uuid:f4b9aa69-d132-4b4e-8afb-0f9558fd69cd"}
   status=recalled: rule(s) withdrawn: R-PLB-011 v2
-> status_list_info {"include_credential": true}
   entries revoked=1; recalled: R-PLB-011@2 at 2026-10-28T05:40:54Z (demo: admin recall, outside MCP); signed list: ['VerifiableCredential', 'BitstringStatusListCredential']
-> verify_credential {"credential_id": "urn:uuid:00000000-0000-4000-8000-000000000000"}
   status=invalid: unknown credential
   [fixture] the area photo-trust credential below comes from a SYNTHETIC ledger (see photo-trust)
-> verify_credential {"credential_id": "urn:uuid:87fe04dd-7b1d-4195-8a0a-9a3167924ef4"}
   status=authentic sandbox=True: issued by KrishiLoop and unaltered: this photo model had earned trust in this area when it was issued (this is not a ...

== krishiloop-rules over stdio: 3 tools, all readOnlyHint=True, destructiveHint=False
   list_packs, get_rule, search_rules
-> list_packs {}
   pack-bd-rice: crops=['rice'] rules=12 review={'pending': 12} pack_tests_passed=True sources=['DOC-BRRIKB-001', 'DOC-BRRIKB-002', 'DOC-BRRIKB-003', 'DOC-BRRIKB-004']
   pack-potato-late-blight: crops=['potato'] rules=11 review={'pending': 11} pack_tests_passed=True sources=['DOC-CIP-001']
-> search_rules {"query": "spray forecast", "limit": 5}
   2 rules match every word:
   R-PLB-011 v2 pack-potato-late-blight input_decision/dont_spray matched_in=['action', 'basis_note', 'condition', 'title'] sources=['DOC-CIP-001 p.24', 'DOC-CIP-001 p.19', 'DOC-CIP-001 p.24']
   R-BDR-003 v1 pack-bd-rice input_decision/dont_spray matched_in=['action', 'basis_note', 'condition', 'title'] sources=['DOC-BRRIKB-001 p.1', 'DOC-BRRIKB-003 p.2']
-> get_rule {"rule_id": "R-PLB-011", "version": 2}
   R-PLB-011 v2 (input_decision, green): No protective spray indicated this week: our forecast check found no period favourable to late blight, or y...
   source: DOC-CIP-001 p.24 [permitted] "If a farmer thinks his crop is not well protected during the period favorable to infection, he should consi..."
   review: pending; parameters: ['humid_mild_days_min']; recall in official store: {"at": "2026-10-28T05:40:54Z", "reason": "demo: admin recall, outside MCP", "actor": "admin"}

== krishiloop-photo-trust over stdio: 3 tools, all readOnlyHint=True, destructiveHint=False
   list_areas, area_photo_trust, trust_replay
   [fixture] SYNTHETIC area ledger: fake photo features and scripted officer verdicts, only to exercise the tools
-> list_areas {"session_id": "c494b99168fb05af"}
   rice@BD synthetic-leaf@fixture: verdicts=30 gate_open=True trust_stands=True
-> area_photo_trust {"area": "rice@BD", "session_id": "c494b99168fb05af"}
   synthetic-leaf@fixture: gate_open=True verdicts=30 sure_right=30/30 lower_bound=0.8865 trust_stands=True
   photo trust stands in rice@BD for synthetic-leaf@fixture: sure readings may answer low-risk practices automatically (a share is still audited by the officer)
   policy v1 (draft): open at lower bound >= 0.85, close below 0.8
-> area_photo_trust {"area": "rice@BD"}
   no photo trust stands in rice@BD: every photo goes to the officer
-> trust_replay {}
   note (from the replay file): Replay of public CC BY rice datasets: the dataset's labels stand in for an officer's verdicts. Not real officers, not real farms.
   BD-A: photos=258 verdicts_until_open=229 auto_answers=13 auto_precision=0.9231 closings=0
   BD-C: photos=510 verdicts_until_open=126 auto_answers=187 auto_precision=0.9679 closings=0
   BD-D: photos=1633 verdicts_until_open=93 auto_answers=1403 auto_precision=0.9957 closings=0
   BD-E: photos=2000 verdicts_until_open=328 auto_answers=702 auto_precision=0.9444 closings=0
-> trust_replay {"area": "BD-A"}
   BD-A curve: 246 points, fields=['photos_seen', 'officer_verdicts', 'lower_bound_before_this_verdict', 'gate_open', 'auto_answers', 'auto_right']; last=[258, 246, 0.895, 1, 13, 12]
```

## Tests (`tests/test_mcp.py`, no network)

- **All servers:** every tool is read-only, and no tool name recalls, revokes, issues, signs, resolves or judges. All five servers run over stdio, and one runs over streamable HTTP.
- **Weather:**
  - its facts equal `snapshot.weather_facts` with the pack's parameters, and coordinates are rounded before sending;
  - the output has no plan or advice keys, and the planner's snapshots are untouched;
  - when Open-Meteo is down, the cached forecast is used (`snapshot`) and flagged once stale;
  - fewer than 4 usable days gives unknown (null), never 0;
  - unknown packs and coordinates out of range are refused.
- **Satellite:**
  - sends the exact search body (box, dates, cloud filter, sort, limit) to both catalogues;
  - Sentinel-1 ignores cloud cover;
  - inputs are validated before any request;
  - handles the item path, 404 and unreachable catalogues.
- **Receipts:**
  - `verify_credential`, `get_credential` and `status_list_info` equal the API's `/api/verify`, `/api/credentials` and `/status/1`;
  - a recall shows at once;
  - malformed and unknown ids are refused and create no file;
  - only verification needs the seed, and a malformed seed is never echoed.
- **Rules:**
  - every rule's sources (document, page, quote) match the YAML, and every quote hash matches its quote;
  - recall flags follow the official store;
  - search needs every keyword, ranks title matches first, respects the pack filter and limit, and finds Bangla words in quotes.
- **Photo trust:**
  - ledger statistics and the trust credential equal the photo service's own;
  - sandboxes are separate from the official store;
  - withdrawn trust shows at once, and expired sessions are unknown, as in the API;
  - the replay is served as committed, with its own note.
