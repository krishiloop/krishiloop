import { useEffect, useId, useMemo, useState } from 'react';
import { ReceiptText } from 'lucide-react';
import { useI18n, type Key } from '../../../lib/i18n';
import '../../../lib/i18n/strings.krishiguard';
import { currencySymbol, fmtNum } from '../../../lib/format';
import { readJSON, writeJSON } from '../../../lib/storage';
import { cx } from '../../../lib/cx';
import { useHeld } from '../receipts';
import { DEFAULT_DECIMALS_PER_BIGHA, UNITS, convertSize, parseNum, savings, switchUnit, tidy, type CalcInput, type Unit } from './calc';
import './calc.css';

interface Saved {
  size: string;
  unit: Unit;
  dpb: string;
  product: string;
  labour: string;
  sprays: string | null;
}
const KEY = 'kl.calc.v1';
const EMPTY: Saved = { size: '', unit: 'bigha', dpb: String(DEFAULT_DECIMALS_PER_BIGHA), product: '', labour: '', sprays: null };

/** "No spray needed" receipts this farmer holds in this tab (the season, as far as this demo knows it). */
function useNoSprayCount(fieldId: string | null): number {
  const held = useHeld();
  return useMemo(
    () => new Set(held.items.filter((r) => r.receipt.advice?.decision === 'dont_spray' && (!fieldId || r.fieldId === fieldId)).map((r) => r.id)).size,
    [held.items, fieldId],
  );
}

/**
 * The live savings calculator: field size (decimal, bigha with an editable size, acre, hectare), the farmer's own cost
 * of one spray (product and labour, per unit of land) and the sprays skipped this season. Taka saved updates as they
 * type. Only arithmetic on their numbers: no dose, no price, no yield claim. Kept on this phone (localStorage).
 */
