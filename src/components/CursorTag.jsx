import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { finePointer } from '../lib/scroll.js';

// A round "View" tag that follows the pointer over anything marked data-cursor="view"
export default function CursorTag() {
  const ref = useRef(null);
  useEffect(() => {
    if (!finePointer) return undefined;
    const tag = ref.current;
    const qx = gsap.quickTo(tag, 'x', { duration: 0.45, ease: 'power3.out' });
    const qy = gsap.quickTo(tag, 'y', { duration: 0.45, ease: 'power3.out' });
    let on = false;
    const move = (e) => {
      qx(e.clientX);
      qy(e.clientY);
      const over = !!(e.target.closest && e.target.closest('[data-cursor="view"]'));
      if (over !== on) {
        on = over;
        gsap.to(tag, { scale: on ? 1 : 0, autoAlpha: on ? 1 : 0, duration: 0.4, ease: 'power3.out', overwrite: 'auto' });
      }
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, []);
  if (!finePointer) return null;
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed left-0 top-0 z-50 -ml-9 -mt-9 grid size-[4.5rem] scale-0 place-items-center rounded-full bg-ice text-[10px] uppercase tracking-[0.25em] text-night opacity-0 shadow-[0_10px_30px_-10px_rgba(2,5,16,0.5)]"
      aria-hidden="true"
    >
      View
    </div>
  );
}
