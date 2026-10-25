import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export const finePointer = typeof window !== 'undefined' && matchMedia('(pointer: fine)').matches;
export const reducedMotion = typeof window !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const webgl = (() => {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
})();

// Smooth wheel scrolling with Lenis on desktop, kept in step with GSAP's clock and ScrollTrigger;
// touch screens keep the browser's own momentum, which is the fastest and smoothest there is.
export let lenis = null;
export function initScroll() {
  if (lenis || !finePointer || reducedMotion) return lenis;
  lenis = new Lenis({ lerp: 0.11, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  return lenis;
}

export function lockScroll(locked) {
  document.documentElement.classList.toggle('is-locked', locked);
  if (lenis) (locked ? lenis.stop() : lenis.start());
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export function scrollToTarget(target, duration = 1.4) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (lenis) lenis.scrollTo(el ?? target, { duration, easing: ease });
  else if (typeof target === 'number') window.scrollTo({ top: target, behavior: reducedMotion ? 'auto' : 'smooth' });
  else if (el) el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
}
