import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { RevealWords, Rise } from './Reveal.jsx';
import { WORKS, CLIENTS } from '../data/works.js';

const FACTS = [
  { n: WORKS.length, label: 'Selected designs' },
  { n: CLIENTS.length, label: 'Brands' },
  { n: new Set(WORKS.map((w) => w.type)).size, label: 'Kinds of posts' },
];

function Count({ to }) {
  const ref = useRef(null);
  useEffect(() => {
    const o = { v: 0 };
    const tw = gsap.to(o, {
      v: to, duration: 1.8, ease: 'power3.out',
      onUpdate: () => { ref.current.textContent = String(Math.round(o.v)).padStart(2, '0'); },
      scrollTrigger: { trigger: ref.current, start: 'top 90%', once: true },
    });
    return () => { tw.scrollTrigger?.kill(); tw.kill(); };
  }, [to]);
  return <span ref={ref}>00</span>;
}

export default function About() {
  const names = [...CLIENTS, ...CLIENTS];
  return (
    <section
      id="about"
      data-nav="light"
      className="relative z-10 overflow-hidden rounded-t-[1.75rem] bg-lavender text-mocha land:rounded-t-[3rem]"
    >
      <div className="px-[6vw] pb-[12svh] pt-[16svh] land:px-[8vw] land:pt-[20svh]">
        <p className="mb-10 text-[10px] uppercase tracking-[0.32em] text-mocha/70">(02) — About</p>
        <RevealWords
          as="h2"
          className="max-w-[16ch] font-display text-[12vw] leading-[1.02] tracking-[-0.015em] land:text-[6.4vw]"
          parts={[{ text: 'I design posts people' }, { text: 'stop scrolling', em: true }, { text: 'for.' }]}
        />
        <div className="mt-[9svh] grid gap-12 land:grid-cols-12">
          <Rise className="land:col-span-5">
            <p className="text-[15px] leading-[1.75] text-mocha/90 land:text-[17px]">
              I&rsquo;m Saima Ahmed, a graphic designer. I make social posts, menus, offers and campaigns for
              cafés, dessert bars, consultants, agencies and brands, each one built to be noticed in a busy feed
              and remembered after it.
            </p>
          </Rise>
          <dl className="grid grid-cols-3 gap-4 land:col-span-6 land:col-start-7">
            {FACTS.map((f, i) => (
              <Rise key={f.label} delay={i * 0.08} className="flex flex-col-reverse border-t border-mocha/25 pt-5">
                <dt className="mt-2 text-[10px] uppercase tracking-[0.28em] text-mocha/70">{f.label}</dt>
                <dd className="font-display text-[13vw] leading-none land:text-[5vw]"><Count to={f.n} /></dd>
              </Rise>
            ))}
          </dl>
        </div>
      </div>
      <div className="border-y border-mocha/15 py-6 land:py-8" aria-label="Brands">
        <div className="marquee flex w-max animate-[marquee_38s_linear_infinite] whitespace-nowrap font-display text-[9vw] italic leading-none land:text-[4.2vw]">
          {names.map((name, i) => (
            <span key={i} className="flex items-center" aria-hidden={i >= CLIENTS.length}>
              <span className="px-[3vw]">{name}</span>
              <span className="text-[0.4em] not-italic text-mocha/50">✦</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
