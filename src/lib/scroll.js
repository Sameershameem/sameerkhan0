import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export const finePointer = typeof window !== 'undefined' && matchMedia('(pointer: fine)').matches;
export const reducedMotion = typeof window !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// WebGL 2, and whether it is drawn in software (no GPU), where the 3D would only stutter
const gl = (() => {
  if (typeof document === 'undefined') return { webgl: false, software: false };
  try {
    const ctx = document.createElement('canvas').getContext('webgl2');
    if (!ctx) return { webgl: false, software: false };
    // Firefox names the renderer outright; Chrome and Safari need the debug extension for it
    let name = String(ctx.getParameter(ctx.RENDERER));
    if (/^webkit webgl$/i.test(name)) {
      const info = ctx.getExtension('WEBGL_debug_renderer_info');
      if (info) name = String(ctx.getParameter(info.UNMASKED_RENDERER_WEBGL));
    }
    ctx.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl: true, software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) };
  } catch {
    return { webgl: false, software: false };
  }
})();
export const webgl = gl.webgl;
export const softwareGL = gl.software;

// Smooth wheel scrolling with Lenis on desktop, kept in step with GSAP's clock and ScrollTrigger;
// touch screens keep the browser's own momentum, which is the fastest and smoothest there is.
export let lenis = null;
export function initScroll() {
  if (lenis || !finePointer || reducedMotion) return lenis;
  lenis = new Lenis({ lerp: 0.11, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
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
