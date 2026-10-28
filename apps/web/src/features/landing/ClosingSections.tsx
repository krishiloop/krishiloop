import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Circle, Globe2, Inbox, QrCode } from 'lucide-react';
import { Reveal } from '../../components/ui/Reveal';
import { PreviewBadge } from '../../components/ui/Badges';
import { PackLine } from '../farmer/PackLine';
import { LANGS, setLang, useI18n, type Key } from '../../lib/i18n';
import { useIsLite } from '../../lib/device';
import { useMotionReduced } from '../../lib/motionPref';
import { cx } from '../../lib/cx';

const MeshBackdrop = lazy(() => import('../verify/MeshBackdrop'));

/** Any crop, any language: the same engine, a second country, and the language switch for the whole site (W9). */
export function World() {
  const { t, lang } = useI18n();
  return (
    <section id="world" className="story-section">
      <div className="story-wrap">
        <Reveal>
          <p className="eyebrow">{t('l.world.eyebrow')}</p>
          <h2 className="display story-title">{t('l.world.title')}</h2>
          <p className="mt-4 max-w-[62ch] text-lg text-chrome">{t('l.world.body')}</p>
        </Reveal>

        <div className="world-grid">
          <Reveal className="pack surface" delay={0}>
            <p className="pack-flag" aria-hidden>
              BD
            </p>
            <h3 className="text-lg font-semibold tracking-tight">{t('l.world.pack1')}</h3>
            <p className="m-0 mt-2 text-chrome">{t('l.world.pack1.body')}</p>
            <span className="chip mt-4" data-status="planned">
              <Circle size={10} aria-hidden /> {t('l.status.planned')}
            </span>
          </Reveal>
          <Reveal className="pack surface" delay={80}>
            <p className="pack-flag" aria-hidden>
              KE
            </p>
            <h3 className="text-lg font-semibold tracking-tight">{t('l.world.pack2')}</h3>
            <p className="m-0 mt-2 text-chrome">{t('l.world.pack2.body')}</p>
            <PackLine crop="potato" className="pack-line mt-3" />
            <span className="chip mt-4" data-status="implemented">
              <Check size={12} strokeWidth={3} aria-hidden /> {t('l.status.implemented')}
            </span>
          </Reveal>
        </div>

        <Reveal delay={120}>
          <p className="eyebrow mt-10 flex items-center gap-2">
            <Globe2 size={14} aria-hidden /> {t('l.world.langs')}
          </p>
          <div className="lang-pills" role="group" aria-label={t('lang.label')}>
            {LANGS.map((l) => (
              <button key={l.code} type="button" className={cx('lang-pill', lang === l.code && 'is-active')} aria-pressed={lang === l.code} onClick={() => void setLang(l.code)} lang={l.code} data-testid={`lang-${l.code}`}>
                {l.native}
                {l.preview ? <PreviewBadge /> : null}
              </button>
            ))}
          </div>
          <p className="m-0 mt-3 text-sm text-dim">{t('l.world.diff')}</p>
        </Reveal>
      </div>
    </section>
  );
}

const STATUS_DONE = [
  { k: 'l.state.d1', to: '/verify/534d504c-0000-4000-8000-000000000001' },
  { k: 'l.state.d2', to: '/verify' },
  { k: 'l.state.d3', to: '/verify/534d504c-0000-4000-8000-000000000001' },
  { k: 'l.state.d4', to: '/app' },
  { k: 'l.state.d5' },
  { k: 'l.state.d6', to: '/app' },
  { k: 'l.state.d7', to: '/officer' },
  { k: 'l.state.d8', to: '/app#photo' },
] as const satisfies readonly { k: Key; to?: string }[];
const STATUS_TODO: Key[] = ['l.state.p1', 'l.state.p2', 'l.state.p3', 'l.state.p4', 'l.state.p5', 'l.state.p6', 'l.state.p7', 'l.state.p8', 'l.state.p9', 'l.state.p10'];

/** Every control marked implemented (with a link where there is one) or planned: the rule of the repo, shown to judges. */
export function StatusBoard() {
  const { t } = useI18n();
  return (
    <section id="status" className="story-section">
      <div className="story-wrap">
        <Reveal>
          <p className="eyebrow">{t('l.state.eyebrow')}</p>
          <h2 className="display story-title">{t('l.state.title')}</h2>
        </Reveal>
        <div className="status-grid">
          <Reveal className="surface surface-pad" delay={0}>
            <h3 className="status-h">
              <Check size={16} strokeWidth={3} aria-hidden /> {t('l.state.done')}
            </h3>
            <ul className="status-list" data-testid="status-done">
              {STATUS_DONE.map((s) => (
                <li key={s.k}>
                  <Check size={14} strokeWidth={3} className="text-go" aria-hidden />
                  {'to' in s ? (
                    <Link to={s.to} className="link">
                      {t(s.k)}
                    </Link>
                  ) : (
                    <span>{t(s.k)}</span>
                  )}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal className="surface surface-pad" delay={80}>
            <h3 className="status-h">
              <Circle size={14} aria-hidden /> {t('l.state.todo')}
            </h3>
            <ul className="status-list" data-testid="status-todo">
              {STATUS_TODO.map((k) => (
                <li key={k}>
                  <Circle size={12} className="text-dim" aria-hidden />
                  <span>{t(k)}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function Closing() {
  const { t } = useI18n();
  const lite = useIsLite();
  const reduced = useMotionReduced();
  return (
    <section id="start" className="closing" data-theme="dark">
      <div className="closing-bg" aria-hidden>
        {!lite ? (
          <Suspense fallback={null}>
            <MeshBackdrop colors={['#0b2417', '#1f6f46', '#08130d', '#3a2a0a', '#7a5a14']} speed={reduced ? 0 : 0.1} />
          </Suspense>
        ) : null}
        <div className="closing-veil" />
      </div>
      <div className="story-wrap closing-inner">
        <Reveal>
          <h2 className="display closing-title">{t('l.close.title')}</h2>
          <p className="mx-auto mt-5 max-w-[48ch] text-lg text-[#d8d6cb]">{t('l.close.body')}</p>
          <div className="closing-cta">
            <Link to="/app" className="btn btn-sun">
              {t('l.close.cta.app')} <ArrowRight size={17} aria-hidden />
            </Link>
            <Link to="/verify" className="btn btn-ghost hero-ghost">
              <QrCode size={17} aria-hidden /> {t('l.close.cta.verify')}
            </Link>
            <Link to="/officer" className="btn btn-ghost hero-ghost">
              <Inbox size={17} aria-hidden /> {t('l.close.cta.officer')}
            </Link>
          </div>
          <p className="closing-credit">{t('l.close.credit')}</p>
        </Reveal>
      </div>
    </section>
  );
}
