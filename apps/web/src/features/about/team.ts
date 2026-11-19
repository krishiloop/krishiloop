import type { Key } from '../../lib/i18n';

/**
 * The team, shown on /about and in the home page's team strip. Names and roles are exactly as the team gave them on
 * the competition portal (20 Nov 2026). Names and roles only: no pronouns, no country, no guesses.
 *
 * To change someone, edit their one line. To add a role, add it to ROLE below (and its words to en.about.ts and
 * bn.about.ts as `about.team.role.<id>`). Links are optional: `links: [{ label: 'GitHub', href: 'https://…' }]`.
 * Photos live in public/team/<photo>-400.webp and -800.webp (4:5 portraits, cropped to the face, nothing else changed).
 * The Bangla spellings of the names are machine-written: the team checks them.
 */
export type Role = 'lead' | 'aiml' | 'domain' | 'ux' | 'ui' | 'fullstack' | 'ideas' | 'review' | 'testing';
export type Tone = 'butter' | 'lotus' | 'monsoon' | 'hyacinth' | 'moss' | 'terracotta';

export interface Member {
  /** the photo's file stem in public/team/ */
  photo: string;
  name: string;
  /** the name in Bangla script (shown when the page is in Bangla) */
  nameBn: string;
  roles: Role[];
  /** the card's pastel */
  tone: Tone;
  links?: { label: string; href: string }[];
}

export const ROLE: Record<Role, Key> = {
  lead: 'about.team.role.lead',
  aiml: 'about.team.role.aiml',
  domain: 'about.team.role.domain',
  ux: 'about.team.role.ux',
  ui: 'about.team.role.ui',
  fullstack: 'about.team.role.fullstack',
  ideas: 'about.team.role.ideas',
  review: 'about.team.role.review',
  testing: 'about.team.role.testing',
};

export const TEAM: Member[] = [
  { photo: 'rubab', name: 'Abdullah Rubab', nameBn: 'আবদুল্লাহ রুবাব', roles: ['lead', 'aiml', 'domain'], tone: 'butter' },
  { photo: 'tanvir', name: 'Md. Tanvir Hasan', nameBn: 'মো. তানভীর হাসান', roles: ['ux', 'ui'], tone: 'monsoon' },
  { photo: 'shabab', name: 'Md. Sadman Al Islam Shabab', nameBn: 'মো. সাদমান আল ইসলাম শাবাব', roles: ['fullstack', 'ux'], tone: 'hyacinth' },
  { photo: 'sourov', name: 'Sourov Kumar', nameBn: 'সৌরভ কুমার', roles: ['domain', 'ideas'], tone: 'moss' },
  { photo: 'anushree', name: 'Anushree Gope', nameBn: 'অনুশ্রী গোপ', roles: ['review', 'testing'], tone: 'lotus' },
];

/** srcset for a member's portrait */
export const photoSet = (m: Member) => `/team/${m.photo}-400.webp 400w, /team/${m.photo}-800.webp 800w`;
