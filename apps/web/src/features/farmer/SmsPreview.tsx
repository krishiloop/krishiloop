import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';
import { receiptCode } from '../../lib/api/client';
import { buildSms, smsInfo } from './sms';

/**
 * What this receipt looks like as an SMS on a basic phone: the decision, the rule, the receipt's short code and the
 * /v/CODE link, with a live counter (160 characters in the GSM alphabet, 70 once the text is Bangla). The code is the
 * server's (services/reach), or the recorded one for a recorded receipt; the server's SMS is a sandbox (written to an
 * outbox, not sent), and the label says so. Loaded with the receipt sheet, only when it opens.
 */
export function SmsPreview({ decision, rule, credentialId, url }: { decision: string; rule: string; credentialId: string; url: string }) {
  const { t, lang } = useI18n();
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setCode(null);
    void receiptCode(credentialId).then((c) => live && setCode(c));
    return () => {
      live = false;
    };
  }, [credentialId]);
  // the short link once there is a code; until then (or with no code at all) the full verify link
  const link = code ? `${window.location.origin}/v/${code}` : url;
  const text = buildSms(t('fa.sms.template'), { decision, rule, code: code ?? '…', url: link });
  const info = smsInfo(text);
  const over = info.segments > 1;
  return (
    <section className="fa-sms" aria-labelledby="fa-sms-title" data-testid="fa-sms">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="fa-sms-title" className="text-sm font-semibold">
          {t('fa.sms.title')}
        </h3>
        <span className="chip chip-carbon">{t('fa.sms.planned')}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-start gap-5">
        <div className="fa-fphone" aria-hidden>
          <div className="fa-fphone-ear" />
          <div className="fa-fphone-screen">
            <p className="fa-fphone-from">KrishiLoop</p>
            <p lang={lang} className="m-0">
              {text}
            </p>
          </div>
          <div className="fa-fphone-pad">
            <span className="fa-fphone-nav" />
            <div className="fa-fphone-keys">
              {Array.from({ length: 12 }, (_, i) => (
                <span key={i} />
              ))}
            </div>
          </div>
        </div>
        <div className="min-w-[10rem] flex-1">
          <p className="eyebrow">{t('fa.sms.text')}</p>
          <p lang={lang} className="mono mt-2 break-words text-[0.8rem] leading-relaxed text-ink" data-testid="fa-sms-text">
            {text}
          </p>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-sm" aria-live="polite">
            <span className={cx('mono text-lg font-semibold', over ? 'text-wait' : 'text-ink')} data-testid="fa-sms-count">
              {fmtNum(info.units, lang)} / {fmtNum(info.limit, lang)}
            </span>
            <span className="text-ink-3">{info.unicode ? t('fa.sms.unicode') : t('fa.sms.gsm')}</span>
            <span className="text-ink-2">{t('fa.sms.parts', { n: fmtNum(info.segments, lang) })}</span>
          </p>
        </div>
      </div>
    </section>
  );
}
