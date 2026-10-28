/**
 * SAMPLE crop packs: the diseases, symptom signatures and "next view" questions a real crop pack will carry, filled
 * with clearly labelled stand-ins so the whole diagnosis result can be built and shown before the KrishiLens model and
 * the Knowledge Compiler's signatures exist (plan/VISION_RESEARCH_PLAN.md M4 to M6).
 *
 * Nothing here is a model output and nothing here is a real citation. Every Citation has `sample: true`, which the
 * UI turns into a "Sample" label next to the quote; the real quote and page arrive with the signatures. A crop pack
 * is DATA: adding a crop means adding an entry here (or, later, loading its pack from the API), not changing the UI.
 */
import type { I18nText } from '../../../lib/api/types';
import type { Citation, Severity, ViewArt } from './report';
import type { SampleArt } from './sampleArt';

export type SampleScenarioId = 'needs_view' | 'confident' | 'unsure';
export const SAMPLE_SCENARIOS: readonly SampleScenarioId[] = ['needs_view', 'confident', 'unsure'];

export interface SymptomDef {
  label: I18nText;
  pointsTo: string[];
  cite: Citation;
}
export interface ViewDef {
  art: ViewArt;
  title: I18nText;
  reason: I18nText;
  separates: string[];
}
export interface SampleStep {
  /** [disease id, probability]; whatever is left becomes "Other" */
  differential: [string, number][];
  severity?: Severity;
  /** [symptom concept, strength] seen in this step's photo */
  seen: [string, number][];
  /** concepts the leading diseases' signatures expect that have not been seen (yet) */
  expected?: string[];
  /** id of the next view to ask for */
  view?: string;
  /** which sample picture this step shows */
  art: SampleArt;
}
export interface SamplePack {
  crop: string;
  /** the crop pack this stands in for */
  packId: string;
  diseases: Record<string, I18nText>;
  symptoms: Record<string, SymptomDef>;
  views: Record<string, ViewDef>;
  scenarios: Record<SampleScenarioId, SampleStep[]>;
}

const cite = (key: string, quote: string): Citation => ({
  doc_id: `SAMPLE-SIG-${key}`,
  title: 'Sample signature (placeholder)',
  publisher: 'KrishiLoop sample data',
  page: '—',
  quote,
  sample: true,
});

const POTATO: SamplePack = {
  crop: 'potato',
  packId: 'pack-potato-late-blight',
  diseases: {
    late_blight: { en: 'Late blight', bn: 'নাবি ধসা (লেট ব্লাইট)' },
    early_blight: { en: 'Early blight', bn: 'আগাম ধসা (আর্লি ব্লাইট)' },
    healthy: { en: 'Healthy leaf', bn: 'সুস্থ পাতা' },
  },
  symptoms: {
    water_soaked_tissue: {
      label: { en: 'Water-soaked tissue', bn: 'পানি-ভেজা অংশ' },
      pointsTo: ['late_blight'],
      cite: cite('POTATO-LB-1', 'Lesions look water-soaked and enlarge quickly in humid weather.'),
    },
    necrotic_spot: {
      label: { en: 'Dark dead spots', bn: 'কালচে মরা দাগ' },
      pointsTo: ['late_blight', 'early_blight'],
      cite: cite('POTATO-NS-1', 'Dark, dead patches of leaf tissue are the first visible sign.'),
    },
    downy_growth: {
      label: { en: 'White downy growth (underside)', bn: 'সাদা তুলার মতো বৃদ্ধি (পাতার নিচে)' },
      pointsTo: ['late_blight'],
      cite: cite('POTATO-LB-2', 'In humid weather, white fuzzy growth appears on the underside of the leaf around the lesion.'),
    },
    concentric_rings: {
      label: { en: 'Concentric rings', bn: 'বলয়াকার দাগ' },
      pointsTo: ['early_blight'],
      cite: cite('POTATO-EB-1', 'Early blight spots show concentric rings, like a target.'),
    },
  },
  views: {
    underside: {
      art: 'underside',
      title: { en: 'Photograph the underside of a leaf', bn: 'পাতার নিচের দিকের ছবি তুলুন' },
      reason: {
        en: 'White fuzzy growth there would mean late blight. None would point to early blight.',
        bn: 'সেখানে সাদা তুলার মতো বৃদ্ধি থাকলে লেট ব্লাইট। না থাকলে আর্লি ব্লাইটের দিকে ইঙ্গিত।',
      },
      separates: ['late_blight', 'early_blight'],
    },
  },
  scenarios: {
    needs_view: [
      {
        differential: [
          ['early_blight', 0.44],
          ['late_blight', 0.41],
          ['healthy', 0.06],
        ],
        severity: { pct: 12, lo: 8, hi: 16 },
        seen: [
          ['water_soaked_tissue', 0.74],
          ['necrotic_spot', 0.81],
        ],
        expected: ['downy_growth', 'concentric_rings'],
        view: 'underside',
        art: 'top',
      },
      {
        differential: [
          ['late_blight', 0.87],
          ['early_blight', 0.06],
          ['healthy', 0.02],
        ],
        severity: { pct: 12, lo: 9, hi: 15 },
        seen: [
          ['water_soaked_tissue', 0.76],
          ['necrotic_spot', 0.8],
          ['downy_growth', 0.91],
        ],
        expected: ['concentric_rings'],
        art: 'underside',
      },
    ],
    confident: [
      {
        differential: [
          ['late_blight', 0.84],
          ['early_blight', 0.08],
          ['healthy', 0.02],
        ],
        severity: { pct: 12, lo: 8, hi: 16 },
        seen: [
          ['water_soaked_tissue', 0.82],
          ['necrotic_spot', 0.84],
        ],
        expected: ['concentric_rings'],
        art: 'top',
      },
    ],
    unsure: [
      {
        differential: [
          ['late_blight', 0.31],
          ['early_blight', 0.29],
          ['healthy', 0.18],
        ],
        severity: { pct: 6, lo: 3, hi: 11 },
        seen: [['necrotic_spot', 0.55]],
        expected: ['downy_growth', 'concentric_rings'],
        view: 'underside',
        art: 'top',
      },
      {
        differential: [
          ['late_blight', 0.3],
          ['early_blight', 0.28],
          ['healthy', 0.19],
        ],
        severity: { pct: 6, lo: 3, hi: 11 },
        seen: [['necrotic_spot', 0.52]],
        expected: ['downy_growth', 'concentric_rings'],
        art: 'underside',
      },
    ],
  },
};

