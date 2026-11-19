import '../../lib/i18n/strings.about';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import { photoSet, ROLE, TEAM, type Member } from './team';
import './team.css';

/** the member's name in the page's language (the Bangla spelling when the page is in Bangla) */
const nameOf = (m: Member, lang: string) => (lang === 'bn' ? m.nameBn : m.name);

/**
 * The team as portrait cards (builder Ho, v5): each person in an arched frame on their own pastel, their name and
 * their roles exactly as the team gave them. A loose collage on wide screens (every other card sits lower), two
 * columns on phones with the team lead first and wide. The cards lean a little toward a desktop mouse (data-tilt).
 * The photo's alt text is the person's name.
 */
export function TeamCards({ className }: { className?: string }) {
  const { t, lang } = useI18n();
  return (
    <ul className={cx('tm-grid m-0 list-none p-0', className)} data-stagger data-testid="team-cards">
      {TEAM.map((m) => {
        const name = nameOf(m, lang);
        return (
          <li key={m.photo} className="tm-item">
            <article className="tm-card" data-tone={m.tone} data-tilt="4">
              <div className="tm-photo">
                <img
                  src={`/team/${m.photo}-400.webp`}
                  srcSet={photoSet(m)}
                  sizes="(min-width: 1024px) 240px, (min-width: 640px) 30vw, 44vw"
                  width={400}
                  height={500}
                  alt={name}
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className="tm-body">
                <h3 className="tm-name">{name}</h3>
                {lang === 'bn' && (
                  <p className="tm-latin" lang="en">
                    {m.name}
                  </p>
                )}
                <ul className="tm-roles m-0 list-none p-0">
                  {m.roles.map((r) => (
                    <li key={r}>{t(ROLE[r])}</li>
                  ))}
                </ul>
                {m.links && m.links.length > 0 && (
                  <p className="tm-links m-0">
                    {m.links.map((l) => (
                      <a key={l.href} href={l.href} target="_blank" rel="noreferrer">
                        {l.label}
                        <ArrowUpRight size={13} aria-hidden />
                      </a>
                    ))}
                  </p>
                )}
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The home page's team strip: five small arched portraits with names and first roles, and a link to the full team on
 * /about. Lives in the lazy part of the home page.
 */
export function TeamStrip() {
  const { t, lang } = useI18n();
  return (
    <section className="section tm-strip botanic-bg botanic-bg--cereal" aria-labelledby="team-strip-title" data-testid="team-strip">
      <div className="wrap tm-strip-grid">
        <header>
          <p className="label m-0 flex items-center gap-2.5" data-reveal>
            <span className="h-px w-8 bg-ink-3" aria-hidden />
            {t('about.team.eyebrow')}
          </p>
          <h2 id="team-strip-title" className="t-title m-0 mt-5" data-reveal style={{ ['--i' as string]: 1 }}>
            {t('about.team.strip')}
          </h2>
          <Link to="/about#team" className="tm-meet" data-reveal style={{ ['--i' as string]: 2 }}>
            {t('about.team.meet')}
            <ArrowUpRight size={16} aria-hidden />
          </Link>
        </header>
        <ul className="tm-faces m-0 list-none p-0" data-stagger>
          {TEAM.map((m) => (
            <li key={m.photo} className="tm-face" data-tone={m.tone}>
              <span className="tm-face-photo">
                <img src={`/team/${m.photo}-400.webp`} width={400} height={500} alt={nameOf(m, lang)} loading="lazy" decoding="async" />
              </span>
              <span className="tm-face-name">{nameOf(m, lang)}</span>
              <span className="tm-face-role">{t(ROLE[m.roles[0]!])}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
