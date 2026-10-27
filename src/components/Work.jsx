import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { WORKS, workSrc, workLabel } from '../data/works.js';
import { scrollToTarget } from '../lib/scroll.js';

const pad2 = (n) => String(n).padStart(2, '0');
const srcSet = (i) => `${workSrc(i, 'card-sm')} 512w, ${workSrc(i, 'card')} 768w, ${workSrc(i, 'full')} 1600w`;

function Card({ i, onOpen }) {
  const w = WORKS[i];
  return (
    <article className="work-card group w-full shrink-0 land:w-min">
      <button
        type="button"
        onClick={() => onOpen(i)}
        aria-label={`View ${workLabel(w)}`}
        data-cursor="view"
        className="work-frame relative block w-full overflow-hidden rounded-[1.1rem] bg-night-deep shadow-[0_30px_60px_-30px_rgba(2,5,16,0.7)] land:h-[58svh] land:w-auto"
        style={{ aspectRatio: `1 / ${w.aspect}` }}
      >
        <img
          src={workSrc(i, 'card')}
          srcSet={srcSet(i)}
          sizes="(min-aspect-ratio: 1/1) 60vh, 90vw"
          alt={workLabel(w)}
          loading="lazy"
          decoding="async"
          draggable="false"
          className="work-img absolute inset-0 h-full w-full scale-[1.08] object-cover transition-transform duration-[1.2s] ease-[cubic-bezier(.22,1,.36,1)] group-hover:scale-[1.13]"
        />
      </button>
      <div className="mt-5 flex items-start justify-between gap-6">
        <div>
          <h3 className="font-display text-[7vw] leading-[1.05] land:text-[1.75vw]">{w.title}</h3>
          <p className="mt-2 text-[10px] uppercase tracking-[0.28em] text-ice/65">
            {[w.client, w.type].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className="font-display text-sm italic text-ice/60">{pad2(i + 1)}</span>
      </div>
    </article>
  );
}

// The projects. Landscape screens get a pinned gallery that glides sideways as you scroll, each
// image drifting inside its frame; phones get tall cards one after another.
export default function Work({ onOpen }) {
  const sectionRef = useRef(null);
  const trackRef = useRef(null);
  const barRef = useRef(null);

  useEffect(() => {
    const section = sectionRef.current;
    const track = trackRef.current;
    const mm = gsap.matchMedia();
    mm.add('(min-aspect-ratio: 1/1) and (min-width: 900px)', () => {
      const distance = () => Math.max(0, track.scrollWidth - window.innerWidth);
      const slide = gsap.to(track, {
        x: () => -distance(),
        ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: () => `+=${distance()}`,
          pin: true,
          scrub: true,
          invalidateOnRefresh: true,
          onUpdate: (self) => gsap.set(barRef.current, { scaleX: self.progress }),
        },
      });
      // each design drifts inside its frame as the gallery moves
      track.querySelectorAll('.work-card').forEach((card) => {
        gsap.fromTo(card.querySelector('.work-img'), { xPercent: -4 }, {
          xPercent: 4,
          ease: 'none',
          scrollTrigger: { trigger: card, containerAnimation: slide, start: 'left right', end: 'right left', scrub: true },
        });
      });
    });
    mm.add('not ((min-aspect-ratio: 1/1) and (min-width: 900px))', () => {
      track.querySelectorAll('.work-card').forEach((card) => {
        gsap.fromTo(card, { autoAlpha: 0, y: 60 }, {
          autoAlpha: 1, y: 0, duration: 1.1, ease: 'power3.out',
          scrollTrigger: { trigger: card, start: 'top 90%', once: true },
        });
      });
    });

    return () => mm.revert();
  }, []);

  return (
    <section ref={sectionRef} id="work" className="relative z-10 overflow-hidden bg-night text-ice land:h-svh">
      <div
        ref={trackRef}
        className="flex flex-col gap-[12svh] px-[6vw] py-[14svh] will-change-transform land:h-full land:flex-row land:items-center land:gap-[4vw] land:px-[8vw] land:py-0"
      >
        <header className="shrink-0 land:w-[30vw]">
          <p className="mb-8 text-[10px] uppercase tracking-[0.32em] text-ice/70">(03) — Selected work</p>
          <h2 className="font-display text-[15vw] leading-[0.92] tracking-[-0.02em] land:text-[7.2vw]">
            Selected<br /><em>work</em>
          </h2>
          <p className="mt-8 max-w-[24rem] text-[14px] leading-relaxed text-ice/80">
            {WORKS.length} projects across identity, campaigns, packaging and digital. Tap any of them to see it full size.
          </p>
          <p className="mt-10 hidden items-center gap-3 text-[10px] uppercase tracking-[0.3em] text-ice/70 land:flex">
            Scroll
            <svg width="28" height="10" viewBox="0 0 28 10" fill="none" aria-hidden="true"><path d="M0 5h27M23 1l4 4-4 4" stroke="currentColor" strokeWidth="1" /></svg>
          </p>
        </header>
        {WORKS.map((_, i) => <Card key={i} i={i} onOpen={onOpen} />)}
        <div className="shrink-0 land:w-[24vw]">
          <p className="font-display text-[10vw] leading-[1.02] land:text-[3.4vw]">
            That&rsquo;s a taste.<br /><em>Let&rsquo;s make yours.</em>
          </p>
          <button
            type="button"
            onClick={() => scrollToTarget('#contact')}
            className="mt-8 inline-flex items-center gap-3 rounded-full border border-ice/50 px-6 py-3 text-[10px] uppercase tracking-[0.3em] transition-colors duration-500 hover:bg-ice hover:text-night"
          >
            Get in touch
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 10 10 2M4 2h6v6" stroke="currentColor" strokeWidth="1.1" /></svg>
          </button>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-[8vw] bottom-[6svh] hidden h-px bg-ice/20 land:block" aria-hidden="true">
        <div ref={barRef} className="h-full origin-left scale-x-0 bg-glow" />
      </div>
    </section>
  );
}
