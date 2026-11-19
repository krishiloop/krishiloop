import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Magnetic } from './Magnetic';
import { cn } from './cn';

type Tone = 'accent' | 'glass' | 'ink';
interface Look {
  /** accent: the mustard action (one per screen); glass: a frosted pill on imagery or dark bands; ink: solid ink */
  tone?: Tone;
  size?: 'md' | 'lg';
  /** a trailing arrow that nudges on hover */
  arrow?: boolean;
  /** lean toward the mouse (Magnetic); mouse only, off under reduced motion */
  magnetic?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

const cls = (tone: Tone, size: 'md' | 'lg', extra?: string) =>
  cn('btn liquid', tone === 'accent' ? 'btn-primary' : tone === 'glass' ? 'liquid-glass glass' : 'liquid-ink', size === 'lg' && 'btn-lg', extra);

function Inner({ icon, children, arrow }: { icon?: ReactNode; children: ReactNode; arrow?: boolean }) {
  return (
    <>
      {icon}
      <span>{children}</span>
      {arrow && <ArrowRight size={18} className="arrow" aria-hidden />}
    </>
  );
}

const wrap = (magnetic: boolean | undefined, node: ReactNode) => (magnetic ? <Magnetic>{node}</Magnetic> : node);

/**
 * LiquidButton: the house pill. A soft ambient glow, a refracted top highlight, and on hover a wave of lighter colour
 * that rises through it (transform only; kit.css `.liquid`). Renders a <button>, a router <Link> (`to`) or an <a>
 * (`href`, opens in a new tab when external).
 *
 *   <LiquidButton to="/app" arrow magnetic>Open the farmer app</LiquidButton>
 *   <LiquidButton tone="glass" onClick={…}>Listen</LiquidButton>
 */
export function LiquidButton(props: Look & ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }) {
  const { tone = 'accent', size = 'md', arrow, magnetic, icon, className, children, type = 'button', ref, ...rest } = props;
  return wrap(
    magnetic,
    <button ref={ref} type={type} className={cls(tone, size, className)} {...rest}>
      <Inner icon={icon} arrow={arrow}>
        {children}
      </Inner>
    </button>,
  );
}

export function LiquidLink(props: Look & Omit<LinkProps, 'children' | 'className'>) {
  const { tone = 'accent', size = 'md', arrow, magnetic, icon, className, children, ...rest } = props;
  return wrap(
    magnetic,
    <Link className={cls(tone, size, className)} {...rest}>
      <Inner icon={icon} arrow={arrow}>
        {children}
      </Inner>
    </Link>,
  );
}

export function LiquidAnchor(props: Look & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'className'>) {
  const { tone = 'accent', size = 'md', arrow, magnetic, icon, className, children, href, ...rest } = props;
  const external = !!href && /^https?:/.test(href);
  return wrap(
    magnetic,
    <a href={href} className={cls(tone, size, className)} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} {...rest}>
      <Inner icon={icon} arrow={arrow}>
        {children}
      </Inner>
    </a>,
  );
}
