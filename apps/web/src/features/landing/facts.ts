/**
 * Facts shown on the story page. Every row comes from a VERIFIED row of the fact registers
 * (research/fact_register.md = Bangladesh, research/fact_register_global.md = global); the id is the register id.
 * Anything computed from two verified numbers is marked "our arithmetic". Nothing here is estimated from memory.
 */
export interface Fact {
  /** register id, e.g. GL-01 */
  id: string;
  value: number;
  /** text after the number, e.g. "million" */
  unit?: string;
  suffix?: string;
  decimals?: number;
  label: string;
  source: string;
  note?: string;
  href?: string;
}

/** GL-01: 608M+ farms (FAO ESA WP 19-08, 2019). */
export const FARMS: Fact = {
  id: 'GL-01',
  value: 608,
  unit: 'million+',
  label: 'farms in the world',
  source: 'FAO, 2019',
  href: 'https://www.fao.org/agrifood-economics/publications/detail/en/c/1252236/',
};

/** GL-02: 84% of farms are under 2 ha and farm about 12% of farmland (FAO ESA WP 19-08, 2019). */
export const SMALL: Fact = {
  id: 'GL-02',
  value: 84,
  suffix: '%',
  label: 'of them are under 2 hectares, and farm only about 12% of the land',
  source: 'FAO, 2019',
  href: 'https://www.fao.org/agrifood-economics/publications/detail/en/c/1252236/',
};

/** GL-14: pests and pathogens cut rice yield by 30.0% (Savary et al., Nature Ecology & Evolution 3, 2019). Expert-based estimate. */
export const RICE_LOSS: Fact = {
  id: 'GL-14',
  value: 30,
  suffix: '%',
  label: 'of rice yield is lost to pests and pathogens',
  source: 'Savary et al., Nature Ecology & Evolution, 2019',
  note: 'an expert-based estimate',
  href: 'https://pure.psu.edu/en/publications/the-global-burden-of-pathogens-and-pests-on-major-food-crops/',
};

/** A3: 16.88 million agriculture-based households (Agriculture Census 2019, via The Financial Express, 27 Dec 2022). */
export const HOUSEHOLDS = { id: 'A3', value: 16_880_000, source: 'Bangladesh Agriculture Census 2019', href: 'https://mail.thefinancialexpress.com.bd/national/number-of-agriculture-based-households-increases-to-1688-million-1672152805' } as const;

/** D4: the Agriculture Call Centre (16123) received 92,094 calls, Jul 2025 to Jun 2026 (BSS, 2 Jul 2026). Calls received, not households helped. */
export const CALLS = { id: 'D4', value: 92_094, source: 'BSS news agency, 2 Jul 2026', href: 'https://www.bssnews.net/special-stories/401845' } as const;

/** D1: smartphone ownership 26% rural vs 41% urban in Bangladesh (GSMA 2024, via The Financial Express, 9 Dec 2024). */
export const PHONES = { id: 'D1', rural: 26, urban: 41, source: 'GSMA 2024, via The Financial Express', href: 'https://thefinancialexpress.com.bd/national/bd-bottom-among-12-lmics-in-usage-of-phone-net' } as const;

/** B2: BRRI found yield losses of up to 80% from blast in some places in the 2023 boro season (TBS News, 30 Apr 2023). */
export const BLAST = { id: 'B2', value: 80, source: 'BRRI, via TBS News, 2023', href: 'https://www.tbsnews.net/node/624442' } as const;

/** GL-25: EU AI Act Art. 50 applies from 2 Aug 2026: machine-readable marking of AI-generated content, in the EU. */
export const EU_ACT = { id: 'GL-25', source: 'European Commission', href: 'https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai' } as const;

/** Each dot is 1,000 farm households (A3). The glowing dots are the 92 thousand calls (D4). Our arithmetic. */
export const DOT_HOUSEHOLDS = 1000;
export const HOUSEHOLDS_PER_CALL = Math.round(HOUSEHOLDS.value / CALLS.value); // 183: our arithmetic

/**
 * Our own dated test, 25 Oct 2026 (research/llm_bangla_smoke_test.md): ONE Bangla question
 * ("eye-shaped spots on Aman rice leaves: what is it, what to do?") put to four models through free-tier APIs.
 * An anecdote, not a benchmark. Models are anonymised here; names are in the test log.
 */
export interface ModelAnswer {
  n: number;
  diagnosis: string;
  rightDisease: boolean;
  problems: string[];
}
export const BANGLA_TEST: ModelAnswer[] = [
  { n: 1, diagnosis: 'Leaf spot', rightDisease: false, problems: ['vague diagnosis', 'garbled Bangla terms', 'an invented fungicide name', 'advice to spray after harvest'] },
  { n: 2, diagnosis: 'Eye-spot (fungal)', rightDisease: false, problems: ['never names blast', 'exact chemical doses, no source'] },
  { n: 3, diagnosis: 'Brown spot', rightDisease: false, problems: ['likely wrong disease', 'Latin and Italian fragments inside the Bangla', 'a dose with the product name missing'] },
  { n: 4, diagnosis: 'Leaf blast', rightDisease: true, problems: ['a dose nobody can check', 'commercial brand names'] },
];
export const TEST_TALLY = { models: 4, rightDisease: 1, unsourcedDose: 3 } as const;
