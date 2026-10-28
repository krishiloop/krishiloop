import { useId, useState } from 'react';
import { BookOpen, ChevronDown, ReceiptText, ShieldCheck, TriangleAlert } from 'lucide-react';
import { OTHER, type Report, type Symptom } from './report';
import type { ModelSha } from './photoModel';
import { SampleBadge } from '../../../components/ui/Badges';
import { useI18n } from '../../../lib/i18n';
import { fmtNum, pickText } from '../../../lib/format';

/**
 * The diagnosis receipt. Always one line (the model spec: name and version, how many sets it was tested on, the time on
 * THIS phone); open it for the whole spec sheet: the reading, severity, each symptom with its manual quote, what the
 * model was tested on and the score on each, the threshold it acts at, and the hash of the model file the phone checked.
 * Every value is data (the Report, its EngineInfo, the model card): nothing here is a hard-coded disclaimer.
 */
export function DiagnosisReceipt({ report, sha, onOpenSymptom }: { report: Report; sha: ModelSha | null; onOpenSymptom: (s: Symptom) => void }) {
  const { t, lang } = useI18n();
  const panel = useId();
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 720px)').matches);
  const info = report.engine;
  const named = report.differential.filter((d) => d.id !== OTHER);
  const best = named[0];
  const second = named[1];
  const pct = (p: number) => fmtNum(Math.round(p * 100), lang);
  const score = (s: number) => fmtNum(s, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tested = info.testedOn.filter((r) => r.score !== null).length;
  const name = (d: NonNullable<typeof best>) => pickText(d.name, lang).text;
  const seen = report.symptoms.filter((s) => s.seen);
  const hex = sha?.hex ?? info.sha256;
  const shaState = !info.sha256 ? null : !sha?.checked ? 'unchecked' : sha.matches ? 'ok' : 'mismatch';

  const reading =
    report.verdict === 'confident' && best
      ? t('photo.receipt.readingOk', { label: name(best), pct: pct(best.prob) })
      : report.verdict === 'ambiguous' && best && second
        ? t('photo.receipt.readingEither', { a: name(best), b: name(second) })
        : best
          ? t('photo.receipt.readingUnsure', { label: name(best), pct: pct(best.prob) })
          : '';

  return (
    <section className="dxr" data-testid="diagnosis-receipt" data-open={open} data-sample={info.sample} aria-label={t('photo.receipt.title')}>
      <button type="button" className="dxr-toggle" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)} data-testid="dxr-toggle">
        <span className="dxr-kicker">
          <ReceiptText size={14} aria-hidden /> {t('photo.receipt.title')}
          {info.sample ? <SampleBadge className="pass-sample" /> : null}
        </span>
        <span className="dxr-line" data-testid="photo-spec">
          <span className="dxr-mono">
            {info.name} · {info.version}
          </span>
          <span>{tested > 0 ? t('photo.spec.tested', { n: tested }) : info.sample ? t('photo.spec.sample') : t('photo.spec.untested')}</span>
          {report.ms > 0 ? <span className="tabular">{t('photo.spec.ms', { ms: fmtNum(Math.max(1, Math.round(report.ms)), lang) })}</span> : null}
        </span>
        <ChevronDown size={16} aria-hidden data-open={open} className="dxr-chev" />
      </button>

      <div id={panel} className="dxr-panel" data-open={open}>
        <div>
          {info.sample ? <p className="dxr-sample">{t('photo.receipt.sampleNote')}</p> : null}
          <dl className="dxr-list">
            <div>
              <dt>{t('photo.receipt.reading')}</dt>
              <dd data-testid="dxr-reading">
                <strong>{reading}</strong>
                {report.photos > 1 ? <small>{t('photo.avg', { n: report.photos })}</small> : null}
              </dd>
            </div>

            {report.severity ? (
              <div>
                <dt>{t('photo.severity')}</dt>
                <dd>
                  <strong className="tabular">{t('photo.severity.value', { pct: fmtNum(report.severity.pct, lang) })}</strong>
                  {report.severity.lo != null && report.severity.hi != null ? <small>{t('photo.severity.range', { range: `${fmtNum(report.severity.lo, lang)}–${fmtNum(report.severity.hi, lang)}%` })}</small> : null}
                </dd>
              </div>
            ) : null}

            {seen.length ? (
              <div className="dxr-wide">
                <dt>{t('photo.symptoms')}</dt>
                <dd>
                  <ul className="dxr-syms">
                    {seen.map((s) => (
                      <li key={s.concept}>
                        <span lang={pickText(s.label, lang).lang}>{pickText(s.label, lang).text}</span>
                        {s.cite ? (
                          <button type="button" className="dxr-cite" onClick={() => onOpenSymptom(s)}>
                            <BookOpen size={12} aria-hidden /> {t('photo.receipt.quote')}
                            {s.cite.sample ? ` · ${t('common.sample')}` : ''}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}

            <div>
              <dt>{t('photo.receipt.model')}</dt>
              <dd>
                <span className="dxr-mono" data-testid="dxr-model">
                  {info.name} · {info.version}
                </span>
                {info.family || info.sizeBytes ? (
                  <small>
                    {[info.family, info.sizeBytes ? t('photo.receipt.size', { mb: fmtNum(info.sizeBytes / 1_000_000, lang, { maximumFractionDigits: 1 }) }) : null, info.precision].filter(Boolean).join(' · ')}
                  </small>
                ) : null}
              </dd>
            </div>

            {info.testedOn.length ? (
              <div className="dxr-wide">
                <dt>{t('photo.receipt.tested')}</dt>
                <dd>
                  <ul className="dxr-tests" data-testid="dxr-tests">
                    {info.testedOn.map((r) => (
                      <li key={r.id} data-na={r.score === null}>
                        <span className="dxr-ds">{r.dataset}</span>
                        {r.score === null ? (
                          <span className="dxr-na">{t('photo.receipt.notTested')}</span>
                        ) : (
                          <span className="dxr-score" title={r.metric}>
                            {score(r.score)}
                          </span>
                        )}
                        <span className="dxr-bar" aria-hidden>
                          <span style={{ ['--p' as string]: r.score ?? 0 }} />
                        </span>
                        <span className="dxr-n">{r.score === null ? '' : `${r.metric}${r.n ? ` · ${t('photo.receipt.photos', { n: fmtNum(r.n, lang) })}` : ''}`}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}

            {report.ms > 0 ? (
              <div>
                <dt>{t('photo.receipt.ran')}</dt>
                <dd>
                  <strong className="tabular">{t('photo.receipt.ms', { ms: fmtNum(Math.max(1, Math.round(report.ms)), lang) })}</strong>
                  <small>{t('photo.timeNote', { prep: fmtNum(Math.round(report.prepMs), lang) })}</small>
                </dd>
              </div>
            ) : null}

            <div>
              <dt>{t('photo.receipt.acts')}</dt>
              <dd>
                <strong>{t('photo.receipt.actsValue', { pct: pct(report.threshold) })}</strong>
                <small>{info.calibrated ? t('photo.receipt.calibrated') : t('photo.receipt.notCalibrated')}</small>
              </dd>
            </div>

            {hex && shaState ? (
              <div className="dxr-wide">
                <dt>{t('photo.receipt.file')}</dt>
                <dd>
                  <span className="dxr-mono" title={hex} data-testid="dxr-sha">
                    SHA-256 {hex.slice(0, 8)}…{hex.slice(-4)}
                  </span>
                  <small className="dxr-sha" data-state={shaState}>
                    {shaState === 'ok' ? <ShieldCheck size={13} aria-hidden /> : shaState === 'mismatch' ? <TriangleAlert size={13} aria-hidden /> : null}
                    {shaState === 'ok' ? t('photo.receipt.sha.ok') : shaState === 'mismatch' ? t('photo.receipt.sha.mismatch') : t('photo.receipt.sha.unchecked')}
                  </small>
                </dd>
              </div>
            ) : null}

            <div className="dxr-wide">
              <dt>{t('photo.receipt.photo')}</dt>
              <dd>{t('photo.receipt.photoValue')}</dd>
            </div>

            <div className="dxr-wide">
              <dt>{t('photo.receipt.id')}</dt>
              <dd>
                <span className="dxr-mono">{report.id}</span>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
