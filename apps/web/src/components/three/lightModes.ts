export type LightMode = 'sun' | 'rain' | 'dusk';
export type RGB = [number, number, number];

export interface Preset {
  zenith: RGB;
  horizon: RGB;
  sunDir: [number, number, number];
  sunColor: RGB;
  sunPower: number;
  fogColor: RGB;
  fogDensity: number;
  stars: number;
  cloud: number;
  wind: number;
  wet: number;
  rain: number;
  bladeBase: RGB;
  bladeMid: RGB;
  bladeTip: RGB;
}

const norm = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * The three states of the weather calendar. The field scene shows today's forecast: heavy rain days show the
 * rain mode, otherwise the golden morning. "Dusk" is there to let people feel the range of the light.
 */
export const PRESETS: Record<LightMode, Preset> = {
  sun: {
    zenith: [0.14, 0.32, 0.5],
    horizon: [0.99, 0.72, 0.46],
    sunDir: norm([0.3, 0.12, -1]),
    sunColor: [1.0, 0.8, 0.52],
    sunPower: 1.0,
    fogColor: [0.92, 0.7, 0.52],
    fogDensity: 0.016,
    stars: 0,
    cloud: 0.55,
    wind: 0.62,
    wet: 0,
    rain: 0,
    bladeBase: [0.05, 0.16, 0.07],
    bladeMid: [0.17, 0.44, 0.13],
    bladeTip: [0.62, 0.72, 0.2],
  },
  rain: {
    zenith: [0.25, 0.31, 0.34],
    horizon: [0.58, 0.65, 0.65],
    sunDir: norm([0.2, 0.5, -1]),
    sunColor: [0.8, 0.85, 0.85],
    sunPower: 0.0,
    fogColor: [0.52, 0.6, 0.6],
    fogDensity: 0.03,
    stars: 0,
    cloud: 1.0,
    wind: 0.95,
    wet: 1,
    rain: 1,
    bladeBase: [0.02, 0.09, 0.06],
    bladeMid: [0.12, 0.33, 0.16],
    bladeTip: [0.36, 0.52, 0.28],
  },
  dusk: {
    zenith: [0.05, 0.06, 0.17],
    horizon: [0.92, 0.42, 0.3],
    sunDir: norm([0.2, -0.03, -1]),
    sunColor: [1.0, 0.45, 0.3],
    sunPower: 0.55,
    fogColor: [0.42, 0.2, 0.28],
    fogDensity: 0.02,
    stars: 0.9,
    cloud: 0.5,
    wind: 0.4,
    wet: 0.1,
    rain: 0,
    bladeBase: [0.01, 0.05, 0.07],
    bladeMid: [0.07, 0.2, 0.16],
    bladeTip: [0.33, 0.38, 0.33],
  },
};
