import { ProductIndex } from './ProductIndex';
import { MapTeaser } from '../map/MapTeaser';
import { TryTeaser } from '../try/TryTeaser';
import { WhyBand } from './WhyBand';
import { FlowBeams } from './FlowBeams';
import { BotsBand, EndBand, StatusBand } from './Bands';
import { Bento } from './Bento';
import { PaperBand } from './PaperBand';
import { PhoneBand } from './PhoneBand';
import { TeamStrip } from '../about/TeamCards';

/**
 * Everything below the first screen, in its own chunk: the merged product (with its sticky index), who it is for, the
 * system diagram, why chatbots are not enough, what we measured, the receipt itself, the honest status and the QR.
 * v5 (builder Ho): "Use it on your phone" (QR and copy link to /m) after the tools, and the team strip before the end.
 * HomePage mounts it when the visitor comes near it, interacts, or the browser goes idle after load, so the first screen
 * paints without this work (or the animation library some of these sections use).
 */
export default function HomeRest() {
  return (
    <>
      <ProductIndex />
      <MapTeaser />
      <TryTeaser />
      <PhoneBand />
      <WhyBand />
      <FlowBeams />
      <BotsBand />
      <Bento />
      <PaperBand />
      <StatusBand />
      <TeamStrip />
      <EndBand />
    </>
  );
}
