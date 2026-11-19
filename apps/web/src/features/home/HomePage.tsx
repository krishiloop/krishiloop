// this page's words (English loads per screen): the home page reuses the story's verified copy
import '../../lib/i18n/strings.story';
import './home.css';
import { lazy, Suspense } from 'react';
import { SmoothScroll } from '../../ui/kit/SmoothScroll';
import { HomeHero } from './HomeHero';
import { BotsBand, EndBand, StatusBand } from './Bands';
import { WhyBand } from './WhyBand';
// below the first screen: its own chunk, fetched right after the hero (the first visit stays inside the size ceiling)
const ProductIndex = lazy(() => import('./ProductIndex').then((m) => ({ default: m.ProductIndex })));
import { FlowBeams } from './FlowBeams';
import { Bento } from './Bento';
import { PaperBand } from './PaperBand';

/**
 * The front page (/), after the owner's KrishiGuard AI deck: a forest hero (the promise, three problems, the app at work);
 * the merged product as a magazine with a sticky index, in the deck's order (Crop Guardian, the Climate Shield, the
 * village disease radar, precision savings, Bangla voice and basic phones, the officer, and only then trust: the receipt
 * and recall); who it is for (verified facts only); the whole system in one diagram; why chatbots are not enough; what
 * we measured; the receipt itself (paper); the honest status; one QR to scan.
 */
export default function HomePage() {
  return (
    <>
      <SmoothScroll />
      <HomeHero />
      <Suspense fallback={<div className="wrap section" aria-hidden><div className="skeleton h-[1400px] w-full rounded-[22px]" /></div>}>
        <ProductIndex />
      </Suspense>
      <WhyBand />
      <FlowBeams />
      <BotsBand />
      <Bento />
      <PaperBand />
      <StatusBand />
      <EndBand />
    </>
  );
}
