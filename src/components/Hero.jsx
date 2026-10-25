import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { createHeroScene, samplePortrait } from '../three/heroScene.js';
import { reducedMotion, scrollToTarget, webgl } from '../lib/scroll.js';

const WORDS = ['Saima', 'Ahmed'];
const PORTRAIT = 'saima/saima-1200.webp';
const SRCSET = 'saima/saima-1200.webp 642w, saima/saima-1600.webp 856w, saima/saima-2000.webp 1070w, saima/saima-2600.webp 1392w';

function Word({ text, className, wordRef }) {
  return (
    <span ref={wordRef} className={`absolute block whitespace-nowrap leading-[0.86] ${className}`}>
      {[...text].map((ch, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.05em] align-top">
          <span className="hero-letter inline-block uppercase">{ch}</span>
        </span>
      ))}
    </span>
  );
}

// The hero: on the mocha the camera dived into, particles from the bear's iris gather into Saima,
// her name sits behind her like the reference's CHOREO / CLASS, and liquid chrome wraps round her.
export default function Hero({ start, onReady }) {
  const sectionRef = useRef(null);
  const stageRef = useRef(null);
  const backRef = useRef(null);
  const frontRef = useRef(null);
  const imgRef = useRef(null);
  const nameA = useRef(null);
  const nameB = useRef(null);
  const uiRef = useRef(null);
  const sceneRef = useRef(null);
  const tlRef = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    const section = sectionRef.current;
    const img = imgRef.current;
    const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
    let scene = null;
    if (webgl) {
      try {
        scene = createHeroScene({ back: backRef.current, front: frontRef.current, mobile });
      } catch {
        scene = null;
      }
    }
    sceneRef.current = scene;

    const measure = () => {
      if (!scene) return;
      const s = section.getBoundingClientRect();
      const r = img.getBoundingClientRect();
      scene.setView(s.width, s.height, Math.min(window.devicePixelRatio || 1, 2));
      scene.setRect(r.left - s.left, s.bottom - r.bottom, r.width, r.height);
    };

    // the intro, played once the loader hands over
    const intro = scene ? scene.intro : { p: 1, fade: 0, grow: 1, dust: 1 };
    const letters = section.querySelectorAll('.hero-letter');
    const ui = uiRef.current.querySelectorAll('.hero-ui');
    gsap.set(letters, { yPercent: 112 });
    gsap.set(ui, { autoAlpha: 0, y: 14 });
    const tl = gsap.timeline({ paused: true });
    tl.to(intro, { p: 1, duration: 2.7, ease: 'power1.inOut' }, 0.1);
    tl.to(intro, { grow: 1, duration: 2.0, ease: 'power2.inOut' }, 1.4);
    tl.to(img, { opacity: 1, duration: 0.8, ease: 'power1.inOut' }, 2.45);
    tl.to(intro, { fade: 0, duration: 0.8, ease: 'power1.in' }, 2.6);
    tl.to(intro, { dust: 1, duration: 1.6, ease: 'power1.out' }, 2.2);
    tl.to(letters, { yPercent: 0, duration: 1.2, stagger: 0.055, ease: 'expo.out' }, 2.3);
    tl.to(ui, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.08, ease: 'power3.out' }, 2.9);
    tlRef.current = tl;
    if (!scene || reducedMotion) tl.progress(1);

    let ready = false;
    const prepare = async () => {
      if (scene) {
        const sample = await samplePortrait(PORTRAIT, mobile ? 104 : 150);
        measure();
        scene.setPortrait(sample);
        await scene.prepare();
        scene.render(0);
      }
      ready = true;
      onReady();
    };
    prepare().catch(() => {
      ready = true;
      tl.progress(1);
      onReady();
    });

    // the scene runs while the hero can be seen, and rests once the next section covers it;
    // with reduced motion it is drawn once and holds still
    let drawn = false;
    const tick = (_, dt) => {
      if (!scene || !ready || !started.current) return;
      if (window.scrollY > section.offsetHeight * 1.02) return;
      if (reducedMotion && drawn) return;
      scene.render(Math.min(dt, 50) / 1000);
      drawn = true;
    };
    gsap.ticker.add(tick);

    // the pointer tips the chrome and nudges the name, a little
    const nx = [gsap.quickTo(nameA.current, 'x', { duration: 1.2, ease: 'power3.out' }), gsap.quickTo(nameB.current, 'x', { duration: 1.2, ease: 'power3.out' })];
    const onPointer = (e) => {
      const x = (e.clientX / innerWidth) * 2 - 1;
      const y = (e.clientY / innerHeight) * 2 - 1;
      if (scene) scene.setPointer(x, y);
      nx[0](x * -10);
      nx[1](x * 10);
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

    // as the next section slides over, the hero sinks back and its name parts
    const about = document.querySelector('#about');
    const st = about && gsap.timeline({
      scrollTrigger: { trigger: about, start: 'top bottom', end: 'top top', scrub: true },
    })
      .to(stageRef.current, { scale: 0.92, opacity: 0.35, ease: 'none' }, 0)
      .to(uiRef.current, { opacity: 0, ease: 'none' }, 0)
      .to(nameA.current, { xPercent: -14, ease: 'none' }, 0)
      .to(nameB.current, { xPercent: 14, ease: 'none' }, 0);

    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        measure();
        drawn = false;
        ScrollTrigger.refresh();
      }, 120);
    };
    window.addEventListener('resize', onResize);
    img.addEventListener('load', measure);

    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', onResize);
      img.removeEventListener('load', measure);
      if (st) st.scrollTrigger.kill();
      tl.kill();
      if (scene) scene.dispose();
    };
    // runs once; onReady is stable for the page's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!start || started.current) return;
    started.current = true;
    const tl = tlRef.current;
    const q = new URLSearchParams(location.search);
    if (q.has('hero')) {
      // debug: hold the intro at a given second
      tl.pause(parseFloat(q.get('hero')));
      sceneRef.current?.render(0.016);
      window.__hero = { seek: (t) => { tl.pause(t); sceneRef.current?.render(0.016); } };
      document.documentElement.dataset.hero = '1';
    } else if (!reducedMotion) {
      tl.play();
    }
  }, [start]);

  return (
    <section
      ref={sectionRef}
      id="top"
      className="sticky top-0 z-0 h-svh overflow-hidden bg-mocha"
      aria-labelledby="hero-title"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_85%_at_50%_38%,#7d5a42_0%,#6f4e37_46%,#563b29_100%)]" />
      <div ref={stageRef} className="absolute inset-0 origin-[50%_75%] will-change-transform">
        <h1 id="hero-title" className="sr-only">Saima Ahmed, graphic designer</h1>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 font-display font-normal text-lavender">
          <Word
            text={WORDS[0]}
            wordRef={nameA}
            className="left-[4.5vw] top-[12svh] text-[21vw] tracking-[-0.01em] land:left-[5.5vw] land:top-[21svh] land:text-[11.5vw]"
          />
          <Word
            text={WORDS[1]}
            wordRef={nameB}
            className="right-[4.5vw] top-[calc(12svh_+_18.6vw)] text-[21vw] tracking-[-0.01em] land:right-[5.5vw] land:top-[52svh] land:text-[11.5vw]"
          />
        </div>
        <canvas ref={backRef} className="pointer-events-none absolute inset-0 block h-full w-full" aria-hidden="true" />
        <img
          ref={imgRef}
          src={PORTRAIT}
          srcSet={SRCSET}
          sizes="(min-aspect-ratio: 1/1) 46vh, 35vh"
          width="642"
          height="1200"
          alt="Saima Ahmed"
          decoding="async"
          fetchPriority="high"
          className="pointer-events-none absolute bottom-0 left-1/2 h-[66svh] w-auto max-w-none -translate-x-1/2 select-none opacity-0 land:left-[46%] land:h-[86svh]"
        />
        <canvas ref={frontRef} className="pointer-events-none absolute inset-0 block h-full w-full" aria-hidden="true" />
      </div>

      <div ref={uiRef} className="pointer-events-none absolute inset-0 text-lavender">
        <p className="hero-ui absolute left-[5.5vw] top-[11.5svh] hidden text-[10px] uppercase leading-[1.9] tracking-[0.32em] text-lavender/90 land:block short:hidden">
          Design<br />Create<br />Inspire
          <span className="mt-3 block h-px w-6 bg-lavender/60" />
        </p>
        <p className="hero-ui absolute right-[5.5vw] top-[35svh] hidden max-w-[15rem] text-[13px] leading-relaxed text-lavender/85 land:block short:hidden">
          Graphic designer crafting scroll-stopping posts, menus and campaigns for brands that want to be noticed.
          <span className="mt-4 block h-px w-6 bg-lavender/60" />
        </p>
        <button
          type="button"
          onClick={() => scrollToTarget('#work')}
          className="hero-ui pointer-events-auto absolute left-[5.5vw] top-[55svh] hidden items-center gap-4 text-left text-[10px] uppercase leading-[1.7] tracking-[0.3em] land:flex"
        >
          <span className="grid size-12 place-items-center rounded-full border border-lavender/50 transition-colors duration-500 hover:bg-lavender hover:text-mocha">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 2v12M3 9l5 5 5-5" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </span>
          Explore<br />the work
        </button>
      </div>
    </section>
  );
}
