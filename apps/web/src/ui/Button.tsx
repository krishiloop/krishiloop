import type { AnchorHTMLAttributes, ButtonHTMLAttributes, Ref } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { cx } from '../lib/cx';

export type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'go';
export type Size = 'sm' | 'md' | 'lg';

interface Look {
  variant?: Variant;
  size?: Size;
  /** a square icon-only button (give it an aria-label) */
  icon?: boolean;
  /** a trailing arrow that nudges on hover */
  arrow?: boolean;
}

const classes = ({ variant = 'secondary', size = 'md', icon }: Look, extra?: string) =>
  cx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, icon && 'btn-icon', extra);

export function Button({ variant, size, icon, arrow, className, children, type = 'button', ref, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & Look & { ref?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={ref} type={type} className={classes({ variant, size, icon }, className)} {...rest}>
      {children}
      {arrow && <ArrowRight size={18} className="arrow" aria-hidden />}
    </button>
  );
}

/** A router link that looks like a button. */
export function LinkButton({ variant, size, arrow, className, children, ...rest }: LinkProps & Look) {
  return (
    <Link className={classes({ variant, size }, className)} {...rest}>
      {children}
      {arrow && <ArrowRight size={18} className="arrow" aria-hidden />}
    </Link>
  );
}

/** An external link that looks like a button; opens in a new tab with a north-east arrow. */
export function ExternalButton({ variant, size, className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & Look) {
  return (
    <a className={classes({ variant, size }, className)} target="_blank" rel="noreferrer" {...rest}>
      {children}
      <ArrowUpRight size={17} className="arrow" aria-hidden />
    </a>
  );
}
