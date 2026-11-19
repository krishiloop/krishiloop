import { cx } from '../lib/cx';

export type PlantName = 'potato' | 'tomato' | 'jute' | 'mango' | 'wheat' | 'banana' | 'chilli';
const ASPECT: Record<PlantName, [number, number]> = { potato: [200, 270], tomato: [200, 270], jute: [200, 280], mango: [200, 190], wheat: [200, 280], banana: [230, 296], chilli: [200, 270] };

/** A small quiet line drawing (public/art/plants/*.svg) for a card or an empty state. Decorative: no alt text. */
export function PlantSpot({ name, className, size = 56 }: { name: PlantName; className?: string; size?: number }) {
  const [w, h] = ASPECT[name];
  return <img src={`/art/plants/${name}.svg`} alt="" aria-hidden width={size} height={Math.round((size * h) / w)} loading="lazy" decoding="async" className={cx('plant-spot', className)} />;
}
