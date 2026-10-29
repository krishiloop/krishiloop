/**
 * Where the files behind every number live. Its own tiny module so pages that only need a link (/trust) do not pull in
 * all of sources.ts. The files are on the `g1/local-journey` branch until it is merged: REPO_REF is the one place to change.
 */
export const REPO = 'https://github.com/krishiloop/krishiloop';
export const REPO_REF = 'g1/local-journey';
export const blob = (path: string) => `${REPO}/blob/${REPO_REF}/${path}`;
export const tree = (path: string) => `${REPO}/tree/${REPO_REF}/${path}`;
