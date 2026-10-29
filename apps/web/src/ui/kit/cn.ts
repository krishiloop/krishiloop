import { clsx, type ClassValue } from 'clsx';

/** Join class names (clsx). Kit components never rely on utility conflicts being merged away, so no tailwind-merge. */
export const cn = (...v: ClassValue[]) => clsx(v);
