import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Download, MessageSquareText, Printer, Share2, ShieldCheck, Square, Volume2 } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { pickText, shortId } from '../../lib/format';
import { verifyUrl } from '../../lib/qr';
import { verifyReceipt, isMySandboxCredential, type VerifyOutcome } from '../../lib/api/client';
import type { Receipt } from '../../lib/api/types';
import { cx } from '../../lib/cx';
import { Sheet } from '../../ui/Sheet';
import { ReceiptCard } from '../../ui/Receipt';
import { DataMark } from '../../ui/DataMark';
import type { StampKind } from '../../ui/Stamp';
import { toast } from '../../ui/Toast';
import { RECORDED_AT } from '../../data/recorded';
import { logVerify } from './inspector';
import { setStatus, statusOf } from './receipts';
import { tick } from './checklist';
import { readAloud, stopReading, type ReadResult } from './voice';
import { SmsPreview } from './SmsPreview';

export interface ReceiptRef {
  receipt: Receipt;
  credentialId?: string;
  recorded: boolean;
}

/** How long the paper takes to print (ui.css .print-in) before the stamp may land on it. */
const PRINT_MS = 950;

/**
 * The receipt as a sheet: it prints out of a slot, then the verifier's verdict lands on it as a stamp (AUTHENTIC, or
 * RECALLED after a recall). Then what a farmer can do with it: hear it, share it, print it, keep the signed JSON, open the
 * public verifier, or see what it would look like as an SMS (a preview: SMS sending is planned).
 */
export function ReceiptSheet({ value, onClose, onToday }: { value: ReceiptRef | null; onClose: () => void; onToday: () => void }) {
  const { t } = useI18n();
  const rule = value?.receipt.rule_refs[0];
  return (
    <Sheet
      open={!!value}
      onClose={onClose}
      title={t('ui.receipt.header')}
      subtitle={rule ? `${rule.rule_id} v${rule.version} · ${t(`ui.review.${rule.review_level}`)}` : undefined}
      className="fa-sheet"
    >
      {value && (
        <ReceiptBody
          key={value.credentialId ?? value.receipt.receipt_id}
          value={value}
          onToday={() => {
            onClose();
            onToday();
          }}
        />
      )}
    </Sheet>
  );
}

