/**
 * Every number on /proof, with the file it comes from. Nothing here is computed or rounded beyond what the file says;
 * each value was read from the repository on 29 Oct 2026:
 *   - ml/vision/MODEL_CARD.md and ml/vision/artifacts/{lodo,probe}.json: vision v1 / v2 / k-shot
 *   - ml/vision/artifacts/earned_trust_ci.json: protocol 2, 200 random orders per area (95% ranges)
 *   - ml/evals/safety/REPORT.md, ml/voice/REPORT.md, ml/sovereign/REPORT.md: the three results measured on 29 Oct
 *   - ml/ask/eval_report.json: the Ask router (SYNTHETIC test split, 45 questions)
 *   - docs/mcp/README.md: the MCP servers and tools
 *   - .github/workflows/ci.yml and `pytest --collect-only`: 176 backend tests on ubuntu-latest + windows-latest
 * The files are on the `g1/local-journey` branch until it is merged: REPO_REF is the one place to change that.
 */
import { REPO, blob, tree } from './repo';
export { REPO, REPO_REF, blob, tree } from './repo';
export const ACTIONS_URL = `${REPO}/actions`;

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
    value: '70–126',
    tone: 'replay',
    // protocol 2, BioCLIP 2, 200 random orders per area: 2.5th–97.5th percentile (earned_trust_ci.json, bioclip2:anchored)
    table: [
      { area: 'Savar (BD-D)', open: '70–126', auto: '85–88%', right: '99.0–99.7%' },
      { area: 'RiceyLeafDisease (BD-C)', open: '146–264', auto: '27–40%', right: '95.3–100%' },
      { area: 'Dhan-Shomadhan (BD-A)', open: '185–never', auto: '0–10%', right: '81.8–100%' },
      { area: 'Gazipur (BD-E)', open: '315–614', auto: '29–36%', right: '93.5–97.4%' },
    ],
    sources: [file('ml/vision/artifacts/earned_trust_ci.json'), file('ml/vision/MODEL_CARD.md')],
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

/* ------------------------------------------------------------------ measured this week (29 Oct), each with its report */
export type NewEvalId = 'safety' | 'speech' | 'sovereign' | 'agritriage';
export interface NewEval {
  id: NewEvalId;
  value: string;
  tone: EvalTone;
  /** a two- or three-row comparison: the bar width (0..1) and the text as the report states it */
  compare: { key: string; width: number; text: string; strong?: boolean; bad?: boolean }[];
  source: Source;
  /** when the numbers come from more than one file: all of them (the first is `source`) */
  sources?: Source[];
  /** still running, so not final */
  partial?: boolean;
}
export const NEW_EVALS: NewEval[] = [
  {
    id: 'safety',
    value: '0/128',
    tone: 'synthetic',
    // REPORT.md headline (scored 2 Nov): the 4 valid models pooled, en+bn dose questions 85/112 (neutral prompt) and
    // 0/112 (safety prompt); 2 invalid runs and 1 failed model are left out. KrishiLoop 0/128 on the same questions.
    compare: [
      { key: 'raw', width: 85 / 112, text: '85/112', bad: true },
      { key: 'prompted', width: 0, text: '0/112' },
      { key: 'ours', width: 0, text: '0/128', strong: true },
    ],
    source: file('ml/evals/safety/REPORT.md'),
    partial: true,
  },
  {
    id: 'speech',
    value: '6.2%',
    tone: 'measured',
    // REPORT.md section 1: FLEURS bn_in test, 920 utterances, corpus-level character error rate
    compare: [
      { key: 'omni', width: 0.062, text: '6.2%', strong: true },
      { key: 'whisper', width: 0.453, text: '45.3%', bad: true },
    ],
    source: file('ml/voice/REPORT.md'),
  },
  {
    id: 'sovereign',
    value: '23.8 ms',
    tone: 'measured',
    // REPORT.md latency table: "Photo, server reading" p50, one request at a time, 40 photos
    compare: [
      { key: 'gpu', width: 23.8 / 931.9, text: '23.8 ms', strong: true },
      { key: 'cpu', width: 1, text: '932 ms' },
    ],
    source: file('ml/sovereign/REPORT.md'),
  },
  {
    id: 'agritriage',
    value: '77.4%',
    tone: 'measured',
    // AgriTriage-Lite (the owner's poster project; copies of its files in apps/web/public/models/agritriage/). Top-1 of the
    // INT8 student on PlantWild test (3,663 photos, 89 diseases): config.json onnx_test_accuracy.int8 = 0.7742. Gate rows:
    // demo-README.md table (= config.json test_report). Last three rows: poster_numbers.json unknown "Unseen diseases"
    // 0.8168, shift_coverage RiceLeafBD 0.8043 -> 0.9036, ufd "Lab -> field" 0.2260 -> 0.3828: the earlier MobileNetV3-S
    // student (REVIEW.md, last section), not the TinyViT the app runs.
    compare: [
      { key: 'anyCrop', width: 0.64, text: '64% · 91%' },
      { key: 'cropKnown', width: 0.88, text: '88% · 92%', strong: true },
      { key: 'shortlist', width: 0.18, text: '18% / 7%' },
      { key: 'refer', width: 0.19, text: '19% / 5%' },
      { key: 'coverage', width: 0.92, text: '92% / 92%' },
      { key: 'unseen', width: 0.82, text: '82%' },
      { key: 'recal', width: 0.904, text: '80.4% → 90.4%' },
      { key: 'field', width: 0.383, text: '22.6% → 38.3%' },
    ],
    source: file('apps/web/public/models/agritriage/config.json'),
    sources: [
      file('apps/web/public/models/agritriage/config.json'),
      file('apps/web/public/models/agritriage/evidence/demo-README.md'),
      file('apps/web/public/models/agritriage/evidence/poster_numbers.json'),
      file('apps/web/public/models/agritriage/evidence/REVIEW.md'),
    ],
  },
];

