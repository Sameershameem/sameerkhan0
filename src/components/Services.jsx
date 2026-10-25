import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { SERVICES } from '../data/site.js';
import { WORKS, workSrc, workLabel } from '../data/works.js';
import { finePointer } from '../lib/scroll.js';
import { RevealWords, Rise } from './Reveal.jsx';

// What she makes: a list where each line, hovered, floats one of her designs beside the pointer
export default function Services({ onOpen }) {
  const previewRef = useRef(null);
  const [hover, setHover] = useState(-1);

  useEffect(() => {
    if (!finePointer) return undefined;
    const el = previewRef.current;
    const qx = gsap.quickTo(el, 'x', { duration: 0.7, ease: 'power3.out' });
    const qy = gsap.quickTo(el, 'y', { duration: 0.7, ease: 'power3.out' });
    const move = (e) => { qx(e.clientX); qy(e.clientY); };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, []);

  useEffect(() => {
    if (!finePointer) return;
    gsap.to(previewRef.current, { autoAlpha: hover >= 0 ? 1 : 0, scale: hover >= 0 ? 1 : 0.85, duration: 0.5, ease: 'power3.out' });
  }, [hover]);

  return (
    <section id="services" data-nav="light" className="relative z-10 bg-silver px-[6vw] py-[16svh] text-mocha land:px-[8vw]">
      <p className="mb-10 text-[10px] uppercase tracking-[0.32em] text-mocha/70">(04) — Services</p>
      <RevealWords
        as="h2"
        className="font-display text-[14vw] leading-[0.95] tracking-[-0.02em] land:text-[7vw]"
        parts={[{ text: 'What I' }, { text: 'make', em: true }]}
      />
      <ul className="mt-[8svh] border-t border-mocha/20" onPointerLeave={() => setHover(-1)}>
        {SERVICES.map((s, i) => (
          <Rise as="li" key={s.name} y={24} delay={(i % 4) * 0.04}>
            <button
              type="button"
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(-1)}
              onClick={() => onOpen(s.work)}
              aria-label={`${s.name}: view ${workLabel(WORKS[s.work])}`}
              className="group grid w-full grid-cols-[2.5rem_1fr_auto] items-baseline gap-4 border-b border-mocha/20 py-6 text-left land:grid-cols-[5rem_1fr_1fr_auto] land:py-8"
            >
              <span className="text-[10px] tracking-[0.3em] text-mocha/55">{String(i + 1).padStart(2, '0')}</span>
              <span className="font-display text-[7.4vw] leading-[1.05] transition-[transform,font-style] duration-700 ease-[cubic-bezier(.22,1,.36,1)] group-hover:translate-x-3 group-hover:italic land:text-[3.4vw]">
                {s.name}
              </span>
              <span className="hidden text-[13px] text-mocha/70 land:block">{s.note}</span>
              <svg className="translate-y-[-0.1em] transition-transform duration-500 group-hover:rotate-45" width="16" height="16" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2 10 10 2M4 2h6v6" stroke="currentColor" strokeWidth="1" />
              </svg>
            </button>
          </Rise>
        ))}
      </ul>
      {finePointer && (
        <div
          ref={previewRef}
          className="pointer-events-none fixed left-0 top-0 z-30 -ml-[8.5rem] -mt-[8.5rem] size-[17rem] overflow-hidden rounded-2xl opacity-0 shadow-[0_30px_60px_-25px_rgba(46,31,21,0.6)]"
          aria-hidden="true"
        >
          {SERVICES.map((s, i) => (
            <img
              key={s.name}
              src={workSrc(s.work, 'card')}
              alt=""
              loading="lazy"
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${hover === i ? 'opacity-100' : 'opacity-0'}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