function ReceiptBody({ value, onToday }: { value: ReceiptRef; onToday: () => void }) {
  const { t, lang } = useI18n();
  const { receipt, credentialId, recorded } = value;
  const [verdict, setVerdict] = useState<VerifyOutcome | null>(null);
  const [delay, setDelay] = useState(PRINT_MS);
  const [reading, setReading] = useState<ReadResult | 'idle'>('idle');
  const [sms, setSms] = useState(false);
  const [printing, setPrinting] = useState(false);
  const opened = useRef(performance.now());

  const advice = receipt.advice;
  const title = pickText(advice?.title, lang);
  const decisionWord = advice?.decision ? t(`ui.decision.${advice.decision}`) : t(`ui.kind.${advice?.kind ?? 'other'}`);
  const rule = receipt.rule_refs[0];
  const ruleLabel = rule ? `${rule.rule_id} v${rule.version}` : '';

  useEffect(() => {
    tick('receipt');
    if (!credentialId) return;
    let alive = true;
    verifyReceipt(credentialId)
      .catch((e: unknown): VerifyOutcome => ({ status: 'unreachable', reason: e instanceof Error ? e.message : String(e), source: 'none' }))
      .then((r) => {
        if (!alive) return;
        setDelay(Math.max(0, PRINT_MS - (performance.now() - opened.current)));
        setVerdict(r);
        logVerify(credentialId, r);
        setStatus(credentialId, statusOf(r));
      });
    return () => {
      alive = false;
      stopReading();
    };
  }, [credentialId]);

  // print only the receipt: a clean copy outside the dialog, the rest of the page hidden by the print stylesheet
  useEffect(() => {
    if (!printing) return;
    const html = document.documentElement;
    html.classList.add('fa-printing');
    const done = () => {
      html.classList.remove('fa-printing');
      setPrinting(false);
    };
    window.addEventListener('afterprint', done, { once: true });
    const raf = requestAnimationFrame(() => {
      window.print();
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('afterprint', done);
      html.classList.remove('fa-printing');
    };
  }, [printing]);

  const status: StampKind | null = !verdict || verdict.status === 'unreachable' ? null : verdict.status;
  const credential = verdict && verdict.status !== 'unreachable' ? verdict.credential : undefined;
  const url = credentialId ? verifyUrl(credentialId) : '';
  const mark = recorded ? <DataMark kind="recorded" date={RECORDED_AT} /> : undefined;

  const read = async () => {
    if (reading === 'speaking') {
      stopReading();
      setReading('idle');
      return;
    }
    const r = await readAloud(`${decisionWord}. ${title.text}`, title.lang, () => setReading('idle'));
    setReading(r);
  };

  const share = async () => {
    if (!url) return;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: 'KrishiLoop', text: `${decisionWord}: ${title.text}`, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(t('fa.rc.copied'));
    } catch {
      toast(t('fa.rc.copyFail'), { tone: 'info' });
    }
  };

  const download = () => {
    if (!credential || !credentialId) return;
    const blob = new Blob([JSON.stringify(credential, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `krishiloop-receipt-${shortId(credentialId, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
    toast(t('fa.rc.saved'));
  };

  const sandboxMine = !!verdict && verdict.status !== 'unreachable' && !!verdict.sandbox && isMySandboxCredential(verdict.status_list);

  return (
    <div className="pb-4">
      <div className="relative mx-auto max-w-[460px]">
        <div className="fa-slot" aria-hidden />
        <div className="relative -mt-1.5">
          <ReceiptCard
            receipt={receipt}
            credentialId={credentialId}
            status={status}
            stampKey={status ?? 'none'}
            struck={status === 'recalled'}
            print
            stampDelay={delay}
            mark={mark}
          />
        </div>
      </div>

      <div className="mx-auto mt-2 max-w-[460px]" aria-live="polite" data-testid="fa-rc-verdict">
        {!credentialId ? null : !verdict ? (
          <p className="text-sm text-ink-3">{t('fa.rc.checking')}</p>
        ) : verdict.status === 'unreachable' ? (
          <p className="text-sm text-ink-2">{t('fa.rc.unreachable')}</p>
        ) : verdict.status === 'authentic' ? (
          <p className="text-sm text-ink-2">
            <span className="font-semibold text-go">{t('ui.stamp.authentic')}.</span> {t('fa.rc.authentic')}
            {verdict.expired && <span className="block text-ink-3">{t('fa.rc.expired')}</span>}
          </p>
        ) : verdict.status === 'recalled' ? (
          <div className="fa-whatnow" data-testid="fa-rc-recalled">
            <p className="text-sm">
              <span className="font-semibold text-stop">{t('ui.stamp.recalled')}.</span> {t('fa.rc.recalled', { rules: (verdict.rules ?? [ruleLabel]).join(', ') })}
            </p>
            <p className="mt-2 text-sm text-ink-2">
              <span className="font-semibold text-ink">{t('fa.rc.nowTitle')}</span> {t('fa.rc.now')}
            </p>
            <button type="button" className="btn btn-secondary fa-hit mt-3" onClick={onToday}>
              {t('fa.rc.openToday')}
            </button>
          </div>
        ) : (
          <p className="text-sm text-ink-2">{t('fa.rc.invalid')}</p>
        )}
      </div>

      <div className="mx-auto mt-5 grid max-w-[460px] grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label={t('fa.rc.actions')}>
        <button type="button" className="btn btn-secondary fa-act" onClick={() => void read()} aria-pressed={reading === 'speaking'} data-testid="fa-rc-read">
          {reading === 'speaking' ? <Square size={17} aria-hidden /> : <Volume2 size={18} aria-hidden />}
          {reading === 'speaking' ? t('fa.rc.stop') : t('fa.rc.read')}
        </button>
        <button type="button" className="btn btn-secondary fa-act" onClick={() => void share()} disabled={!url}>
          <Share2 size={18} aria-hidden />
          {t('fa.rc.share')}
        </button>
        <button type="button" className="btn btn-secondary fa-act" onClick={() => setPrinting(true)} data-testid="fa-rc-print">
          <Printer size={18} aria-hidden />
          {t('fa.rc.print')}
        </button>
        <button type="button" className="btn btn-secondary fa-act" onClick={download} disabled={!credential} data-testid="fa-rc-json">
          <Download size={18} aria-hidden />
          {t('fa.rc.json')}
        </button>
        {credentialId ? (
          <Link to={`/verify/${encodeURIComponent(credentialId.replace(/^urn:uuid:/, ''))}`} className="btn btn-secondary fa-act" onClick={() => tick('verify')} data-testid="fa-rc-verify">
            <ShieldCheck size={18} aria-hidden />
            {t('fa.rc.verify')}
          </Link>
        ) : (
          <span />
        )}
        <button type="button" className={cx('btn fa-act', sms ? 'btn-primary' : 'btn-secondary')} onClick={() => setSms((s) => !s)} aria-expanded={sms} aria-controls="fa-sms-panel" disabled={!credentialId} data-testid="fa-rc-sms">
          <MessageSquareText size={18} aria-hidden />
          {t('fa.rc.sms')}
        </button>
      </div>

      <p className="mx-auto mt-3 max-w-[460px] text-sm text-ink-2" aria-live="polite" data-testid="fa-rc-voice">
        {reading === 'no-voice' ? t('fa.voice.noVoice', { lang: title.lang === 'bn' ? 'বাংলা' : title.lang.toUpperCase() }) : reading === 'unsupported' ? t('fa.voice.noTts') : ''}
      </p>

      <div id="fa-sms-panel" className="mx-auto max-w-[460px]">
        {sms && credentialId && <SmsPreview decision={decisionWord} rule={ruleLabel} credentialId={credentialId} url={url} />}
      </div>

      {sandboxMine && <p className="mx-auto mt-5 max-w-[460px] text-xs text-ink-3">{t('fa.rc.sandbox')}</p>}

      {printing &&
        createPortal(
          <div className="fa-print-root">
            <ReceiptCard receipt={receipt} credentialId={credentialId} status={status} struck={status === 'recalled'} mark={mark} />
          </div>,
          document.body,
        )}
    </div>
  );
}
