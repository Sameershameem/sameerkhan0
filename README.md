# Saima Ahmed — Portfolio

A one-page portfolio for Saima Ahmed, graphic designer, built with React, Vite and Tailwind CSS, with
three.js for the 3D:

- **Intro:** on a plain white screen a plush teddy (shaggy blue shark hood, white felt teeth, fish on
  the belly) walks in from the right, stops in the middle, turns to look at you and waves, and the
  camera dives into its mocha bead eye. The fur is drawn in layers of strands gathered into tufts;
  the quality adapts to the GPU so the intro always runs smoothly, and devices that can't draw it
  smoothly go straight to the hero.
- **Hero:** the iris breaks into particles that gather into Saima's portrait, her name sits behind her,
  and liquid chrome wraps round her.
- **The rest:** About, a pinned horizontal gallery of her designs with a full-size viewer, Services
  and Contact.

Palette: Mocha Brown `#6F4E37`, Platinum Silver `#E5E4E2`, Pale Lavender `#E6E0F0`.

## Run it

```bash
npm install
npm run dev       # local dev server
npm run build     # production build in dist/
npm run preview   # serve the build
```

## Edit the content

| What | Where |
| --- | --- |
| Designs: title, client, type, aspect | `src/data/works.js` |
| Design images | `public/work/{card-sm,card,full}/NN.webp` (512, 768 and up to 1600 px wide) |
| Contact details (email, Instagram, phone) | `CONTACT` in `src/data/site.js` |
| Services list | `SERVICES` in `src/data/site.js` |
| Portrait | `public/saima/saima-{1200,1600,2000,2600}.webp` |

## Deploy

`npm run build` writes a static site to `dist/` with relative paths, so it can be hosted from any
folder on any static host. On GitHub Pages, set **Settings → Pages → Source** to **GitHub Actions**
and use a workflow that runs `npm ci && npm run build` and uploads `dist/`.
