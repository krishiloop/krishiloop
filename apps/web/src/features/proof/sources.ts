/**
 * Every number on /proof, with the file it comes from. Nothing here is computed or rounded beyond what the file says;
 * each value was read from the repository on 29 Oct 2026:
 *   - ml/vision/MODEL_CARD.md and ml/vision/artifacts/{lodo,probe}.json: vision v1 / v2 / k-shot
 *   - ml/vision/MODEL_CARD.md "Earned trust per area" and artifacts/earned_trust_sim_v2_strict.json: protocol 2 (strict)
 *   - ml/ask/eval_report.json: the Ask router (SYNTHETIC test split, 45 questions)
 *   - docs/mcp/README.md: the MCP servers and tools
 *   - .github/workflows/ci.yml and `pytest --collect-only`: 176 backend tests on ubuntu-latest + windows-latest
 * The files are on the `g1/local-journey` branch until it is merged: REPO_REF is the one place to change that.
 */
export const REPO = 'https://github.com/krishiloop/krishiloop';
export const REPO_REF = 'g1/local-journey';
export const ACTIONS_URL = `${REPO}/actions`;
export const blob = (path: string) => `${REPO}/blob/${REPO_REF}/${path}`;
export const tree = (path: string) => `${REPO}/tree/${REPO_REF}/${path}`;

export interface Source {
  path: string;
  href: string;
}
const file = (path: string): Source => ({ path, href: blob(path) });
const dir = (path: string): Source => ({ path: `${path}/`, href: tree(path) });

/* ------------------------------------------------------------------ evaluations */
export type EvalId = 'v1' | 'zeroShot' | 'kshot' | 'threshold' | 'trust' | 'ask';
export type EvalTone = 'bad' | 'synthetic' | 'replay' | 'measured';

export interface EvalTile {
  id: EvalId;
  /** the headline value, as the file states it */
  value: string;
  tone: EvalTone;
  /** small chart: bars (label, value 0..1) or a line of (x, y) */
  bars?: { label: string; value: number; strong?: boolean }[];
  line?: { x: number; y: number }[];
  table?: { area: string; open: string; auto: string; right: string }[];
  /** from–to ranges on 0..1, labelled by an i18n key */
  ranges?: { key: 'passed' | 'right'; from: number; to: number; bad?: boolean }[];
  sources: Source[];
  /** an internal link for more */
  more?: string;
}

export const EVALS: EvalTile[] = [
  {
    id: 'v1',
    value: '0.267',
    tone: 'bad',
    // macro-F1 per held-out dataset, ERM (MODEL_CARD.md v1 table; lodo.json folds)
    bars: [
      { label: 'BD-A', value: 0.119 },
      { label: 'BD-C', value: 0.35 },
      { label: 'BD-D', value: 0.291 },
      { label: 'BD-E', value: 0.307 },
    ],
    sources: [file('ml/vision/MODEL_CARD.md'), file('ml/vision/artifacts/lodo.json')],
  },
  {
    id: 'zeroShot',
    value: '0.414',
    tone: 'measured',
    // mean macro-F1 over the same 4 held-out sets (MODEL_CARD.md v2 table; probe.json v1_reference, e1_lodo, e2_zero_shot)
    bars: [
      { label: 'v1', value: 0.267 },
      { label: 'probe', value: 0.356 },
      { label: 'zero-shot', value: 0.414, strong: true },
    ],
    sources: [file('ml/vision/MODEL_CARD.md'), file('ml/vision/artifacts/probe.json')],
  },
  {
    id: 'kshot',
    value: '0.701',
    tone: 'measured',
    // DINOv2-B grey probe + k confirmed photos per disease (probe.json e3_few_shot; k=0 is the probe without shots)
    line: [
      { x: 0, y: 0.356 },
      { x: 1, y: 0.438 },
      { x: 5, y: 0.557 },
      { x: 10, y: 0.613 },
      { x: 25, y: 0.701 },
    ],
    sources: [file('ml/vision/MODEL_CARD.md'), file('ml/vision/artifacts/probe.json')],
  },
  {
    id: 'threshold',
    value: '15–63%',
    tone: 'bad',
    // MODEL_CARD.md v2 finding 4: without target photos "top-1 >= 0.85" passes 32-63% of photos, 15-63% of those right
    ranges: [
      { key: 'passed', from: 0.32, to: 0.63 },
      { key: 'right', from: 0.15, to: 0.63, bad: true },
    ],
    sources: [file('ml/vision/MODEL_CARD.md'), file('ml/vision/artifacts/probe.json')],
  },
  {
    id: 'trust',
    value: '89–109',
    tone: 'replay',
    // protocol 2, strict near-copy check, BioCLIP 2, 3 orders (MODEL_CARD.md earned-trust table)
    table: [
      { area: 'Savar (BD-D)', open: '89–109', auto: '86%', right: '99.5%' },
      { area: 'RiceyLeafDisease (BD-C)', open: '126–179', auto: '32–37%', right: '96.8–99.4%' },
      { area: 'Dhan-Shomadhan (BD-A)', open: '221–234', auto: '5%', right: '83–100%' },
      { area: 'Gazipur (BD-E)', open: '328–510', auto: '30–35%', right: '94.4–95.9%' },
    ],
    sources: [file('ml/vision/MODEL_CARD.md'), file('ml/vision/artifacts/earned_trust_sim_v2_strict.json')],
    more: '/trust',
  },
  {
    id: 'ask',
    value: '0.89',
    tone: 'synthetic',
    // test split accuracy@1 per retrieval mode (eval_report.json modes.*.test)
    bars: [
      { label: 'BM25', value: 0.861 },
      { label: 'dense', value: 0.778 },
      { label: 'hybrid', value: 0.889, strong: true },
      { label: '+rerank', value: 0.806 },
    ],
    sources: [file('ml/ask/eval_report.json'), file('ml/ask/questions.seed.jsonl')],
  },
];

