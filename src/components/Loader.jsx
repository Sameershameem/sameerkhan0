import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { createLoaderScene } from '../three/loaderScene.js';
import { WORKS, workSrc } from '../data/works.js';
import { SITE } from '../data/site.js';

// what the dive waits for: the hero's portrait, the projects' first images and the type
function preload(onProgress) {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const urls = [SITE.portrait.src, ...WORKS.map((_, i) => workSrc(i, small ? 'card-sm' : 'card'))];
  const total = urls.length + 1;
  let done = 0;
  const tick = () => onProgress(++done / total);
  urls.forEach((u) => {
    const img = new Image();
    img.onload = img.onerror = tick;
    img.src = u;
  });
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(tick, tick);
}

// The intro: a plain white screen, the plush bear walks in from the right, turns to look at you,
// waves, and the camera dives into its eye, and the screen turns to the hero's midnight.
export default function Loader({ heroReady, onReveal, onDone }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const veilRef = useRef(null);
  const uiRef = useRef(null);
  const countRef = useRef(null);
  const sceneRef = useRef(null);
  const heroRef = useRef(() => {});
  const leaveRef = useRef(() => {});
  const finished = useRef(false);

  useEffect(() => {
    const finish = () => {
      if (finished.current) return;
      finished.current = true;
      onReveal();
      gsap.to(rootRef.current, { autoAlpha: 0, duration: 0.9, ease: 'power2.inOut', onComplete: onDone });
    };
    let scene;
    try {
      const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
      scene = createLoaderScene(canvasRef.current, { mobile });
    } catch {
      finish();
      return undefined;
    }
    sceneRef.current = scene;
    const st = scene.state;
    // straight to the hero (skipped, or a GPU too slow for a smooth bear): the screen turns midnight,
    // then the loader fades away
    const leave = () => {
      if (finished.current) return;
      scene.tl.pause();
      gsap.to(st, {
        fade: 1, duration: 0.35, ease: 'power1.in',
        onComplete: () => {
          finished.current = true;
          onReveal();
          gsap.to(rootRef.current, { autoAlpha: 0, duration: 0.7, ease: 'power2.inOut', onComplete: onDone });
        },
      });
    };
    leaveRef.current = leave;
    // the veil turns the screen midnight as the camera reaches the eye; the small print leaves as the
    // bear turns round
    const veil = () => {
      veilRef.current.style.opacity = String(st.fade);
      uiRef.current.style.opacity = String(1 - Math.min(1, st.turn * 1.6));
    };
    gsap.ticker.add(veil);
    scene.tl.eventCallback('onComplete', finish);

    // the counter eases towards what has loaded; the dive waits for it and for the hero, but never
    // for long
    const shown = { v: 0 };
    let loaded = false;
    let timedOut = false;
    let hero = false;
    const release = () => {
      if (hero && (loaded || timedOut)) scene.setReady();
    };
    preload((p) => {
      gsap.to(shown, {
        v: p * 100, duration: 0.6, ease: 'power2.out', overwrite: true,
        onUpdate: () => { countRef.current.textContent = String(Math.round(shown.v)).padStart(2, '0'); },
      });
      if (p >= 1) {
        loaded = true;
        release();
      }
    });
    const dive = setTimeout(() => {
      timedOut = true;
      release();
    }, 9000);

    // the walk starts once the heavy work is done (the shaders compiled, the quality picked and the
    // hero set up behind the loader, or a few seconds at most), so nothing interrupts it
    const q = new URLSearchParams(location.search);
    let prepared = false;
    let started = false;
    let waited = false;
    const begin = async () => {
      if (started || !prepared || !(hero || waited)) return;
      started = true;
      // a GPU that can't draw even the lightest bear smoothly goes straight to the hero
      // (?q=<tier> picks the quality instead, for testing)
      const smooth = await scene.tune(q.has('q') ? parseInt(q.get('q'), 10) : undefined);
      if (finished.current) return;
      if (smooth) scene.play();
      else leave();
    };
    const wait = setTimeout(() => {
      waited = true;
      begin();
    }, 3000);
    heroRef.current = () => {
      hero = true;
      release();
      begin();
    };
    scene.prepare().then(async () => {
      if (q.has('t')) {
        // debug: hold the intro at a given second, at full quality
        await scene.tune(0);
        scene.seek(parseFloat(q.get('t')));
        veil();
        window.__loader = { seek: (t) => { scene.seek(t); veil(); } };
        document.documentElement.dataset.ready = '1';
        return;
      }
      prepared = true;
      begin();
    });

    const onResize = () => scene.resize();
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(dive);
      clearTimeout(wait);
      window.removeEventListener('resize', onResize);
      gsap.ticker.remove(veil);
      gsap.killTweensOf(shown);
      scene.dispose();
    };
    // the loader runs once; its callbacks come from the parent's first render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (heroReady) heroRef.current();
  }, [heroReady]);

  return (
    <div ref={rootRef} className="fixed inset-0 z-50 bg-white" role="status" aria-label="Loading the portfolio">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
      <div ref={uiRef} className="pointer-events-none absolute inset-0 text-night">
        <p className="absolute left-5 top-5 font-display text-lg tracking-tight md:left-8 md:top-7 md:text-xl">
          {SITE.name}
        </p>
        <p className="absolute bottom-5 left-5 text-[10px] uppercase tracking-[0.28em] md:bottom-7 md:left-8">
          Portfolio
        </p>
        <p className="absolute bottom-5 right-5 font-display text-2xl tabular-nums md:bottom-7 md:right-8 md:text-3xl">
          <span ref={countRef}>00</span>
          <span className="ml-1 align-top text-xs">%</span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => leaveRef.current()}
        className="absolute right-4 top-4 rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-night/70 transition hover:text-night md:right-7 md:top-6"
      >
        Skip intro
      </button>
      <div ref={veilRef} className="pointer-events-none absolute inset-0 bg-night opacity-0" />
    </div>
  );
}
