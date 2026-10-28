/**
 * The team, shown on /about. Left empty on purpose: names and roles come from the team itself (never guessed).
 * Fill in like: { name: 'Full Name', role: 'Team lead · product', initials: 'FN' }. The page shows the cards once
 * there is at least one entry.
 */
export interface Member {
  name: string;
  role: string;
  initials: string;
}

export const TEAM: Member[] = [];
