/**
 * The SMS a receipt would become (a PREVIEW: sending SMS is planned, not built). Pure, so the counter can be tested.
 *
 * SMS length rules (3GPP TS 23.038): text that fits the GSM 7-bit alphabet gets 160 characters per message (153 per part
 * when it is split); anything else, Bangla included, is sent as UCS-2 with 70 per message (67 per part). A few GSM
 * characters (^ { } \ [ ] ~ | €) take two slots.
 */

const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';

export interface SmsInfo {
  /** characters as the network counts them (GSM extension characters count twice) */
  units: number;
  unicode: boolean;
  /** the limit of a single message: 160 (GSM 7-bit) or 70 (UCS-2) */
  limit: number;
  segments: number;
}

export function smsInfo(text: string): SmsInfo {
  let units = 0;
  let unicode = false;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) units += 1;
    else if (GSM_EXT.includes(ch)) units += 2;
    else {
      unicode = true;
      break;
    }
  }
  if (unicode) {
    // UCS-2 counts UTF-16 code units (a character outside the BMP takes two)
    units = text.length;
    return { units, unicode, limit: 70, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
  }
  return { units, unicode, limit: 160, segments: units <= 160 ? 1 : Math.ceil(units / 153) };
}

/** The short code printed on the receipt (its № line): the last 8 characters of the credential id, upper case. */
export const verifyCode = (credentialId: string) => credentialId.replace(/^urn:uuid:/, '').slice(-8).toUpperCase();

/**
 * One SMS from a receipt: the decision in words, the rule it rests on, the short code and the verify link.
 * `template` comes from the dictionary of the chosen language, with {decision} {rule} {code} {url}.
 */
export function buildSms(template: string, parts: { decision: string; rule: string; code: string; url: string }): string {
  return template.replace(/\{(decision|rule|code|url)\}/g, (_, k: keyof typeof parts) => parts[k]).replace(/\s+/g, ' ').trim();
}
