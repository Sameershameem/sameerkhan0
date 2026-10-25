import { useCallback, useEffect, useState } from 'react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Loader from './components/Loader.jsx';
import Hero from './components/Hero.jsx';
import Nav from './components/Nav.jsx';
import About from './components/About.jsx';
import Work from './components/Work.jsx';
import Services from './components/Services.jsx';
import Contact from './components/Contact.jsx';
import Lightbox from './components/Lightbox.jsx';
import CursorTag from './components/CursorTag.jsx';
import { WORKS, workSrc } from './data/works.js';
import { initScroll, lockScroll, reducedMotion, webgl } from './lib/scroll.js';

const query = new URLSearchParams(window.location.search);
// the bear's intro plays once per visit; reduced motion, no WebGL or a debug jump skip it
const skipIntro = reducedMotion || !webgl || query.has('skip') || query.has('hero');

// what the intro waits for: the hero's portrait, the designs' first images and the type
function usePreload() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    const urls = ['saima/saima-1200.webp', ...WORKS.map((_, i) => workSrc(i, small ? 'card-sm' : 'card'))];
    const total = urls.length + 1;
    let done = 0;
    const tick = () => setProgress(Math.round((++done / total) * 100));
    urls.forEach((u) => {
      const img = new Image();
      img.onload = img.onerror = tick;
      img.src = u;
    });
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(tick, tick);
  }, []);
  return progress;
}

export default function App() {
  const [stage, setStage] = useState(skipIntro ? 'done' : 'intro');
  const [heroReady, setHeroReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [viewing, setViewing] = useState(null);
  const progress = usePreload();

  useEffect(() => {
    initScroll();
    if (!skipIntro) lockScroll(true);
    // never hold the bear in front of the camera for more than a few seconds
    const t = setTimeout(() => setTimedOut(true), 9000);
    // the gallery's pin is created after the nav's markers, so put them in page order and measure
    // again once everything (and the type) is in place
    const refresh = () => {
      ScrollTrigger.sort();
      ScrollTrigger.refresh();
    };
    requestAnimationFrame(refresh);
    if (document.fonts) document.fonts.ready.then(refresh);
    window.addEventListener('load', refresh);
    return () => {
      clearTimeout(t);
      window.removeEventListener('load', refresh);
    };
  }, []);

  const onHeroReady = useCallback(() => setHeroReady(true), []);
  const reveal = useCallback(() => {
    setStage('reveal');
    lockScroll(false);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#6f4e37');
    ScrollTrigger.refresh();
  }, []);
  const open = useCallback((i) => setViewing(i), []);
  const close = useCallback(() => setViewing(null), []);
  const step = useCallback((d) => setViewing((i) => (i + d + WORKS.length) % WORKS.length), []);

  useEffect(() => {
    if (skipIntro) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#6f4e37');
  }, []);

  return (
    <>
      <Nav show={stage !== 'intro'} />
      <main>
        <Hero start={stage !== 'intro'} onReady={onHeroReady} />
        <About />
        <Work onOpen={open} />
        <Services onOpen={open} />
        <Contact />
      </main>
      <Lightbox index={viewing} onClose={close} onStep={step} />
      <CursorTag />
      {stage !== 'done' && (
        <Loader
          ready={heroReady && (progress >= 100 || timedOut)}
          progress={progress}
          onReveal={reveal}
          onDone={() => setStage('done')}
        />
      )}
    </>
  );
}
