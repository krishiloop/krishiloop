import { useEffect, useRef, useState } from 'react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { useInViewOnce } from '../../lib/hooks';
import { CROP, PlantIcon } from './plantIcons';

/**
 * "Plants the photo AI knows" (v6): the crop list is read from the model's own config.json (`crops`, one per class, so
 * repeated), never typed in. Loaded only when the strip nears the screen. The label is the model's licence label.
 */
export function PlantStrip() {
  const { t, lang } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const near = useInViewOnce(ref, '300px 0px 300px 0px');
  const [crops, setCrops] = useState<string[] | null>(null);

  useEffect(() => {
    if (!near || crops) return;
    let alive = true;
    fetch('/models/agritriage/config.json')
      .then((r) => r.json() as Promise<{ crops?: string[] }>)
      .then((c) => alive && setCrops([...new Set(c.crops ?? [])].sort()))
      .catch(() => undefined); // the strip stays empty rather than inventing a list
    return () => {
      alive = false;
    };
  }, [near, crops]);

  const name = (c: string) => (CROP[c] ? t(`pl.c.${c.replace(' ', '_')}` as Key) : c.replace(/^\w/, (m) => m.toUpperCase()));
  return (
    <section ref={ref} className="section botanic-bg botanic-bg--orchard" aria-labelledby="pl-title" data-testid="plant-strip">
      <div className="wrap">
        <p className="eyebrow">{t('pl.eyebrow')}</p>
        <h2 id="pl-title" className="t-title mt-3 max-w-[20ch]">
          {t('pl.title')}
        </h2>
        <p className="mt-4 flex flex-wrap items-center gap-2">
          <span className="chip chip-carbon" data-testid="plant-label">
            {t('pl.label')}
          </span>
          {crops && <span className="mono text-xs text-ink-3">{t('pl.count', { n: fmtNum(crops.length, lang) })}</span>}
        </p>
        <ul className="pl-list" data-testid="plant-list">
          {(crops ?? []).map((c) => (
            <li key={c}>
              <PlantIcon shape={CROP[c] ?? 'leaf'} />
              <span>{name(c)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