const RICE: SamplePack = {
  crop: 'rice',
  packId: 'pack-bd-rice',
  diseases: {
    rice_blast: { en: 'Rice blast', bn: 'ধানের ব্লাস্ট' },
    brown_spot: { en: 'Brown spot', bn: 'বাদামি দাগ রোগ' },
    bacterial_leaf_blight: { en: 'Bacterial leaf blight', bn: 'ব্যাকটেরিয়াজনিত পাতা ঝলসানো' },
    healthy: { en: 'Healthy leaf', bn: 'সুস্থ পাতা' },
  },
  symptoms: {
    spindle_shape: {
      label: { en: 'Spindle-shaped lesions', bn: 'টাকুর মতো লম্বাটে দাগ' },
      pointsTo: ['rice_blast'],
      cite: cite('RICE-RB-1', 'Blast lesions are spindle-shaped, with a grey or whitish centre and a brown margin.'),
    },
    grey_centre: {
      label: { en: 'Grey centre', bn: 'ধূসর কেন্দ্র' },
      pointsTo: ['rice_blast'],
      cite: cite('RICE-RB-2', 'The centre of an older blast lesion turns grey or whitish.'),
    },
    necrotic_spot: {
      label: { en: 'Dark dead spots', bn: 'কালচে মরা দাগ' },
      pointsTo: ['rice_blast', 'brown_spot'],
      cite: cite('RICE-NS-1', 'Lesions start as small dark spots on the leaf blade.'),
    },
    round_spot: {
      label: { en: 'Small round brown spots', bn: 'ছোট গোল বাদামি দাগ' },
      pointsTo: ['brown_spot'],
      cite: cite('RICE-BS-1', 'Brown spot appears as small, round to oval, brown spots scattered over the leaf.'),
    },
    chlorotic_halo: {
      label: { en: 'Yellow halo', bn: 'হলুদ বলয়' },
      pointsTo: ['brown_spot', 'rice_blast'],
      cite: cite('RICE-CH-1', 'A yellow halo can surround the lesion.'),
    },
  },
  views: {
    close_up: {
      art: 'close_up',
      title: { en: 'Move closer to one spot', bn: 'একটি দাগের কাছে গিয়ে ছবি তুলুন' },
      reason: {
        en: 'A spindle shape with a grey centre would mean blast. Small round brown spots would mean brown spot.',
        bn: 'টাকুর মতো আকার ও ধূসর কেন্দ্র থাকলে ব্লাস্ট। ছোট গোল বাদামি দাগ হলে বাদামি দাগ রোগ।',
      },
      separates: ['rice_blast', 'brown_spot'],
    },
  },
  scenarios: {
    needs_view: [
      {
        differential: [
          ['brown_spot', 0.43],
          ['rice_blast', 0.4],
          ['bacterial_leaf_blight', 0.07],
        ],
        severity: { pct: 9, lo: 6, hi: 13 },
        seen: [
          ['necrotic_spot', 0.8],
          ['chlorotic_halo', 0.6],
        ],
        expected: ['spindle_shape', 'round_spot'],
        view: 'close_up',
        art: 'top',
      },
      {
        differential: [
          ['rice_blast', 0.85],
          ['brown_spot', 0.07],
          ['bacterial_leaf_blight', 0.02],
        ],
        severity: { pct: 9, lo: 7, hi: 12 },
        seen: [
          ['necrotic_spot', 0.82],
          ['chlorotic_halo', 0.6],
          ['spindle_shape', 0.9],
          ['grey_centre', 0.86],
        ],
        expected: ['round_spot'],
        art: 'close',
      },
    ],
    confident: [
      {
        differential: [
          ['rice_blast', 0.83],
          ['brown_spot', 0.08],
          ['bacterial_leaf_blight', 0.02],
        ],
        severity: { pct: 9, lo: 6, hi: 13 },
        seen: [
          ['necrotic_spot', 0.84],
          ['spindle_shape', 0.8],
        ],
        expected: ['round_spot'],
        art: 'top',
      },
    ],
    unsure: [
      {
        differential: [
          ['rice_blast', 0.3],
          ['brown_spot', 0.28],
          ['bacterial_leaf_blight', 0.17],
        ],
        severity: { pct: 5, lo: 3, hi: 9 },
        seen: [['necrotic_spot', 0.5]],
        expected: ['spindle_shape', 'round_spot'],
        view: 'close_up',
        art: 'top',
      },
      {
        differential: [
          ['rice_blast', 0.29],
          ['brown_spot', 0.27],
          ['bacterial_leaf_blight', 0.18],
        ],
        severity: { pct: 5, lo: 3, hi: 9 },
        seen: [['necrotic_spot', 0.5]],
        expected: ['spindle_shape', 'round_spot'],
        art: 'close',
      },
    ],
  },
};

export const SAMPLE_PACKS: Record<string, SamplePack> = { potato: POTATO, rice: RICE };
