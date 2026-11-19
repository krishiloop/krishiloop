// this page's words (English loads per screen)
import '../../lib/i18n/strings.story';
import '../../lib/i18n/strings.receipt';
import '../story/story.css';
import './receipt.css';
import { Hero } from '../story/Hero';
import { RecallRipple } from '../story/RecallRipple';
import { Walkthrough } from './Walkthrough';

/**
 * How a receipt works (/receipt): a real receipt prints and is stamped, its rule is recalled in place; then the five
 * steps behind it as a walk-through that plays by itself (field data, rule, signed receipt, check, recall); then a
 * recall reaching every receipt that used the rule.
 */
export default function ReceiptPage() {
  return (
    <div className="rc-page botanic-bg">
      <Hero />
      <Walkthrough />
      <RecallRipple />
    </div>
  );
}
