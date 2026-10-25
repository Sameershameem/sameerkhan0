import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { WORKS, workSrc, workLabel } from '../data/works.js';
import { lockScroll } from '../lib/scroll.js';

const pad2 = (n) => String(n).padStart(2, '0');

// A design at full size, with its title, and the others a swipe or an arrow key away
export default function Lightbox({ index, onClose, onStep }) {
  const rootRef = useRef(null);
  const imgRef = useRef(null);
  const closeRef = useRef(null);
  const [shown, setShown] = useState(index);
  const open = index !== null;
  const dir = useRef(0);

  // open and close
  useEffect(() => {
    const root = rootRef.current;
    if (open) {
      dir.current = 0;
      lockScroll(true);
      gsap.set(root, { display: 'flex' });
      gsap.fromTo(root, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, ease: 'power2.out' });
      closeRef.current?.focus({ preventScroll: true });
    } else if (root.style.display === 'flex') {
      gsap.to(root, {
        autoAlpha: 0, duration: 0.45, ease: 'power2.inOut',
        onComplete: () => { gsap.set(root, { display: 'none' }); lockScroll(false); },
      });
    }
  }, [open]);

  // change design: the old one slides out, the new one in once decoded
  useEffect(() => {
    if (index === null) return;
    const img = imgRef.current;
    const d = dir.current;
    const pre = new Image();
    pre.src = workSrc(index, 'full');
    const swap = () => {
      setShown(index);
      gsap.fromTo(img, { autoAlpha: 0, x: d * 50, scale: d ? 1 : 0.94 }, { autoAlpha: 1, x: 0, scale: 1, duration: 0.7, ease: 'power3.out' });
    };
    const ready = pre.decode ? pre.decode().catch(() => {}) : Promise.resolve();
    if (d && shown !== null) gsap.to(img, { autoAlpha: 0, x: -d * 50, duration: 0.25, ease: 'power2.in', onComplete: () => ready.then(swap) });
    else ready.then(swap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') { dir.current = 1; onStep(1); }
      else if (e.key === 'ArrowLeft') { dir.current = -1; onStep(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onStep]);

  const swipe = useRef(null);
  const step = (d) => { dir.current = d; onStep(d); };
  const w = shown !== null ? WORKS[shown] : null;
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Design viewer"
      className="fixed inset-0 z-[60] hidden flex-col items-center justify-center gap-6 bg-mocha-ink/90 px-5 py-6 text-lavender backdrop-blur-xl"
      onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) step(dx < 0 ? 1 : -1);
        else if (e.target === rootRef.current) onClose();
      }}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="absolute right-5 top-5 text-[10px] uppercase tracking-[0.3em] text-lavender/80 transition-colors hover:text-lavender"
      >
        Close ✕
      </button>
      <figure className="flex min-h-0 w-full flex-1 items-center justify-center">
        <img
          ref={imgRef}
          src={w ? workSrc(shown, 'full') : undefined}
          alt={w ? workLabel(w) : ''}
          className="max-h-[74svh] max-w-full rounded-xl object-contain shadow-[0_40px_80px_-30px_rgba(0,0,0,0.7)]"
          draggable="false"
        />
      </figure>
      {w && (
        <div className="flex w-full max-w-3xl items-end justify-between gap-6">
          <div>
            <p className="font-display text-2xl leading-tight land:text-3xl">{w.title}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.28em] text-lavender/65">{[w.client, w.type].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex items-center gap-4 text-[11px] tracking-[0.2em]">
            <button type="button" onClick={() => step(-1)} aria-label="Previous design" className="grid size-11 place-items-center rounded-full border border-lavender/40 transition-colors hover:bg-lavender hover:text-mocha">←</button>
            <span className="tabular-nums">{pad2(shown + 1)} / {pad2(WORKS.length)}</span>
            <button type="button" onClick={() => step(1)} aria-label="Next design" className="grid size-11 place-items-center rounded-full border border-lavender/40 transition-colors hover:bg-lavender hover:text-mocha">→</button>
          </div>
        </div>
      )}
    </div>
  );
}
