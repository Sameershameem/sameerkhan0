import { CONTACT, SITE } from '../data/site.js';
import { scrollToTarget } from '../lib/scroll.js';
import { RevealWords, Rise } from './Reveal.jsx';

export default function Contact() {
  const handle = CONTACT.instagram.replace(/^@/, '');
  const links = [
    CONTACT.email && { href: `mailto:${CONTACT.email}`, label: CONTACT.email },
    handle && { href: `https://instagram.com/${encodeURIComponent(handle)}`, label: `@${handle}`, external: true },
    CONTACT.phone && { href: `tel:${CONTACT.phone.replace(/[^\d+]/g, '')}`, label: CONTACT.phone },
  ].filter(Boolean);
  return (
    <footer id="contact" className="relative z-10 flex min-h-svh flex-col justify-between bg-night-deep px-[6vw] pb-8 pt-[16svh] text-ice land:px-[8vw]">
      <div>
        <p className="mb-10 text-[10px] uppercase tracking-[0.32em] text-ice/70">(05) — Contact</p>
        <RevealWords
          as="h2"
          className="font-display text-[13vw] leading-[0.98] tracking-[-0.02em] land:text-[8.2vw]"
          parts={[{ text: 'Let’s make something' }, { text: 'scroll-stopping.', em: true }]}
        />
        <Rise className="mt-[7svh] flex flex-col gap-4 land:flex-row land:items-center land:gap-12">
          {links.length ? (
            links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                {...(l.external ? { target: '_blank', rel: 'noopener' } : {})}
                className="w-fit font-display text-[7vw] leading-tight underline decoration-ice/40 decoration-1 underline-offset-[0.2em] transition-colors hover:decoration-ice land:text-[2.6vw]"
              >
                {l.label}
              </a>
            ))
          ) : (
            <p className="text-[11px] uppercase tracking-[0.3em] text-ice/70">Contact details coming soon</p>
          )}
        </Rise>
      </div>
      <div className="mt-[12svh] flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-t border-ice/20 pt-6 text-[10px] uppercase tracking-[0.3em] text-ice/70">
        <span>© {new Date().getFullYear()} {SITE.name}</span>
        {/* the credit sits between the two on wide screens, on its own line below them on narrow ones */}
        <span className="order-last w-full land:order-none land:w-auto">
          Designed and built by{' '}
          <a
            href="https://portfolio-psi-inky-18.vercel.app"
            target="_blank"
            rel="noopener"
            className="-my-2 inline-block py-2 text-ice underline decoration-ice/40 decoration-1 underline-offset-[0.35em] transition-colors hover:decoration-ice"
          >
            Sameer Shameem
          </a>
        </span>
        <button type="button" onClick={() => scrollToTarget(0, 2)} className="transition-colors hover:text-ice">
          Back to top ↑
        </button>
      </div>
    </footer>
  );
}
