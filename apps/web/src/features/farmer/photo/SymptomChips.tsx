import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, CircleDashed, ExternalLink } from 'lucide-react';
import type { Report, Symptom } from './report';
import { Sheet } from '../../../components/ui/Sheet';
import { SampleBadge } from '../../../components/ui/Badges';
import { useI18n } from '../../../lib/i18n';
import { pickText } from '../../../lib/format';
import { cx } from '../../../lib/cx';

/**
 * "Symptoms seen": the visible signs the model found (universal symptom concepts), each linked to the manual quote and
 * page it comes from. Signs the leading diseases are known by that have NOT been seen are listed apart, dashed: they
 * are exactly what the next photo is asked to check. A chip that is new since the last reading pops in.
 */
export function SymptomChips({ report, onOpen }: { report: Report; onOpen: (s: Symptom) => void }) {
  const { t, lang } = useI18n();
  const seen = report.symptoms.filter((s) => s.seen);
  const todo = report.symptoms.filter((s) => !s.seen);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const before = useRef<{ id: string; seen: Set<string> } | null>(null);

  useEffect(() => {
    const now = new Set(report.symptoms.filter((s) => s.seen).map((s) => s.concept));
    const prev = before.current;
    before.current = { id: report.id, seen: now };
    if (!prev || prev.id === report.id) return;
    const added = new Set([...now].filter((c) => !prev.seen.has(c)));
    setFresh(added);
    const timer = window.setTimeout(() => setFresh(new Set()), 2800);
    return () => window.clearTimeout(timer);
  }, [report.id, report.symptoms]);

  const chip = (s: Symptom) => {
    const label = pickText(s.label, lang);
    return (
      <li key={s.concept}>
        <button type="button" className={cx('sym', s.seen ? 'is-seen' : 'is-todo')} data-new={fresh.has(s.concept)} onClick={() => onOpen(s)} aria-haspopup="dialog" data-testid={`symptom-${s.concept}`}>
          {s.seen ? <Check size={13} strokeWidth={2.4} aria-hidden /> : <CircleDashed size={13} aria-hidden />}
          <span lang={label.lang}>{label.text}</span>
          {s.cite ? <BookOpen size={13} aria-hidden className="sym-book" /> : null}
          <span className="sr-only">{s.seen ? t('photo.symptoms.seenOne') : t('photo.symptoms.todoOne')}. {s.cite ? t('photo.symptoms.opens') : ''}</span>
        </button>
      </li>
    );
  };

  return (
    <section className="syms" aria-labelledby="syms-t" data-testid="photo-symptoms">
      <h3 id="syms-t" className="eyebrow !text-chrome m-0">
        {t('photo.symptoms')}
      </h3>
      {seen.length ? <ul className="sym-list">{seen.map(chip)}</ul> : <p className="m-0 mt-2 text-sm text-dim">{t('photo.symptoms.none')}</p>}
      {todo.length ? (
        <>
          <h4 className="sym-sub">{t('photo.symptoms.todo')}</h4>
          <ul className="sym-list">{todo.map(chip)}</ul>
        </>
      ) : null}
    </section>
  );
}

/** The manual quote behind a symptom, in the paper style of every receipt. A sample citation says so, loudly. */
export function CitationSheet({ symptom, report, onClose }: { symptom: Symptom | null; report: Report; onClose: () => void }) {
  const { t, lang } = useI18n();
  const label = symptom ? pickText(symptom.label, lang).text : '';
  const c = symptom?.cite;
  const noPage = c?.page === '—' || c?.page === '' || c?.page == null;
  const diseases = (symptom?.pointsTo ?? [])
    .map((id) => report.differential.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => !!d)
    .map((d) => pickText(d.name, lang).text);
  return (
    <Sheet open={!!symptom} onClose={onClose} title={label}>
      {c ? (
        <div className="cite" data-testid="citation">
          <div className="cite-paper">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="pass-kicker">{t('photo.cite.kicker')}</span>
              {c.sample ? <SampleBadge className="pass-sample" /> : null}
            </div>
            <figure className="pass-source !mt-3 !mb-0">
              <blockquote className="pass-quote" lang="en">
                “{c.quote}”
              </blockquote>
              <figcaption className="pass-cite">
                <span className="pass-chip tabular">{noPage ? t('photo.cite.noPage') : t('common.page', { n: c.page })}</span>
                <span>
                  {c.title} · {c.publisher}
                </span>
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="pass-link">
                    {t('receipt.readSource')}
                    <ExternalLink size={12} aria-hidden />
                  </a>
                ) : null}
              </figcaption>
            </figure>
          </div>
          {diseases.length ? <p className="m-0 mt-4 text-sm text-chrome">{t('photo.cite.points', { diseases: diseases.join(', ') })}</p> : null}
          {c.sample ? <p className="m-0 mt-3 text-sm text-dim">{t('photo.cite.sampleNote')}</p> : null}
        </div>
      ) : (
        <p className="m-0 text-chrome">{t('photo.cite.none')}</p>
      )}
    </Sheet>
  );
}
