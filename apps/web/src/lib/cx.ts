export type ClassValue = string | false | null | undefined | 0;
/** Join class names, skipping falsy values. */
export const cx = (...parts: ClassValue[]) => parts.filter(Boolean).join(' ');
