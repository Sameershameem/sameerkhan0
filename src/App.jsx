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
import { WORKS } from './data/works.js';
import { initScroll, lockScroll, reducedMotion, softwareGL, webgl } from './lib/scroll.js';

const query = new URLSearchParams(window.location.search);
// the bear's intro plays once per visit; reduced motion, no WebGL (or WebGL without a GPU) or a
// debug jump skip it
const forceIntro = query.has('intro') || query.has('t');
const skipIntro = reducedMotion || !webgl || (softwareGL && !forceIntro) || query.has('skip') || query.has('hero');

export default function App() {
  const [stage, setStage] = useState(skipIntro ? 'done' : 'intro');
  const [heroReady, setHeroReady] = useState(false);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    initScroll();
    if (!skipIntro) lockScroll(true);
    // the gallery's pin is created after the nav's markers, so put them in page order and measure
    // again once everything (and the type) is in place
    const refresh = () => {
      ScrollTrigger.sort();
      ScrollTrigger.refresh();
    };
    requestAnimationFrame(refresh);
    if (document.fonts) document.fonts.ready.then(refresh);
    window.addEventListener('load', refresh);
    return () => window.removeEventListener('load', refresh);
  }, []);

  const onHeroReady = useCallback(() => setHeroReady(true), []);
  // called while the veil covers the screen, so measuring the page again costs nothing visible
  const reveal = useCallback(() => {
    setStage('reveal');
    lockScroll(false);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0b1433');
    ScrollTrigger.refresh();
  }, []);
  const open = useCallback((i) => setViewing(i), []);
  const close = useCallback(() => setViewing(null), []);
  const step = useCallback((d) => setViewing((i) => (i + d + WORKS.length) % WORKS.length), []);

  useEffect(() => {
    if (skipIntro) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0b1433');
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
          heroReady={heroReady}
          onReveal={reveal}
          onDone={() => setStage('done')}
        />
      )}
    </>
  );
}
