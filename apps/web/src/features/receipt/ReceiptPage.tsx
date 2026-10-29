// this page's words (English loads per screen)
import '../../lib/i18n/strings.story';
import '../story/story.css';
import { Hero } from '../story/Hero';
import { Loop } from '../story/Loop';
import { RecallRipple } from '../story/RecallRipple';

/**
 * How a receipt works (/receipt): a real receipt prints and is stamped, its rule is recalled in place, the five-step
 * loop behind it, and a recall reaching every receipt that used the rule. Moved here from the front page.
 */
export default function ReceiptPage() {
  return (
    <>
      <Hero />
      <Loop />
      <RecallRipple />
    </>
  );
}
