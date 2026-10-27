# Portfolio Template

A one-page portfolio for a designer, art director or any creative, built with React, Vite and
Tailwind CSS, with three.js for the 3D:

- **Intro:** on a plain white screen a plush teddy (shaggy blue shark hood, white felt teeth, fish on
  the belly) walks in from the right, stops in the middle, turns to look at you and waves, and the
  camera dives into its glossy bead eye as the screen turns to midnight. The fur is drawn in layers of
  strands gathered into tufts; the quality adapts to the GPU so the intro always runs smoothly, and
  devices that can't draw it smoothly go straight to the hero.
- **Hero:** a swirl of starlight gathers into the portrait under a glowing moon, the name sits behind
  it in two big words, and liquid chrome wraps round it.
- **The rest:** About with animated counts and a client marquee, a pinned horizontal gallery of
  projects with a full-size viewer, Services with hover previews, and Contact.

Palette: Midnight `#0B1433`, Deep midnight `#070D24`, Mist `#E4E9F4`, Ice `#EDF1FB`,
Electric blue `#6D97FF` (set in `src/index.css`).

## Run it

```bash
npm install
npm run dev       # local dev server
npm run build     # production build in dist/
npm run preview   # serve the build
```

## Make it yours

| What | Where |
| --- | --- |
| Name, role, hero pitch and motto, About heading and intro | `SITE` in `src/data/site.js` |
| Contact details (email, Instagram, phone) | `CONTACT` in `src/data/site.js` |
| Services list | `SERVICES` in `src/data/site.js` |
| Projects: title, client, type, aspect | `src/data/works.js` |
| Project images | `public/work/{card-sm,card,full}/NN.webp` (512, 768 and 1600 px wide) |
| Hero portrait (a cut-out with a transparent background) | `public/model/`, listed in `SITE.portrait` |
| Colours | the `@theme` block in `src/index.css` |

The sample portrait is AI-generated and shows no real person; the sample project images are
abstract artwork generated in code. Replace both with your own.

## Deploy

`npm run build` writes a static site to `dist/` with relative paths, so it can be hosted from any
folder on any static host. On GitHub Pages, set **Settings → Pages → Source** to **GitHub Actions**
and use a workflow that runs `npm ci && npm run build` and uploads `dist/`.
