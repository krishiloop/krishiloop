// this page's words (English loads per screen): the home page reuses the story's verified copy
import '../../lib/i18n/strings.story';
import './home.css';
import { SmoothScroll } from '../../ui/kit/SmoothScroll';
import { HomeHero } from './HomeHero';
import { BotsBand, EndBand, FactTicker, ProblemBand, StatusBand } from './Bands';
import { FlowBeams } from './FlowBeams';
import { Bento } from './Bento';
import { PaperBand } from './PaperBand';

/**
 * The front page (/): the idea in one moving picture, then the problem, why chatbots are not enough, the whole system
 * in one diagram, everything that works today, the receipt itself (paper), the honest status and one QR to scan.
 * The receipt-printing demo that used to open this page lives on /receipt.
 */
export default function HomePage() {
  return (
    <>
      <SmoothScroll />
      <HomeHero />
      <FactTicker />
      <ProblemBand />
      <BotsBand />
      <FlowBeams />
      <Bento />
      <PaperBand />
      <StatusBand />
      <EndBand />
    </>
  );
}
