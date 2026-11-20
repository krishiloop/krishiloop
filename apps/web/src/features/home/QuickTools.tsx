import { Link } from 'react-router-dom';
import { Camera, CloudRain, Headset, Map, MapPin, MessageCircle, ScanLine, Smartphone, SprayCan, Wallet, type LucideIcon } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import '../../lib/i18n/strings.quicktools';
import './quickTools.css';

/**
 * "Everything you can do", right under the hero (owner, 20 Nov: "the ways you have hidden some features, even I have a
 * hard time finding them ... you think farmers will?"). Every feature, one tap away, each with its own colour and a
 * plain verb: no feature lives only inside another page any more.
 */
const TOOLS: { to: string; icon: LucideIcon; title: Key; sub: Key; tone: string; tid: string }[] = [
  { to: '/app?tab=photo', icon: Camera, title: 'qt.photo', sub: 'qt.photo.sub', tone: 'moss', tid: 'photo' },
  { to: '/krishi-officer', icon: MapPin, title: 'qt.officer', sub: 'qt.officer.sub', tone: 'terracotta', tid: 'officer' },
  { to: '/m', icon: Smartphone, title: 'qt.phone', sub: 'qt.phone.sub', tone: 'lotus', tid: 'phone' },
  { to: '/app?tab=ask', icon: MessageCircle, title: 'qt.ask', sub: 'qt.ask.sub', tone: 'hyacinth', tid: 'ask' },
  { to: '/try#weather', icon: CloudRain, title: 'qt.weather', sub: 'qt.weather.sub', tone: 'monsoon', tid: 'weather' },
  { to: '/map', icon: Map, title: 'qt.map', sub: 'qt.map.sub', tone: 'terracotta', tid: 'map' },
  { to: '/try#spray', icon: SprayCan, title: 'qt.spray', sub: 'qt.spray.sub', tone: 'moss', tid: 'spray' },
  { to: '/try#savings', icon: Wallet, title: 'qt.save', sub: 'qt.save.sub', tone: 'lotus', tid: 'save' },
  { to: '/verify', icon: ScanLine, title: 'qt.verify', sub: 'qt.verify.sub', tone: 'monsoon', tid: 'verify' },
  { to: '/officer', icon: Headset, title: 'qt.desk', sub: 'qt.desk.sub', tone: 'hyacinth', tid: 'desk' },
];

export function QuickTools() {
  const { t } = useI18n();
  return (
    <section className="qt wrap" aria-labelledby="qt-title" data-testid="quick-tools">
      <h2 id="qt-title" className="qt-title">
        {t('qt.title')}
      </h2>
      <ul className="qt-grid">
        {TOOLS.map(({ to, icon: Icon, title, sub, tone, tid }) => (
          <li key={tid}>
            <Link to={to} className="qt-item press" data-tone={tone} data-testid={`qt-${tid}`}>
              <span className="qt-icon" aria-hidden>
                <Icon size={22} strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span className="qt-name">{t(title)}</span>
                <span className="qt-sub">{t(sub)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