export function Calculator({ fieldId }: { fieldId: string | null }) {
  const { t, lang } = useI18n();
  const [v, setV] = useState<Saved>(() => ({ ...EMPTY, ...(readJSON<Saved>(KEY) ?? {}) }));
  const receipts = useNoSprayCount(fieldId);
  const ids = { size: useId(), unit: useId(), dpb: useId(), product: useId(), labour: useId(), sprays: useId(), out: useId(), dpbHint: useId(), spraysHint: useId() };

  useEffect(() => writeJSON(KEY, v), [v]);

  const sprays = v.sprays ?? String(receipts);
  const nums = {
    size: parseNum(v.size),
    dpb: parseNum(v.dpb),
    product: parseNum(v.product),
    labour: parseNum(v.labour),
    sprays: parseNum(sprays),
  };
  const anyBad = Object.values(nums).some((n) => n === null);
  const input: CalcInput = {
    size: nums.size ?? 0,
    unit: v.unit,
    decimalsPerBigha: nums.dpb ?? 0,
    productPerUnit: nums.product ?? 0,
    labourPerUnit: nums.labour ?? 0,
    sprays: nums.sprays ?? 0,
  };
  const r = savings(input);
  const ok = !anyBad && r.ok;
  const tk = currencySymbol('BDT', lang);
  const money = (n: number) => `${tk} ${fmtNum(Math.round(n), lang)}`;
  const unitWord = (u: Unit) => t(`fa.calc.u.${u}` as Key);

  const changeUnit = (to: Unit) => {
    if (to === v.unit) return;
    if (!ok || input.size === 0) return setV({ ...v, unit: to });
    const next = switchUnit(input, to);
    setV({ ...v, unit: to, size: tidy(next.size, 3), product: v.product ? tidy(next.productPerUnit, 2) : '', labour: v.labour ? tidy(next.labourPerUnit, 2) : '' });
  };

  const same = ok && input.size > 0
    ? UNITS.filter((u) => u !== v.unit)
        .map((u) => `${fmtNum(convertSize(input.size, v.unit, u, input.decimalsPerBigha), lang, { maximumFractionDigits: u === 'decimal' ? 1 : 3 })} ${unitWord(u)}`)
        .join(' · ')
    : null;

  return (
    <div className="kg-calc" data-testid="kg-calc">
      <p className="kg-calc-yours">
        <span className="chip chip-wait">{t('fa.calc.yours')}</span>
      </p>

      <fieldset className="kg-fieldset">
        <legend className="kg-legend">{t('fa.calc.size')}</legend>
        <div className="kg-calc-size">
          <label className="sr-only-live" htmlFor={ids.size}>
            {t('fa.calc.size')}
          </label>
          <input id={ids.size} className="kg-input kg-input-num" inputMode="decimal" autoComplete="off" value={v.size} placeholder="0" onChange={(e) => setV({ ...v, size: e.target.value })} aria-invalid={nums.size === null} data-testid="kg-calc-size" />
          <div role="radiogroup" aria-label={t('fa.calc.unit')} className="kg-units">
            {UNITS.map((u) => (
              <label key={u} className={cx('kg-unit', v.unit === u && 'is-on')}>
                <input type="radio" name={ids.unit} value={u} checked={v.unit === u} onChange={() => changeUnit(u)} data-testid={`kg-unit-${u}`} />
                <span>{unitWord(u)}</span>
              </label>
            ))}
          </div>
        </div>
        {v.unit === 'bigha' && (
          <div className="kg-calc-dpb">
            <label htmlFor={ids.dpb} className="kg-label">
              {t('fa.calc.dpb')}
            </label>
            <input id={ids.dpb} className="kg-input kg-input-sm" inputMode="decimal" autoComplete="off" value={v.dpb} onChange={(e) => setV({ ...v, dpb: e.target.value })} aria-describedby={ids.dpbHint} aria-invalid={nums.dpb === null || nums.dpb === 0} data-testid="kg-calc-dpb" />
            <p id={ids.dpbHint} className="kg-hint">
              {t('fa.calc.dpbHint')}
            </p>
          </div>
        )}
        {same && (
          <p className="kg-hint" data-testid="kg-calc-same">
            {t('fa.calc.same', { list: same })}
          </p>
        )}
      </fieldset>

      <fieldset className="kg-fieldset">
        <legend className="kg-legend">{t('fa.calc.costs', { unit: unitWord(v.unit) })}</legend>
        <div className="kg-calc-two">
          <div>
            <label htmlFor={ids.product} className="kg-label">
              {t('fa.calc.product')}
            </label>
            <input id={ids.product} className="kg-input kg-input-num" inputMode="decimal" autoComplete="off" value={v.product} placeholder="0" onChange={(e) => setV({ ...v, product: e.target.value })} aria-invalid={nums.product === null} data-testid="kg-calc-product" />
          </div>
          <div>
            <label htmlFor={ids.labour} className="kg-label">
              {t('fa.calc.labour')}
            </label>
            <input id={ids.labour} className="kg-input kg-input-num" inputMode="decimal" autoComplete="off" value={v.labour} placeholder="0" onChange={(e) => setV({ ...v, labour: e.target.value })} aria-invalid={nums.labour === null} data-testid="kg-calc-labour" />
          </div>
        </div>
      </fieldset>

      <fieldset className="kg-fieldset">
        <legend className="sr-only-live">{t('fa.calc.sprays')}</legend>
        <label htmlFor={ids.sprays} className="kg-label">
          {t('fa.calc.sprays')}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input id={ids.sprays} className="kg-input kg-input-sm" inputMode="numeric" autoComplete="off" value={sprays} onChange={(e) => setV({ ...v, sprays: e.target.value })} aria-describedby={ids.spraysHint} aria-invalid={nums.sprays === null || !Number.isInteger(nums.sprays ?? 0)} data-testid="kg-calc-sprays" />
          {receipts > 0 && sprays !== String(receipts) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setV({ ...v, sprays: null })}>
              <ReceiptText size={16} aria-hidden />
              {t('fa.calc.useReceipts', { n: fmtNum(receipts, lang) })}
            </button>
          )}
        </div>
        <p id={ids.spraysHint} className="kg-hint">
          {receipts === 1 ? t('fa.calc.fromReceiptsOne') : receipts > 0 ? t('fa.calc.fromReceipts', { n: fmtNum(receipts, lang) }) : t('fa.calc.fromReceiptsNone')}
        </p>
      </fieldset>

      <output htmlFor={`${ids.size} ${ids.product} ${ids.labour} ${ids.sprays}`} id={ids.out} className={cx('kg-calc-out', !ok && 'is-bad')} aria-live="polite" data-testid="kg-calc-out">
        <span className="eyebrow block">{t('fa.calc.saved')}</span>
        {ok ? (
          <>
            <span className="kg-calc-total" data-testid="kg-calc-total">
              {money(r.total)}
            </span>
            <span className="kg-calc-break">{t('fa.calc.perSpray', { n: fmtNum(input.sprays, lang), cost: money(r.perSpray) })}</span>
          </>
        ) : (
          <span className="kg-calc-break">{t('fa.calc.invalid')}</span>
        )}
      </output>
      <p className="kg-hint">{t('fa.calc.note')}</p>
    </div>
  );
}