/* ------------------------------------------------------------------ standards */
export type StandardState = 'implemented' | 'partial' | 'planned';
export interface Standard {
  id: string;
  name: string;
  state: StandardState;
  source?: Source;
}
export const STANDARDS: Standard[] = [
  { id: 'vc', name: 'W3C Verifiable Credentials 2.0', state: 'implemented', source: file('services/trust/vc.py') },
  { id: 'di', name: 'Data Integrity eddsa-jcs-2022', state: 'implemented', source: file('tests/test_vc.py') },
  { id: 'bsl', name: 'Bitstring Status List', state: 'implemented', source: file('services/trust/vc.py') },
  { id: 'didweb', name: 'did:web', state: 'implemented', source: file('services/trust/store.py') },
  { id: 'jsonschema', name: 'JSON Schema 2020-12', state: 'implemented', source: dir('contracts/schemas') },
  { id: 'mcp', name: 'Model Context Protocol', state: 'implemented', source: file('docs/mcp/README.md') },
  { id: 'openapi', name: 'OpenAPI', state: 'partial', source: file('README.md') },
  { id: 'stac', name: 'OGC STAC', state: 'partial', source: file('services/mcp/satellite/server.py') },
  { id: 'wcag', name: 'WCAG 2.2 AA', state: 'partial', source: dir('apps/web/tests/e2e') },
  { id: 'agrovoc', name: 'FAO AGROVOC', state: 'planned' },
  { id: 'nist', name: 'NIST AI RMF + GenAI Profile', state: 'planned' },
  { id: 'iso42001', name: 'ISO/IEC 42001', state: 'planned' },
  { id: 'a2a', name: 'A2A', state: 'planned' },
];

/* ------------------------------------------------------------------ MCP (docs/mcp/README.md) */
export const MCP_SERVERS: { name: string; tools: string[]; web?: string[]; source: Source }[] = [
  { name: 'krishiloop-weather', tools: ['weather_parameters', 'forecast_snapshot'], web: ['forecast_snapshot'], source: file('services/mcp/weather/server.py') },
  { name: 'krishiloop-satellite', tools: ['list_collections', 'search_scenes', 'scene_metadata'], web: ['search_scenes', 'scene_metadata'], source: file('services/mcp/satellite/server.py') },
  { name: 'krishiloop-receipts', tools: ['verify_credential', 'get_credential', 'status_list_info'], source: file('services/mcp/receipts/server.py') },
  { name: 'krishiloop-rules', tools: ['list_packs', 'get_rule', 'search_rules'], source: file('services/mcp/rules/server.py') },
  { name: 'krishiloop-photo-trust', tools: ['list_areas', 'area_photo_trust', 'trust_replay'], source: file('services/mcp/photo_trust/server.py') },
];
export const MCP_DOC = file('docs/mcp/README.md');
export const MCP_TESTS = file('tests/test_mcp.py');

/* ------------------------------------------------------------------ tests and CI */
export const TESTS = {
  backend: 176,
  mcp: 28,
  /** apps/web/src/lib/vc: jcs.test.ts + verify.test.ts */
  browserCrypto: 58,
  receipts: 20,
  ci: file('.github/workflows/ci.yml'),
  vc: file('tests/test_vc.py'),
  quotes: file('tools/check_quotes.py'),
  contracts: file('tools/validate_contracts.py'),
  web: file('apps/web/src/lib/vc/verify.test.ts'),
};

/* ------------------------------------------------------------------ data and licences */
export type RegisterId = 'meteo' | 'sentinel' | 'brri' | 'cip' | 'leaf' | 'textModels';
export const REGISTER: { id: RegisterId; name: string; licence: string; source: Source }[] = [
  { id: 'meteo', name: 'Open-Meteo forecast + GloFAS', licence: 'free API, non-commercial', source: file('services/engine/snapshot.py') },
  { id: 'sentinel', name: 'Sentinel-2 L2A / Sentinel-1 (STAC)', licence: 'Copernicus, free and open', source: file('docs/mcp/README.md') },
  { id: 'brri', name: 'BRRI Rice Knowledge Bank', licence: 'cited_permission_requested', source: file('corpus/manifest.yaml') },
  { id: 'cip', name: 'CIP potato late-blight manual', licence: 'permitted (not CC BY)', source: file('corpus/manifest.yaml') },
  { id: 'leaf', name: 'Dhan-Shomadhan, RiceyLeafDisease, RiceLeafDisease-BD5, RiceLeafDiseaseBD', licence: 'CC BY 4.0', source: file('ml/vision/MODEL_CARD.md') },
  { id: 'textModels', name: 'multilingual-e5-small · gte-multilingual-reranker-base', licence: 'MIT · Apache-2.0', source: file('ml/ask/eval_report.json') },
];

export const READ_THE_CODE: Source[] = [file('README.md'), dir('specs'), dir('contracts'), file('ml/vision/MODEL_CARD.md'), dir('docs/prompt-library')];
export const PROMPT_LIBRARY = { index: file('docs/prompt-library/README.md'), brief: file('docs/prompt-library/frontend-redesign-brief.md') };