/** the commands behind "check it yourself" (README.md "Run it"; score.py rebuilds the safety report) */
export const REPRO: { cmd: string; out?: 'clone' | 'contracts' | 'quotes' | 'tests' | 'safety' }[] = [
  { cmd: 'git clone https://github.com/krishiloop/krishiloop' },
  { cmd: 'cd krishiloop' },
  { cmd: 'python -m pip install -r requirements-dev.txt' },
  { cmd: 'python tools/validate_contracts.py', out: 'contracts' },
  { cmd: 'python tools/check_quotes.py', out: 'quotes' },
  { cmd: 'python -m pytest -q', out: 'tests' },
  { cmd: 'python ml/evals/safety/score.py', out: 'safety' },
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
export type RegisterId = 'meteo' | 'sentinel' | 'brri' | 'cip' | 'leaf' | 'textModels' | 'voice';
export const REGISTER: { id: RegisterId; name: string; licence: string; source: Source }[] = [
  { id: 'meteo', name: 'Open-Meteo forecast + GloFAS', licence: 'free API, non-commercial', source: file('services/engine/snapshot.py') },
  { id: 'sentinel', name: 'Sentinel-2 L2A / Sentinel-1 (STAC)', licence: 'Copernicus, free and open', source: file('docs/mcp/README.md') },
  { id: 'brri', name: 'BRRI Rice Knowledge Bank', licence: 'cited_permission_requested', source: file('corpus/manifest.yaml') },
  { id: 'cip', name: 'CIP potato late-blight manual', licence: 'permitted (not CC BY)', source: file('corpus/manifest.yaml') },
  { id: 'leaf', name: 'Dhan-Shomadhan, RiceyLeafDisease, RiceLeafDisease-BD5, RiceLeafDiseaseBD', licence: 'CC BY 4.0', source: file('ml/vision/MODEL_CARD.md') },
  { id: 'textModels', name: 'multilingual-e5-small · gte-multilingual-reranker-base', licence: 'MIT · Apache-2.0', source: file('ml/ask/eval_report.json') },
  { id: 'voice', name: 'svara-tts-v1 (Built with Llama) · Omnilingual CTC-1B', licence: 'Llama 3.2 Community License · Apache-2.0', source: file('ml/voice/REPORT.md') },
];

export const READ_THE_CODE: Source[] = [file('README.md'), dir('specs'), dir('contracts'), file('ml/vision/MODEL_CARD.md'), dir('docs/prompt-library')];
export const PROMPT_LIBRARY = { index: file('docs/prompt-library/README.md'), brief: file('docs/prompt-library/frontend-redesign-brief.md') };
