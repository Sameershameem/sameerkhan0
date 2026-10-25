import { useEffect, useRef } from 'react';
import gsap from 'gsap';

// Words that rise into place one after another as they scroll into view.
// parts: [{ text, em }] — em parts are set in italic.
export function RevealWords({ parts, as: Tag = 'p', className = '', delay = 0 }) {
  const ref = useRef(null);
  useEffect(() => {
    const words = ref.current.querySelectorAll('.rw');
    gsap.set(words, { yPercent: 115 });
    const tw = gsap.to(words, {
      yPercent: 0,
      duration: 1.15,
      stagger: 0.045,
      ease: 'expo.out',
      delay,
      scrollTrigger: { trigger: ref.current, start: 'top 85%', once: true },
    });
    return () => { tw.scrollTrigger?.kill(); tw.kill(); };
  }, [delay]);
  let n = 0;
  return (
    <Tag ref={ref} className={className}>
      {parts.map((p, i) => (
        <span key={i} className={p.em ? 'italic' : undefined}>
          {p.text.split(' ').map((w) => (
            <span key={n++} className="inline-block overflow-hidden pb-[0.08em] align-top">
              <span className="rw inline-block">{w}&nbsp;</span>
            </span>
          ))}
        </span>
      ))}
    </Tag>
  );
}

// Fades and lifts its children in when they scroll into view
export function Rise({ children, className = '', y = 30, delay = 0, as: Tag = 'div' }) {
  const ref = useRef(null);
  useEffect(() => {
    const tw = gsap.fromTo(ref.current, { autoAlpha: 0, y }, {
      autoAlpha: 1, y: 0, duration: 1.1, ease: 'power3.out', delay,
      scrollTrigger: { trigger: ref.current, start: 'top 88%', once: true },
    });
    return () => { tw.scrollTrigger?.kill(); tw.kill(); };
  }, [y, delay]);
  return <Tag ref={ref} className={className}>{children}</Tag>;
}
