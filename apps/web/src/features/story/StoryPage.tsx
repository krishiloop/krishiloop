import './story.css';
import { Hero } from './Hero';
import { ProofStrip, Problem } from './Numbers';
import { Chatbots } from './Chatbots';
import { Loop } from './Loop';
import { RecallRipple } from './RecallRipple';
import { Features } from './Features';
import { TrustMini } from './TrustMini';
import { Engine, EndCta, Hood, Status } from './Closing';

/**
 * The story (/): one idea per section, each carried by a real artifact, not paragraphs (DESIGN.md;
 * docs/prompt-library/frontend-redesign-brief.md). Order: the idea → what runs → the problem → why (chatbots) → how
 * (the loop) → the innovation (recall) → everything to try → earned trust → global → under the hood → status → scan.
 */
export default function StoryPage() {
  return (
    <>
      <Hero />
      <ProofStrip />
      <Problem />
      <Chatbots />
      <Loop />
      <RecallRipple />
      <Features />
      <TrustMini />
      <Engine />
      <Hood />
      <Status />
      <EndCta />
    </>
  );
}
