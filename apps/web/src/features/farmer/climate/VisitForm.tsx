import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarCheck, Check, Phone, Send } from 'lucide-react';
import { useI18n, type Key } from '../../../lib/i18n';
import { fmtDate, fmtNum } from '../../../lib/format';
import { cx } from '../../../lib/cx';
import { DataMark } from '../../../ui/DataMark';
import { maskPhone, normalisePhone, requestVisit } from './api';
import type { VisitBooking, VisitResult } from './types';

const SLOTS = ['morning', 'afternoon', 'evening'] as const;
const MODES = ['visit', 'call'] as const;
const NOTE_MAX = 280;

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Today and the next 14 days (the server accepts exactly this window). */
export function bookingDays(from = new Date()): string[] {
  return Array.from({ length: 15 }, (_, i) => isoDay(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)));
}

/**
 * "Ask an officer to visit or call": visit or call, a day in the next 14, a time of day, an optional phone (kept
 * masked) and a short note, then a confirmation. Live: an officer-inbox case in this session's sandbox. Recorded mode:
 * kept in this browser's officer inbox and the confirmation says it was not sent.
 */
export function VisitForm({ fieldId, profileId, farmerLabel, onDone }: { fieldId: string; profileId: string; farmerLabel: string; onDone: () => void }) {
  const { t, lang } = useI18n();
  const days = useMemo(() => bookingDays(), []);
  const [mode, setMode] = useState<(typeof MODES)[number]>('visit');
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<(typeof SLOTS)[number] | null>(null);
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<VisitResult | null>(null);
  const ids = { phone: useId(), phoneHint: useId(), note: useId(), noteLeft: useId(), date: useId(), slot: useId(), mode: useId() };
  const doneRef = useRef<HTMLDivElement>(null);

  const p = normalisePhone(phone);
  const phoneErr = !p.ok ? t('fa.visit.phoneBad') : mode === 'call' && !p.phone ? t('fa.visit.phoneNeeded') : null;
  const missing = !date ? t('fa.visit.pickDate') : !slot ? t('fa.visit.pickSlot') : phoneErr;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (missing || !date || !slot || busy) return;
    setBusy(true);
    setErr(null);
    const booking: VisitBooking = { field_id: fieldId, profile_id: profileId, date, slot, mode, phone: p.phone || null, note: note.trim().slice(0, NOTE_MAX), lang };
    try {
      const r = await requestVisit(booking, farmerLabel);
      setDone(r);
      requestAnimationFrame(() => doneRef.current?.focus());
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div ref={doneRef} tabIndex={-1} className="kg-visit-done" role="status" data-testid="kg-visit-done">
        <span className="kg-visit-tick" aria-hidden>
          <Check size={30} strokeWidth={2.4} />
        </span>
        <h3 className="kg-visit-done-title">{done.mode === 'live' ? t('fa.visit.done') : t('fa.visit.doneLocal')}</h3>
        {done.mode === 'sample' && <p className="text-sm text-ink-2">{t('fa.visit.doneLocalSub')}</p>}
        <dl className="kg-visit-dl">
          <dt>{t('fa.visit.case')}</dt>
          <dd className="mono break-all" data-testid="kg-visit-case">
            {done.item_id}
          </dd>
          <dt>{t('fa.visit.when')}</dt>
          <dd>
            {fmtDate(done.requested_date, lang, 'long')} · {t(`fa.visit.s.${done.slot}` as Key)}
          </dd>
          <dt>{t('fa.visit.how')}</dt>
          <dd>{t(`fa.visit.m.${mode}`)}</dd>
          <dt>{t('fa.visit.phoneSaved')}</dt>
          <dd className="mono">{done.phone_masked ?? t('fa.visit.noPhone')}</dd>
        </dl>
        <p className="kg-hint">
          {done.mode === 'sample' ? <DataMark kind="recorded" className="mr-2" /> : null}
          {t('fa.visit.nobody')}
        </p>
        <button type="button" className="btn btn-primary w-full" onClick={onDone}>
          {t('fa.visit.close')}
        </button>
      </div>
    );
  }

  return (
    <form className="kg-visit" onSubmit={(e) => void submit(e)} noValidate data-testid="kg-visit-form">
      <fieldset className="kg-fieldset">
        <legend className="kg-legend">{t('fa.visit.mode')}</legend>
        <div className="kg-choices kg-choices-2">
          {MODES.map((m) => (
            <label key={m} className={cx('kg-choice', mode === m && 'is-on')}>
              <input type="radio" name={ids.mode} value={m} checked={mode === m} onChange={() => setMode(m)} data-testid={`kg-visit-mode-${m}`} />
              {m === 'visit' ? <CalendarCheck size={18} aria-hidden /> : <Phone size={18} aria-hidden />}
              <span>{t(`fa.visit.m.${m}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="kg-fieldset" aria-describedby={tried && !date ? ids.date : undefined}>
        <legend className="kg-legend">{t('fa.visit.date')}</legend>
        <div className="kg-days">
          {days.map((d, i) => (
            <label key={d} className={cx('kg-day', date === d && 'is-on')} title={fmtDate(d, lang, 'long')}>
              <input type="radio" name={ids.date + 'r'} value={d} checked={date === d} onChange={() => setDate(d)} aria-label={i === 0 ? `${t('fa.visit.today')}, ${fmtDate(d, lang, 'long')}` : fmtDate(d, lang, 'long')} data-testid={`kg-day-${i}`} />
              <span className="kg-day-wd" aria-hidden>
                {i === 0 ? t('fa.visit.today') : fmtDate(d, lang, 'weekday')}
              </span>
              <span className="kg-day-n" aria-hidden>
                {fmtDate(d, lang, 'dayNum')}
              </span>
            </label>
          ))}
        </div>
        {tried && !date && (
          <p id={ids.date} className="kg-err">
            {t('fa.visit.pickDate')}
          </p>
        )}
      </fieldset>

      <fieldset className="kg-fieldset">
        <legend className="kg-legend">{t('fa.visit.slot')}</legend>
        <div className="kg-choices kg-choices-3">
          {SLOTS.map((s) => (
            <label key={s} className={cx('kg-choice', slot === s && 'is-on')}>
              <input type="radio" name={ids.slot} value={s} checked={slot === s} onChange={() => setSlot(s)} data-testid={`kg-slot-${s}`} />
              <span>{t(`fa.visit.s.${s}`)}</span>
            </label>
          ))}
        </div>
        {tried && date && !slot && <p className="kg-err">{t('fa.visit.pickSlot')}</p>}
      </fieldset>

      <div className="kg-fieldset">
        <label htmlFor={ids.phone} className="kg-label">
          {mode === 'call' ? t('fa.visit.phoneCall') : t('fa.visit.phone')}
        </label>
        <input
          id={ids.phone}
          className="kg-input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-describedby={ids.phoneHint}
          aria-invalid={tried && !!phoneErr}
          placeholder="+8801…"
          data-testid="kg-visit-phone"
        />
        <p id={ids.phoneHint} className={cx('kg-hint', tried && phoneErr && 'kg-err')}>
          {tried && phoneErr ? phoneErr : t('fa.visit.phoneHint', { example: maskPhone('+8801712345678') })}
        </p>
      </div>

      <div className="kg-fieldset">
        <label htmlFor={ids.note} className="kg-label">
          {t('fa.visit.note')}
        </label>
        <textarea id={ids.note} className="kg-input kg-textarea" rows={3} maxLength={NOTE_MAX} value={note} placeholder={t('fa.visit.notePh')} onChange={(e) => setNote(e.target.value)} aria-describedby={ids.noteLeft} data-testid="kg-visit-note" />
        <p id={ids.noteLeft} className="kg-hint text-right">
          {t('fa.visit.left', { n: fmtNum(NOTE_MAX - note.length, lang) })}
        </p>
      </div>

      {err && (
        <p className="kg-err" role="alert">
          {t('fa.visit.error', { msg: err })}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={busy} aria-disabled={busy} data-testid="kg-visit-send">
        <Send size={17} aria-hidden />
        {busy ? t('fa.visit.sending') : t('fa.visit.send')}
      </button>
      {tried && missing && (
        <p className="kg-err" role="alert">
          {missing}
        </p>
      )}
    </form>
  );
}
