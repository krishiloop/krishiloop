import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link2, MessageSquareText, ScanLine, Sparkles } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import { codePath, displayCode, normalizeCode } from '../verify/code';
import { looksLikeReceipt, normalizeId, verifyPath } from '../verify/verifyUtil';

/** The SMS code of a RECORDED receipt (services/reach, recorded 2 Nov 2026): R-BDR-002 v1, rice at tillering. */
const RECORDED_CODE = '3MZX-W8Y9';

/**
 * "Check a receipt": what a farmer or buyer types (an SMS code like 7KQ2-MX4P, or a receipt link) is read with the
 * verifier's own rules (features/verify/code.ts normalizeCode, verifyUtil.ts normalizeId) and opened in the verifier,
 * which checks the signature in the browser.
 */
export function ReceiptTool() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [v, setV] = useState('');
  const id = useId();
  const help = useId();
  const code = normalizeCode(v);
  const link = !code && looksLikeReceipt(v) ? normalizeId(v) : '';
  const target = code ? codePath(code) : link ? verifyPath(link) : '';
  const open = (e?: FormEvent) => {
    e?.preventDefault();
    if (target) nav(target);
  };
  return (
    <form className="try-rc" onSubmit={open} data-testid="receipt-form">
      <label htmlFor={id} className="try-slider-label">
        {t('try.rc.label')}
      </label>
      <div className="try-rc-row">
        <input
          id={id}
          className="try-input mono"
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder={t('try.rc.placeholder')}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-describedby={help}
          data-testid="receipt-input"
        />
        <button type="submit" className="btn btn-primary try-rc-open" disabled={!target} data-testid="receipt-open">
          <ScanLine size={16} aria-hidden /> {t('try.rc.open')}
        </button>
      </div>
      <p id={help} className={cx('try-rc-state', target && 'is-ok')} aria-live="polite" data-testid="receipt-state">
        {code ? (
          <>
            <MessageSquareText size={15} aria-hidden /> {t('try.rc.isCode', { code: displayCode(code) })}
          </>
        ) : link ? (
          <>
            <Link2 size={15} aria-hidden /> {t('try.rc.isLink')}
          </>
        ) : v.trim() ? (
          t('try.rc.notYet')
        ) : (
          t('try.rc.how')
        )}
      </p>
      <div className="try-rc-sample">
        <button type="button" className="try-chipbtn" onClick={() => setV(RECORDED_CODE)} data-testid="receipt-sample">
          <Sparkles size={14} aria-hidden /> {t('try.rc.sample')}
        </button>
        <p className="text-sm text-ink-2">{t('try.rc.sampleNote')}</p>
      </div>
    </form>
  );
}
