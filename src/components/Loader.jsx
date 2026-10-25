import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { createLoaderScene } from '../three/loaderScene.js';

// The intro: a plain white screen, the plush bear walks in from the right, turns to look at you,
// and the camera dives into its mocha eye, which becomes the hero's background.
export default function Loader({ ready, progress, onReveal, onDone }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const veilRef = useRef(null);
  const uiRef = useRef(null);
  const sceneRef = useRef(null);
  const finished = useRef(false);
  const [shown, setShown] = useState(0);

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
    // the veil turns the screen mocha as the camera reaches the eye; the small print leaves as the
    // bear turns round
    const veil = () => {
      veilRef.current.style.opacity = String(st.fade);
      uiRef.current.style.opacity = String(1 - Math.min(1, st.turn * 1.6));
    };
    gsap.ticker.add(veil);
    scene.tl.eventCallback('onComplete', finish);
    const q = new URLSearchParams(location.search);
    scene.prepare().then(() => {
      if (q.has('t')) {
        scene.seek(parseFloat(q.get('t')));
        veil();
        window.__loader = { seek: (t) => { scene.seek(t); veil(); } };
        document.documentElement.dataset.ready = '1';
      } else {
        scene.play();
      }
    });
    const onResize = () => scene.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      gsap.ticker.remove(veil);
      scene.dispose();
    };
    // the loader runs once; its callbacks come from the parent's first render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready && sceneRef.current) sceneRef.current.setReady();
  }, [ready]);

  // the counter eases towards the real progress
  useEffect(() => {
    const o = { v: shown };
    const tw = gsap.to(o, { v: progress, duration: 0.6, ease: 'power2.out', onUpdate: () => setShown(o.v) });
    return () => tw.kill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const skip = () => {
    const scene = sceneRef.current;
    if (!scene || finished.current) return;
    scene.tl.pause();
    gsap.to(scene.state, {
      fade: 1, duration: 0.35, ease: 'power1.in',
      onUpdate: () => { veilRef.current.style.opacity = String(scene.state.fade); },
      onComplete: () => {
        finished.current = true;
        onReveal();
        gsap.to(rootRef.current, { autoAlpha: 0, duration: 0.7, ease: 'power2.inOut', onComplete: onDone });
      },
    });
  };

  return (
    <div ref={rootRef} className="fixed inset-0 z-50 bg-white" role="status" aria-label="Loading Saima Ahmed's portfolio">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
      <div ref={uiRef} className="pointer-events-none absolute inset-0 text-mocha">
        <p className="absolute left-5 top-5 font-display text-lg tracking-tight md:left-8 md:top-7 md:text-xl">
          Saima Ahmed
        </p>
        <p className="absolute bottom-5 left-5 text-[10px] uppercase tracking-[0.28em] md:bottom-7 md:left-8">
          Graphic designer
        </p>
        <p className="absolute bottom-5 right-5 font-display text-2xl tabular-nums md:bottom-7 md:right-8 md:text-3xl">
          {String(Math.round(shown)).padStart(2, '0')}
          <span className="ml-1 align-top text-xs">%</span>
        </p>
      </div>
      <button
        type="button"
        onClick={skip}
        className="absolute right-4 top-4 rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-mocha/70 transition hover:text-mocha md:right-7 md:top-6"
      >
        Skip intro
      </button>
      <div ref={veilRef} className="pointer-events-none absolute inset-0 bg-mocha opacity-0" />
    </div>
  );
}
