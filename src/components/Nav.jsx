import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { lockScroll, scrollToTarget } from '../lib/scroll.js';
import { SITE } from '../data/site.js';

export const SECTIONS = [
  { id: 'top', label: 'Home' },
  { id: 'about', label: 'About' },
  { id: 'work', label: 'Work' },
  { id: 'services', label: 'Services' },
  { id: 'contact', label: 'Contact' },
];

// The bar across the top: menu on the left, the sections on the right, as in the reference.
// It takes the dark ink over the light sections and steps aside while you read down the page.
export default function Nav({ show }) {
  const barRef = useRef(null);
  const indexRef = useRef(null);
  const [light, setLight] = useState(false);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const bar = barRef.current;
    gsap.set([bar, indexRef.current], { autoAlpha: 0 });
    // which section is under the bar, and is it a light one
    const triggers = SECTIONS.map((s, i) => {
      const el = document.getElementById(s.id);
      if (!el) return null;
      return ScrollTrigger.create({
        trigger: el,
        start: 'top 40px',
        end: 'bottom 40px',
        onToggle: (self) => {
          if (!self.isActive) return;
          setLight(el.dataset.nav === 'light');
          setCurrent(i);
        },
      });
    });
    // hide on the way down, back on the way up
    let last = window.scrollY;
    let hidden = false;
    const onScroll = () => {
      const y = window.scrollY;
      const down = y > last + 4 && y > window.innerHeight * 0.6;
      const up = y < last - 4 || y < window.innerHeight * 0.3;
      if (down && !hidden) {
        hidden = true;
        gsap.to(bar, { yPercent: -120, duration: 0.6, ease: 'power3.out' });
      } else if (up && hidden) {
        hidden = false;
        gsap.to(bar, { yPercent: 0, duration: 0.6, ease: 'power3.out' });
      }
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      triggers.forEach((t) => t && t.kill());
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    if (show) gsap.to([barRef.current, indexRef.current], { autoAlpha: 1, duration: 0.9, ease: 'power2.out', delay: 0.2 });
  }, [show]);

  const go = (id) => {
    setOpen(false);
    lockScroll(false);
    if (id) scrollToTarget(`#${id}`, 1.6);
  };
  const toggle = () => {
    lockScroll(!open);
    setOpen(!open);
  };

  const ink = light && !open ? 'text-night' : 'text-ice';
  return (
    <>
      <header ref={barRef} className={`fixed inset-x-0 top-0 z-40 transition-colors duration-500 ${ink}`}>
        <nav className="flex items-center justify-between px-[5vw] py-5 land:px-[3.2vw] land:py-6" aria-label="Main">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls="menu"
            className="group flex items-center gap-3 text-[10px] uppercase tracking-[0.3em]"
          >
            <span className="relative block h-3 w-7" aria-hidden="true">
              <span className={`absolute left-0 top-0 h-px w-7 bg-current transition-transform duration-500 ${open ? 'translate-y-1.5 rotate-45' : ''}`} />
              <span className={`absolute bottom-0 left-0 h-px bg-current transition-all duration-500 ${open ? 'w-7 -translate-y-1.5 -rotate-45' : 'w-4 group-hover:w-7'}`} />
            </span>
            <span className="hidden sm:inline">{open ? 'Close' : 'Menu'}</span>
          </button>
          <a href="#top" onClick={(e) => { e.preventDefault(); go('top'); }} className="font-display text-lg tracking-tight land:hidden">
            {SITE.name}
          </a>
          <ul className="hidden items-center gap-10 text-[10px] uppercase tracking-[0.3em] land:flex">
            {SECTIONS.slice(1).map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={(e) => { e.preventDefault(); go(s.id); }}
                  className="relative py-1 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:origin-right after:scale-x-0 after:bg-current after:transition-transform after:duration-500 hover:after:origin-left hover:after:scale-x-100"
                >
                  {s.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href="#contact"
                onClick={(e) => { e.preventDefault(); go('contact'); }}
                aria-label="Get in touch"
                className="grid size-9 place-items-center rounded-full border border-current/40 transition-colors duration-500 hover:bg-ice hover:text-night"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2 10 10 2M4 2h6v6" stroke="currentColor" strokeWidth="1.1" />
                </svg>
              </a>
            </li>
          </ul>
        </nav>
      </header>

      {/* the section index on the right edge: 01 to 05 */}
      <div
        ref={indexRef}
        className={`pointer-events-none fixed right-[1.6vw] top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-3 transition-colors duration-500 land:flex ${ink}`}
        aria-hidden="true"
      >
        <span className="font-display text-sm">{String(current + 1).padStart(2, '0')}</span>
        {SECTIONS.map((s, i) => (
          <span key={s.id} className={`block h-px bg-current transition-all duration-500 ${i === current ? 'w-5 opacity-100' : 'w-2.5 opacity-40'}`} />
        ))}
      </div>

      <Menu open={open} onGo={go} />
    </>
  );
}

function Menu({ open, onGo }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const items = el.querySelectorAll('.menu-item');
    if (open) {
      gsap.set(el, { display: 'flex' });
      gsap.fromTo(el, { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: 0.9, ease: 'expo.inOut' });
      gsap.fromTo(items, { yPercent: 110 }, { yPercent: 0, duration: 1, stagger: 0.06, ease: 'expo.out', delay: 0.35 });
    } else if (el.style.display === 'flex') {
      gsap.to(el, { clipPath: 'inset(0 0 100% 0)', duration: 0.7, ease: 'expo.inOut', onComplete: () => gsap.set(el, { display: 'none' }) });
    }
  }, [open]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && open) onGo(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onGo]);
  return (
    <div
      ref={ref}
      id="menu"
      className="fixed inset-0 z-30 hidden flex-col justify-end bg-night-deep px-[5vw] pb-[8svh] text-ice land:px-[3.2vw]"
      aria-hidden={!open}
    >
      <ul className="font-display leading-[0.95]">
        {SECTIONS.map((s, i) => (
          <li key={s.id} className="overflow-hidden">
            <a
              href={`#${s.id}`}
              tabIndex={open ? 0 : -1}
              onClick={(e) => { e.preventDefault(); onGo(s.id); }}
              className="menu-item group flex items-baseline gap-5 py-1 text-[15vw] land:text-[8.5vw]"
            >
              <span className="font-sans text-[10px] tracking-[0.3em] text-ice/60">0{i + 1}</span>
              <span className="transition-[font-style,letter-spacing] duration-500 group-hover:italic">{s.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
