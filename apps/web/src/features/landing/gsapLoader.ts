/**
 * GSAP is only needed for the story page, and only after the first paint: the headline is plain HTML until then.
 * One shared promise so every section gets the same instance.
 */
type Gsap = typeof import('gsap');
export interface GsapKit {
  gsap: Gsap['gsap'];
  ScrollTrigger: typeof import('gsap/ScrollTrigger').ScrollTrigger;
  SplitText: typeof import('gsap/SplitText').SplitText;
}

let kit: Promise<GsapKit> | null = null;

export function loadGsap(): Promise<GsapKit> {
  kit ??= Promise.all([import('gsap'), import('gsap/ScrollTrigger'), import('gsap/SplitText')]).then(([g, st, sp]) => {
    g.gsap.registerPlugin(st.ScrollTrigger, sp.SplitText);
    return { gsap: g.gsap, ScrollTrigger: st.ScrollTrigger, SplitText: sp.SplitText };
  });
  return kit;
}
