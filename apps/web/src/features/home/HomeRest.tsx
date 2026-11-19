import { ProductIndex } from './ProductIndex';
import { WhyBand } from './WhyBand';
import { FlowBeams } from './FlowBeams';
import { BotsBand, EndBand, StatusBand } from './Bands';
import { Bento } from './Bento';
import { PaperBand } from './PaperBand';

/**
 * Everything below the first screen, in its own chunk: the merged product (with its sticky index), who it is for, the
 * system diagram, why chatbots are not enough, what we measured, the receipt itself, the honest status and the QR.
 * HomePage mounts it when the visitor comes near it, interacts, or the browser goes idle after load, so the first screen
 * paints without this work (or the animation library some of these sections use).
 */
export default function HomeRest() {
  return (
    <>
      <ProductIndex />
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
