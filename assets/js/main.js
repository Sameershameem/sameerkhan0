import * as THREE from '../vendor/three.module.min.js';
import { createMusic } from './music.js';

const gsap = window.gsap;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const { lerp, clamp, smoothstep } = THREE.MathUtils;
const TAU = Math.PI * 2;

THREE.ColorManagement.enabled = false;

// backdrop photo: size variants (px wide), aspect, and the point that stays in view when cropped
const BG_WIDTHS = [1600, 2560, 3840];
const BG_ASPECT = 1.5;
const BG_POS = { x: 0.5, y: 0.3 }; // like CSS object-position, y from the top
const BG_FOCUS = { x: 0.5, y: 0.68 }; // zoom anchor (the hill crest), y from the bottom
const pad2 = (n) => String(n).padStart(2, '0');
const cardSrc = (i) => `assets/img/work/card/${pad2(i + 1)}.webp`;
const fullSrc = (i) => `assets/img/work/full/${pad2(i + 1)}.webp`;

// The designs, in order, from the JSON in index.html: title, client, type, aspect, field colour, ink.
const WORKS = (() => {
  try { return JSON.parse($('#works').textContent); } catch { return []; }
})();
const PHOTOS = WORKS.length;

const query = new URLSearchParams(location.search);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// The intro plays like the reference: a rainbow arc of reels and its page first, then it rewinds
// to the loader and builds a ring the camera flies into, which is where the page stays.
const intro = { tl: null, switchAt: Infinity };
const phase = { ring: false };

// No WebGL: show the photos as a simple scrolling strip instead of the 3D scene.
function fallback() {
  document.body.classList.add('no-webgl');
  const strip = document.createElement('div');
  strip.className = 'fallback';
  WORKS.forEach((w, i) => {
    const img = new Image();
    img.src = cardSrc(i);
    img.alt = w.client ? `${w.title}, ${w.client}` : w.title;
    img.loading = 'lazy';
    strip.appendChild(img);
  });
  $('.hero').appendChild(strip);
  $('.brand-word').style.visibility = 'visible';
  gsap.set(['.brand-dot', '.sound', '.role'], { opacity: 1 });
  document.documentElement.classList.remove('is-locked');
  renderContact();
  drawDoodles();
  $$('.reveal').forEach((el) => el.classList.add('is-in'));
}

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

const canvas = $('#stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  fallback();
  throw err;
}
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = false;
renderer.setClearColor(0xf8f8f6, 1);
const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

const bgPlaceholder = new THREE.DataTexture(new Uint8Array([120, 170, 220, 255]), 1, 1);
bgPlaceholder.needsUpdate = true;
const bg = { tex: null };

const view = { w: 1, h: 1, dpr: 1 };
const panel = { t: 0, r: 0, b: 0, l: 0 };
const frame = { x: 0, y: 0, w: 1, h: 1 };
const fx = { reveal: 0, inset: 0, zoom: 1.06, shift: 0 };

/* ---------- background: hills photo + drifting petals (pixel space) ---------- */

const bgScene = new THREE.Scene();
const bgCam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);

const bgMat = new THREE.ShaderMaterial({
  uniforms: {
    uBg: { value: bgPlaceholder },
    uImgAspect: { value: BG_ASPECT },
    uPos: { value: new THREE.Vector2(BG_POS.x, BG_POS.y) },
    uFocus: { value: new THREE.Vector2(BG_FOCUS.x, BG_FOCUS.y) },
    uReveal: { value: 0 },
    uZoom: { value: 1.06 },
    uShift: { value: 0 },
    uPaper: { value: new THREE.Vector3(0.973, 0.973, 0.965) },
    uView: { value: new THREE.Vector2(1, 1) },
    uFrame: { value: new THREE.Vector4(0, 0, 1, 1) },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uTintAmt: { value: 0 },
    uGlow: { value: new THREE.Vector3(0.5, 0.5, 0.3) }, // centre (uv) and radius (screen heights)
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D uBg;
    uniform float uImgAspect;
    uniform vec2 uPos;
    uniform vec2 uFocus;
    uniform float uReveal;
    uniform float uZoom;
    uniform float uShift; // in screen heights: the photo slides down so open sky fills the view
    uniform vec3 uPaper;
    uniform vec2 uView;
    uniform vec4 uFrame; // x, y (from bottom), w, h in css px
    uniform vec3 uTint;
    uniform float uTintAmt;
    uniform vec3 uGlow;
    varying vec2 vUv;
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      // the photo covers uFrame like object-fit: cover (uv y up)
      vec2 p = vUv * uView - uFrame.xy;
      vec2 disp = vec2(max(uFrame.z, uFrame.w * uImgAspect));
      disp.y = disp.x / uImgAspect;
      vec2 off = (uFrame.zw - disp) * vec2(uPos.x, 1.0 - uPos.y);
      vec2 uv = (p - off) / disp;
      uv.y += uShift * uFrame.w / disp.y;
      uv = (uv - uFocus) / uZoom + uFocus;
      // negative lod bias keeps the grass crisp when the photo is drawn smaller than its pixels
      vec3 bgCol = texture2D(uBg, vec2(uv.x, 1.0 - uv.y), -0.5).rgb;
      // above the photo's top edge the sky carries on, softly blurred and a touch deeper
      if (uv.y > 0.97) {
        vec3 top = texture2D(uBg, vec2(uv.x, 0.006), 5.0).rgb;
        vec3 upper = mix(top, top * vec3(0.8, 0.88, 0.96), smoothstep(1.0, 1.8, uv.y));
        bgCol = mix(bgCol, upper, smoothstep(0.975, 1.0, uv.y));
      }
      // soft bloom outward from the middle of the scene
      float d = length(vUv - vec2(0.5, 0.42));
      float e = uReveal * 1.45;
      float m = 1.0 - smoothstep(e - 0.4, e, d);
      m *= smoothstep(0.0, 0.08, uReveal);
      vec3 col = mix(uPaper, bgCol, m);
      if (uTintAmt > 0.001) {
        vec2 dv = (vUv - uGlow.xy) * vec2(uView.x / uView.y, 1.0);
        float g = exp(-dot(dv, dv) / max(1e-4, uGlow.z * uGlow.z * 2.2));
        vec3 field = mix(uTint * 0.84, mix(uTint, vec3(1.0), 0.22), g);
        col = mix(col, field, uTintAmt);
      }
      // a little grain keeps the large gradients from banding
      col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
});
const bgQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat);
bgScene.add(bgQuad);


const PETAL_COLORS = ['#ffffff', '#f6b26b', '#fbe3b5', '#e8456b', '#ffffff', '#f5b700', '#ffd3dc'];
const petalCount = matchMedia('(max-width: 720px)').matches ? 16 : 28;
const petalGeo = new THREE.BufferGeometry();
petalGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 0, 0.42, 0.1, 0, 0, -1, 0, -0.42, -0.1, 0], 3));
petalGeo.setIndex([0, 1, 2, 0, 2, 3]);
const petalColors = new Float32Array(petalCount * 3);
const petals = Array.from({ length: petalCount }, (_, i) => {
  const c = new THREE.Color(PETAL_COLORS[i % PETAL_COLORS.length]);
  petalColors.set([c.r, c.g, c.b], i * 3);
  return {
    x: Math.random(), y: Math.random(),
    vx: -(0.004 + Math.random() * 0.012), vy: 0.002 + Math.random() * 0.008,
    size: 2.2 + Math.random() * 3.2,
    rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 1.6,
    ph: Math.random() * TAU, vf: 1.5 + Math.random() * 3,
    sway: Math.random() * TAU,
  };
});
petalGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(petalColors, 3));
const petalMat = new THREE.ShaderMaterial({
  uniforms: { uAlpha: { value: 0 } },
  vertexShader: /* glsl */`
    attribute vec3 aColor;
    varying vec3 vColor;
    void main() { vColor = aColor; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform float uAlpha;
    varying vec3 vColor;
    void main() { gl_FragColor = vec4(vColor, uAlpha * 0.9); }
  `,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const petalMesh = new THREE.InstancedMesh(petalGeo, petalMat, petalCount);
petalMesh.frustumCulled = false;
bgScene.add(petalMesh);
const tmpObj = new THREE.Object3D();

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 500);

// a card's height is its width times its design's aspect (1 for square posts, 1.25 for 4:5)
const aspectOf = (i) => (WORKS[i] && WORKS[i].aspect) || 1;

const cardVertex = /* glsl */`
  uniform float uHover;
  uniform float uLift;
  uniform float uBend;   // 1 = curved to sit on the ring, 0 = flat
  uniform float uBendR;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    float a = p.x / uBendR;
    p = mix(p, vec3(uBendR * sin(a), p.y, uBendR * (1.0 - cos(a))), uBend);
    p.z += uHover * uLift;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const cardFragment = /* glsl */`
  uniform sampler2D uMap;
  uniform float uLoaded;
  uniform vec2 uSize;
  uniform float uRadius;
  uniform float uOpacity;
  uniform float uHover;
  varying vec2 vUv;
  float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float d = sdRoundRect(p, uSize * 0.5, uRadius);
    float aa = max(fwidth(d), 1e-4);
    float a = 1.0 - smoothstep(-aa, aa, d);
    if (a < 0.004) discard;
    vec2 uv = vec2(gl_FrontFacing ? vUv.x : 1.0 - vUv.x, 1.0 - vUv.y);
    vec3 tex = texture2D(uMap, uv).rgb;
    vec3 ph = mix(vec3(0.80, 0.79, 0.76), vec3(0.88, 0.87, 0.84), vUv.y);
    vec3 col = mix(ph, tex, uLoaded);
    if (!gl_FrontFacing) col *= 0.8;
    col = mix(col, col * 1.06 + 0.03, uHover);
    gl_FragColor = vec4(col, a * uOpacity);
  }
`;

const blankTex = new THREE.DataTexture(new Uint8Array([200, 198, 194, 255]), 1, 1);
blankTex.needsUpdate = true;
const photoTex = Array(PHOTOS).fill(null);
const cards = [];

function makeCardMaterial(size) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: blankTex },
      uLoaded: { value: 0 },
      uSize: { value: new THREE.Vector2(size.x, size.y) },
      uRadius: { value: size.x * 0.035 },
      uOpacity: { value: 1 },
      uHover: { value: 0 },
      uLift: { value: size.x * 0.08 },
      uBend: { value: 0 },
      uBendR: { value: 10 },
    },
    vertexShader: cardVertex,
    fragmentShader: cardFragment,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

// a soft shadow under each card once it lies flat (in the reel and the work wheel)
const SHADOW_PAD = 1.5;
const shadowVertex = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const shadowFragment = /* glsl */`
  uniform vec2 uSize;
  uniform float uRadius;
  uniform float uAlpha;
  varying vec2 vUv;
  float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void main() {
    vec2 p = (vUv - 0.5) * uSize * ${SHADOW_PAD.toFixed(2)};
    float soft = uSize.x * 0.12;
    float d = sdRoundRect(p, uSize * 0.5 - soft * 0.3, uRadius);
    float a = 1.0 - smoothstep(-soft, soft, d);
    gl_FragColor = vec4(0.04, 0.02, 0.05, a * a * uAlpha);
  }
`;
function makeShadow(w, h) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w * SHADOW_PAD, h * SHADOW_PAD),
    new THREE.ShaderMaterial({
      uniforms: { uSize: { value: new THREE.Vector2(w, h) }, uRadius: { value: w * 0.035 }, uAlpha: { value: 0 } },
      vertexShader: shadowVertex,
      fragmentShader: shadowFragment,
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.position.set(0, -h * 0.07, -0.08);
  mesh.renderOrder = -1;
  return mesh;
}

/* ---------- Arc (rainbow) ---------- */
const ARC = { N: 30 };
const arcGroup = new THREE.Group();
const arcState = { t: 0, spin: 0, speed: 0, user: 0 };

/* ---------- Ring (carousel you fly into): one card per design ---------- */
const RING = { N: PHOTOS, R: 10 };
RING.w = ((TAU * RING.R) / RING.N) * 0.86;
RING.h = RING.w; // a square card's height; poses size cards by it
const ringGroup = new THREE.Group();
const ringState = { t: 0, spin: 0, speed: 0, user: 0, build: 0 };

const arcCards = [];
const ringCards = [];
{
  const geos = {};
  for (let i = 0; i < ARC.N; i++) {
    const asp = aspectOf(i % PHOTOS);
    const geo = geos[asp] || (geos[asp] = new THREE.PlaneGeometry(1, asp));
    const mat = makeCardMaterial(new THREE.Vector2(1, asp));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.order = 'ZYX';
    mesh.visible = false;
    const rank = Math.min(i, ARC.N - i);
    const card = { mesh, mat, photo: i % PHOTOS, theta: (i / ARC.N) * TAU, rank, side: i <= ARC.N / 2 ? 1 : -1, p: 0, hover: 0 };
    mesh.userData.card = card;
    arcCards.push(card);
    arcGroup.add(mesh);
  }
  scene.add(arcGroup);
}
{
  const geos = {};
  const step = TAU / RING.N;
  for (let i = 0; i < RING.N; i++) {
    const asp = aspectOf(i);
    const geo = geos[asp] || (geos[asp] = new THREE.PlaneGeometry(RING.w, RING.w * asp, 24, 1));
    const mat = makeCardMaterial(new THREE.Vector2(RING.w, RING.w * asp));
    mat.uniforms.uOpacity.value = 0;
    mat.uniforms.uBend.value = 1;
    mat.uniforms.uBendR.value = RING.R;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    // build starts at the front-right and runs right -> back -> left -> front
    const phi = (3 * Math.PI) / 4 - i * step;
    const shadow = makeShadow(RING.w, RING.w * asp);
    mesh.add(shadow);
    const card = { mesh, mat, shadow, photo: i, aspect: asp, phi, order: i, p: 0, hover: 0 };
    mesh.userData.card = card;
    ringCards.push(card);
    ringGroup.add(mesh);
  }
  scene.add(ringGroup);
}
cards.push(...arcCards, ...ringCards);

/* ---------- textures (decoded off the main thread when possible) ---------- */

const TO_LOAD = PHOTOS + 1; // reels + backdrop
let loadedCount = 0;
let allLoaded = false;
const loadWaiters = [];
function onAllLoaded(fn) { allLoaded ? fn() : loadWaiters.push(fn); }

function prepTexture(tex) {
  tex.flipY = false;
  tex.anisotropy = maxAniso;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
function applyTexture(i, tex) {
  renderer.initTexture(prepTexture(tex));
  photoTex[i] = tex;
  for (const c of cards) {
    if (c.photo !== i || c.hi) continue;
    c.mat.uniforms.uMap.value = tex;
    gsap.to(c.mat.uniforms.uLoaded, { value: 1, duration: 0.45, ease: 'power2.out' });
  }
}
function markLoaded() {
  loadedCount++;
  if (loadedCount >= TO_LOAD && !allLoaded) {
    allLoaded = true;
    loadWaiters.splice(0).forEach((fn) => fn());
  }
}
// Photo URLs, sized for this screen, and their early downloads come from the inline script in index.html.
const assets = window.__siteAssets || {
  cards: Array.from({ length: PHOTOS }, (_, i) => cardSrc(i)),
  bg: 'assets/img/bg/hills-2560.webp',
  bgWidth: 2560,
  pre: {},
};

function fetchBlob(url, fresh) {
  const early = !fresh && assets.pre[url];
  return early || fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status} ${url}`))));
}

// decoded off the main thread where the browser can
async function decodeImage(url, fresh = false) {
  const blob = await fetchBlob(url, fresh);
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob); } catch { /* decode through an <img> instead */ }
  }
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  URL.revokeObjectURL(img.src);
  return img;
}
// an early download that failed gets one fresh try
const loadImage = (url) => decodeImage(url).catch(() => decodeImage(url, true));

function applyBackdrop(tex) {
  tex.flipY = false;
  tex.anisotropy = 1; // drawn flat to the screen, so anisotropic filtering would only cost time
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  bg.tex = tex;
  bgMat.uniforms.uBg.value = tex;
  bgMat.uniforms.uImgAspect.value = tex.image.width / tex.image.height;
}

let cardsLoaded = 0;
const cardWaiters = [];
function onCardsLoaded(fn) { cardsLoaded >= PHOTOS ? fn() : cardWaiters.push(fn); }
function cardDone() {
  cardsLoaded++;
  if (cardsLoaded >= PHOTOS) cardWaiters.splice(0).forEach((fn) => fn());
  markLoaded();
}

function loadTextures() {
  // a GPU that can't hold the chosen backdrop gets the largest one it can
  const maxTex = renderer.capabilities.maxTextureSize;
  const bgUrl = assets.bgWidth <= maxTex
    ? assets.bg
    : `assets/img/bg/hills-${BG_WIDTHS.filter((w) => w <= maxTex).pop() || BG_WIDTHS[0]}.webp`;
  assets.cards.forEach((url, i) => {
    loadImage(url).then((img) => applyTexture(i, new THREE.Texture(img))).catch(() => {}).finally(cardDone);
  });
  loadImage(bgUrl).then((img) => applyBackdrop(new THREE.Texture(img))).catch(() => {}).finally(markLoaded);
}

// The design in focus on the work wheel, and its neighbours, swap to sharper textures so their type
// stays crisp: the full-size file where the design is drawn large, the 768 px card elsewhere.
const hiRes = new Map(); // design index -> { tex, dropped }
function focusSrc(i) {
  const px = work.Ha * ((view.h - panel.t) / 10) * view.dpr;
  return px > 800 ? fullSrc(i) : cardSrc(i);
}
function wantHiRes(i) {
  if (hiRes.has(i)) return;
  const url = focusSrc(i);
  if (url === assets.cards[i]) return; // the card texture is already sharp enough
  const entry = { tex: null, dropped: false };
  hiRes.set(i, entry);
  loadImage(url).then((img) => {
    if (entry.dropped) { if (img.close) img.close(); return; }
    entry.tex = prepTexture(new THREE.Texture(img));
    renderer.initTexture(entry.tex);
    const c = ringCards[i];
    if (c) { c.mat.uniforms.uMap.value = entry.tex; c.hi = true; }
  }).catch(() => hiRes.delete(i));
}
function dropHiRes(i) {
  const entry = hiRes.get(i);
  if (!entry) return;
  entry.dropped = true;
  hiRes.delete(i);
  const c = ringCards[i];
  if (c) { c.mat.uniforms.uMap.value = photoTex[i] || blankTex; c.hi = false; }
  if (entry.tex) {
    entry.tex.dispose();
    if (entry.tex.image && entry.tex.image.close) entry.tex.image.close();
  }
}
function updateHiRes() {
  const on = phase.ring && scroll.w > 0.35 && scroll.f < 0.5;
  const center = Math.round(scroll.act);
  for (const i of [...hiRes.keys()]) if (!on || Math.abs(i - center) > 1) dropHiRes(i);
  if (!on) return;
  wantHiRes(center);
  if (center > 0) wantHiRes(center - 1);
  if (center < PHOTOS - 1) wantHiRes(center + 1);
}

// full-size designs for the viewer, fetched one at a time in the background once the intro is done
function preloadFullPhotos() {
  const c = navigator.connection;
  if (c && (c.saveData || /2g/.test(c.effectiveType || ''))) return;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 120));
  let i = 0;
  const next = () => {
    if (i >= PHOTOS) return;
    const img = new Image();
    img.fetchPriority = 'low';
    img.onload = img.onerror = () => idle(next);
    img.src = fullSrc(i++);
  };
  idle(next);
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

// World units: the frame (the rect the scene is composed for) is 10 units tall at z = 0.
const CAM_FOV = 30;
const CAM_DIST = 5 / Math.tan(THREE.MathUtils.degToRad(CAM_FOV / 2));

const layout = { arcFrom: null, arcTo: null, ringFrom: null, ringTo: null };

function arcLoaderPose(fa) {
  const W = 10 * fa;
  const land = smoothstep(fa, 0.9, 1.7);
  const R = Math.min(5.5, 0.37 * W);
  const spacing = (TAU * R) / ARC.N;
  const cw = spacing * 1.14;
  const yc = lerp(-0.7, -5, land);
  return { R, cw, yc, tilt: 0, lean: 0, x: 0 };
}
function arcFinalPose(fa) {
  // a crown of reels: the ring's centre sits below the panel, its top leans away
  const land = smoothstep(fa, 0.7, 2.6);
  const R = lerp(9, 20, land);
  const spacing = (TAU * R) / ARC.N;
  return {
    R,
    cw: spacing * lerp(0.92, 0.85, land),
    yc: lerp(-8.4, -15, land),
    tilt: lerp(0.4, 0.5, land),
    lean: lerp(0.3, 0.32, land),
    x: 0,
  };
}

function ringLoaderPose(fa) {
  const R = RING.R;
  const land = smoothstep(fa, 0.8, 1.8);
  const fill = lerp(0.84, 0.46, land);
  const halfH = Math.tan(THREE.MathUtils.degToRad(CAM_FOV / 2));
  const dist = Math.max((2 * R) / (fill * 2 * halfH * fa), (1.45 * R) / (0.62 * 2 * halfH));
  const el = THREE.MathUtils.degToRad(27);
  return {
    pos: new THREE.Vector3(0, Math.sin(el) * dist, Math.cos(el) * dist),
    target: new THREE.Vector3(0, -R * 0.04, 0),
    fov: CAM_FOV,
    roll: THREE.MathUtils.degToRad(-5),
  };
}
function ringFinalPose(fa) {
  const R = RING.R;
  const land = smoothstep(fa, 0.7, 2.4);
  // landscape: pulled back towards the near wall so the side reels loom large (a tunnel);
  // portrait: from the centre, a few big reels curving away
  const fov = lerp(80, 77, land);
  return {
    pos: new THREE.Vector3(0, 0, R * lerp(0.05, 0.3, land)),
    target: new THREE.Vector3(0, 0, -R),
    fov,
    roll: 0,
  };
}

function measure() {
  view.w = Math.max(1, canvas.clientWidth);
  view.h = Math.max(1, canvas.clientHeight);
  // phones get their full pixel density so the photos stay sharp; big screens cap at 2x
  view.dpr = Math.min(window.devicePixelRatio || 1, view.w * view.h < 600000 ? 3 : 2);
  // resizing the drawing buffer clears it, so only do it when the size really changed
  const size = renderer.getSize(new THREE.Vector2());
  if (renderer.getPixelRatio() !== view.dpr || size.x !== view.w || size.y !== view.h) {
    renderer.setPixelRatio(view.dpr);
    renderer.setSize(view.w, view.h, false);
  }

  // the scene stays full-bleed; once framed, it is composed in the space below the nav
  panel.l = panel.r = panel.b = 0;
  panel.t = $('.nav').offsetHeight;

  const fa = (view.w - panel.l - panel.r) / Math.max(1, view.h - panel.t - panel.b);
  const fa0 = view.w / view.h;
  layout.arcFrom = arcLoaderPose(fa0);
  layout.arcTo = arcFinalPose(fa);
  layout.ringFrom = ringLoaderPose(fa0);
  layout.ringTo = ringFinalPose(fa);
  measureStrip();

  bgCam.right = view.w;
  bgCam.top = view.h;
  bgCam.updateProjectionMatrix();
  bgQuad.position.set(view.w / 2, view.h / 2, 0);
  bgQuad.scale.set(view.w, view.h, 1);
}

let decorTimer = 0;
function resize() {
  measure();
  applyInset();
  measureScroll();
  clearTimeout(decorTimer);
  decorTimer = setTimeout(() => { drawDoodles(); buildMarquee(); }, 120);
}

function applyInset() {
  const p = fx.inset;
  const t = panel.t * p, r = panel.r * p, b = panel.b * p, l = panel.l * p;
  frame.x = l;
  frame.y = t;
  frame.w = view.w - l - r;
  frame.h = view.h - t - b;
}

/* ------------------------------------------------------------------ */
/* Per-frame scene update                                              */
/* ------------------------------------------------------------------ */

const pointer = { x: 0, y: 0, sx: 0, sy: 0, px: -1, py: -1, inside: false };
const lookTarget = new THREE.Vector3();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();

function lerpPose(a, b, t) {
  const out = {};
  for (const k in a) out[k] = lerp(a[k], b[k], t);
  return out;
}

const easeInOut3 = gsap.parseEase('power3.inOut');
const easeInOut2 = gsap.parseEase('power2.inOut');

function updateArc(dt) {
  const t = easeInOut3(arcState.t);
  const pose = lerpPose(layout.arcFrom, layout.arcTo, t);

  arcState.spin += (arcState.speed + arcState.user) * dt;
  arcState.user *= Math.exp(-dt * 2.2);

  const live = fx.inset;
  camera.fov = CAM_FOV;
  camera.position.set(0, 0, CAM_DIST);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);

  arcGroup.position.set(pose.x + pointer.sx * 0.25 * live, pose.yc, 0);
  arcGroup.rotation.set(-pose.tilt + pointer.sy * 0.035 * live, pointer.sx * 0.06 * live, 0);

  for (const c of arcCards) {
    const p = c.p;
    c.mesh.visible = p > 0.001;
    if (!c.mesh.visible) continue;
    const th = c.theta + arcState.spin;
    const r = pose.R * p;
    c.mesh.position.set(r * Math.sin(th), r * Math.cos(th), c.rank * 0.012 * (1 - t));
    // flies out edge-on along its radius, then opens up to face the viewer
    c.mesh.rotation.set(pose.lean, (1 - p) * Math.PI * 0.5 * c.side, -th);
    const s = pose.cw * (0.3 + 0.7 * p);
    c.mesh.scale.set(s, s, s);
  }
}

/* ---------- scroll: hero -> about -> work -> footer ---------- */

// a: hero -> about, the ring unrolls into a reel that travels with the page
// w: about -> work, the reel turns into a wheel that brings one design forward at a time (act)
// f: work -> footer, the cards roll back up into a ring above the footer
const scroll = { y: 0, raw: 0, vh: 1, footTop: 1, a: 0, w: 0, f: 0, act: 0, dim: 0, offset: 0, tint: 0, vel: 0 };
const work = { top: 0, step: 1, vertical: true, x: 3, y: 0, Ha: 6 };
const footRing = { R: 4.3, yc: 1.5 };
const FOOT_TILT = 0.36;

// the largest tilted ring (radius R, centred at yc) that fits between T and B, world units at z = 0
function fitFootRing(T, B, rMax) {
  const D = CAM_DIST, st = Math.sin(FOOT_TILT), ct = Math.cos(FOOT_TILT);
  for (let R = rMax; R > 0.8; R -= 0.05) {
    // the back of the ring rises and shrinks with distance, the front drops and grows
    const half = R * st + 0.5 * RING.w * 1.25 * (R / RING.R) * ct;
    const hi = T * (D + R * ct) / D - half;
    const lo = B * (D - R * ct) / D + half;
    if (lo <= hi) return { R, yc: (lo + hi) / 2 };
  }
  return { R: 0.8, yc: (T + B) / 2 };
}
const workEl = $('.work');
const workSnaps = [];
const fieldColors = WORKS.map((w) => new THREE.Color(w.field || '#8aa0b8'));
const tint = new THREE.Color();
const strip = { vertical: true, h: 3.3, w: 1.9, pitch: 3.85, L: 77, xc: 3, yc: 0, perVh: 5.5 };
const nav = $('.nav');
const textBlocks = $$('.about .block-in, .site-foot .foot-in');

function measureScroll() {
  scroll.vh = window.innerHeight;
  const foot = $('.site-foot');
  scroll.footTop = foot ? foot.offsetTop : document.documentElement.scrollHeight;
  work.top = workEl.offsetTop;
  work.step = workSnaps.length > 1 ? workSnaps[1].offsetTop - workSnaps[0].offsetTop : scroll.vh * 0.45;
  // the footer ring sits between the nav and the footer's copy as it stands at the end of the page
  const footIn = $('.foot-in');
  if (foot && footIn) {
    const copyHeight = foot.offsetHeight - (footIn.offsetTop - foot.offsetTop);
    const fh = Math.max(1, view.h - panel.t);
    const unit = fh / 10, mid = panel.t + fh / 2;
    const T = (mid - panel.t - 10) / unit;
    const B = (mid - (scroll.vh - copyHeight - 18)) / unit;
    const fa = view.w / fh;
    Object.assign(footRing, fitFootRing(T, B, Math.min(5 * fa * (fa >= 1 ? 0.6 : 0.74), 4.3)));
  }
}

// scroll the page so design i sits in focus on the wheel
function goToWork(i) {
  window.scrollTo({ top: work.top + i * work.step, behavior: reduceMotion ? 'auto' : 'smooth' });
}

// the reel is a column beside the copy on wide screens, a band across tall ones
function measureStrip() {
  const fa = (view.w - panel.l - panel.r) / Math.max(1, view.h - panel.t - panel.b);
  strip.vertical = fa >= 1;
  if (strip.vertical) {
    strip.h = 3.2; // a square card's size; 4:5 cards stand a quarter taller
    strip.w = strip.h;
    strip.pitch = strip.h * 1.25 + 0.5;
    strip.xc = Math.min(5 * fa * 0.5, 5 * fa - strip.w * 0.8);
    strip.yc = 0;
    strip.perVh = 10 * 0.55; // a little slower than the page
  } else {
    strip.h = 2.6;
    strip.w = strip.h;
    strip.pitch = strip.w + 0.34;
    strip.xc = 0;
    strip.yc = -2.0;
    strip.perVh = 5 * fa * 1.4;
  }
  strip.L = RING.N * strip.pitch;
  // the work wheel: beside the copy on wide screens, above it on tall ones; Ha is the focused card's height
  work.vertical = fa >= 1;
  if (work.vertical) {
    work.Ha = Math.min(6, 10 * fa * 0.36);
    work.x = 5 * fa - work.Ha * 0.5 - 0.9;
    work.y = -0.15;
  } else {
    work.Ha = Math.min(4.6, 10 * fa * 0.66);
    work.x = 0;
    work.y = 3.45 - work.Ha * 0.5;
  }
}

// how much of the reel's band the copy covers right now (0..1)
function textOverlap() {
  const u = frame.h / 10; // px per world unit on the reel's plane
  const cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
  let x0 = 0, x1 = view.w, y0 = frame.y, y1 = frame.y + frame.h;
  if (strip.vertical) {
    x0 = cx + (strip.xc - strip.w * 0.8) * u;
    x1 = cx + (strip.xc + strip.w * 0.8) * u;
  } else {
    y0 = cy - (strip.yc + strip.h * 0.5) * u;
    y1 = cy - (strip.yc - strip.h * 0.5) * u;
  }
  let cover = 0;
  for (const el of textBlocks) {
    const r = el.getBoundingClientRect();
    if (r.right < x0 || r.left > x1) continue;
    const iy = Math.min(y1, r.bottom) - Math.max(y0, r.top);
    if (iy > 0) cover = Math.max(cover, iy / (y1 - y0));
  }
  return clamp(cover * 2.5, 0, 1);
}

function updateScroll(dt) {
  const raw = live ? window.scrollY : 0;
  // the nav steps aside while reading down the page and returns on the way back up
  const dy = raw - scroll.raw;
  let away = nav.classList.contains('is-away');
  if (raw > scroll.vh * 0.5 && dy > 3) away = true;
  else if (dy < -3 || raw < scroll.vh * 0.5) away = false;
  if (away !== nav.classList.contains('is-away')) nav.classList.toggle('is-away', away);
  scroll.vel += ((dt > 0 ? dy / dt : 0) - scroll.vel) * (1 - Math.exp(-dt * 6));
  scroll.raw = raw;

  scroll.y += (raw - scroll.y) * (1 - Math.exp(-dt * 8));
  if (Math.abs(raw - scroll.y) < 0.05) scroll.y = raw;
  const { y, vh } = scroll;
  const footStart = scroll.footTop - vh; // the footer's top edge reaches the bottom of the screen
  const workStart = work.top - vh * 0.78;
  scroll.a = smoothstep(y, vh * 0.02, vh * 0.9);
  scroll.w = smoothstep(y, workStart, work.top - vh * 0.04);
  scroll.f = smoothstep(y, footStart + vh * 0.05, footStart + vh * 0.9);
  scroll.act = clamp((y - work.top) / work.step, 0, PHOTOS - 1);
  // the reel only travels while every card is in it, so no card wraps around mid-flight
  scroll.offset = (clamp(y, vh * 0.9, Math.max(vh * 0.9, workStart)) - vh * 0.9) / vh * strip.perVh;
  // the hills sink as the page rises, leaving open sky behind the copy
  fx.shift = lerp(0.55 * (1 - Math.pow(1 - scroll.a, 3)), 0.62, easeInOut2(scroll.f));
  const cover = scroll.a * (1 - scroll.w) * (1 - scroll.f) > 0.01 ? textOverlap() : 0;
  scroll.dim += (cover - scroll.dim) * (1 - Math.exp(-dt * 6));

  // the page takes on the colour of the design in focus, and its text turns light on dark ones
  const i0 = Math.floor(scroll.act), i1 = Math.min(PHOTOS - 1, i0 + 1);
  tint.copy(fieldColors[i0]).lerp(fieldColors[i1], smoothstep(scroll.act - i0, 0.3, 0.7));
  scroll.tint = 0.9 * easeInOut2(scroll.w) * (1 - easeInOut2(scroll.f));
  const light = scroll.tint > 0.45 && WORKS[Math.round(scroll.act)].ink === 'light';
  if (light !== document.body.classList.contains('ink-light')) document.body.classList.toggle('ink-light', light);
}

const p1 = new THREE.Vector3();
const p2 = new THREE.Vector3();
const p3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const q3 = new THREE.Quaternion();
const qy = new THREE.Quaternion();
const eul = new THREE.Euler();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const REEL_CAM = new THREE.Vector3(0, 0, CAM_DIST);
const reelLook = new THREE.Vector3();

// a card's place in the reel; returns its scale
function stripPose(c, pos, quat) {
  const L = strip.L;
  const u = (((c.order * strip.pitch + scroll.offset) % L) + L) % L - L / 2;
  const drift = Math.sin(clock * 0.6 + c.order * 1.7) * 0.06; // never quite still
  if (strip.vertical) {
    pos.set(strip.xc + 0.45 * Math.sin(u * 0.24 + 0.8) + drift, u, -0.045 * u * u - scroll.dim * 1.5);
    eul.set(-Math.atan(0.09 * u), -0.12 * Math.cos(u * 0.24 + 0.8), 0.05 * Math.sin(u * 0.3));
  } else {
    const x = -u;
    pos.set(x, strip.yc + 0.18 * Math.sin(x * 0.55) + drift, -0.07 * x * x - scroll.dim * 1.5);
    eul.set(0, Math.atan(0.14 * x), -0.03 * x);
  }
  quat.setFromEuler(eul);
  return strip.h / RING.h;
}

// a card's place in the smaller, tilted ring above the footer; returns its scale
function footPose(ph, pos, quat) {
  const { R, yc } = footRing;
  pos.set(R * Math.sin(ph), 0, -R * Math.cos(ph)).applyAxisAngle(AXIS_X, FOOT_TILT);
  pos.y += yc;
  quat.setFromAxisAngle(AXIS_X, FOOT_TILT).multiply(qy.setFromAxisAngle(AXIS_Y, -ph));
  return R / RING.R;
}

// a card's place on the work wheel; the design in focus comes forward at full size; returns its scale
function workPose(c, pos, quat) {
  const d = c.order - scroll.act;
  const focus = 1 - smoothstep(Math.abs(d), 0, 1);
  const s = (lerp(0.56, 1, focus) * work.Ha) / (RING.w * c.aspect);
  const drift = Math.sin(clock * 0.7 + c.order) * 0.04 * focus; // never quite still
  if (work.vertical) {
    // a drum turning about a horizontal axis; the next designs wait below
    const th = clamp(d, -3.5, 3.5) * 0.46;
    pos.set(work.x, work.y - 9 * Math.sin(th) + drift, 9 * (Math.cos(th) - 1) + 1.1 * focus);
    eul.set(th + pointer.sy * 0.05 * focus, -0.14 + pointer.sx * 0.1 * focus, 0);
  } else {
    // a drum turning about a vertical axis; the next designs wait to the right
    const th = clamp(d, -3.5, 3.5) * 0.55;
    pos.set(5 * Math.sin(th), work.y + drift, 5 * (Math.cos(th) - 1) + 0.7 * focus);
    eul.set(pointer.sy * 0.04 * focus, th + pointer.sx * 0.06 * focus, 0);
  }
  quat.setFromEuler(eul);
  return s;
}

function updateRing(dt) {
  const tt = ringState.t;
  const a = layout.ringFrom, b = layout.ringTo;
  // dive: rush inward early, drop down late so the lens clears the rim of cards
  const tz = easeInOut3(tt);
  const ty = easeInOut3(clamp(tt * 1.08, 0, 1));
  const tl = easeInOut3(clamp(tt * 1.2 - 0.08, 0, 1));
  const tf = easeInOut3(tt);

  vA.set(lerp(a.pos.x, b.pos.x, tz), lerp(a.pos.y, b.pos.y, ty), lerp(a.pos.z, b.pos.z, tz));
  lookTarget.set(lerp(a.target.x, b.target.x, tl), lerp(a.target.y, b.target.y, tl), lerp(a.target.z, b.target.z, tl));

  const live = fx.inset;
  lookTarget.x += pointer.sx * 0.9 * live;
  lookTarget.y += pointer.sy * 0.5 * live;

  // scrolling pulls the camera back out of the ring to where it watches the reel
  const ca = easeInOut2(clamp((scroll.a - 0.06) / 0.8, 0, 1));
  reelLook.set(pointer.sx * 0.35, -pointer.sy * 0.25, 0);
  camera.position.copy(vA).lerp(REEL_CAM, ca);
  lookTarget.lerp(reelLook, ca);
  camera.fov = lerp(lerp(a.fov, b.fov, tf), CAM_FOV, ca);
  camera.up.set(0, 1, 0);
  camera.lookAt(lookTarget);
  camera.rotateZ(lerp(a.roll, b.roll, tf) * (1 - ca));

  ringState.spin += (ringState.speed + ringState.user) * dt;
  ringState.user *= Math.exp(-dt * 2.2);

  const R = RING.R;
  const sa = scroll.a, sw = scroll.w, sf = scroll.f;
  for (const c of ringCards) {
    const p = c.p;
    c.mesh.visible = p > 0.001;
    if (!c.mesh.visible) continue;
    // its place on the hero ring; the build hinges each card open from the previous one
    const ph = c.phi - ringState.spin;
    p1.set(R * Math.sin(ph), 0, -R * Math.cos(ph));
    q1.setFromEuler(eul.set(0, -ph - (1 - p) * 1.7, 0));
    let s = 0.72 + 0.28 * p;
    let bend = 1;
    let opacity = clamp(p * 1.6, 0, 1);
    // cards behind the camera leave the ring first so none sweeps through the lens;
    // they return in reel order, one after another
    const ai = easeInOut2(clamp((sa - 0.35 * (1 + Math.cos(ph)) * 0.5) / 0.65, 0, 1));
    // the cards nearest the first design reach the wheel first
    const wi = easeInOut2(clamp((sw - 0.3 * Math.min(1, Math.abs(c.order - scroll.act) / 6)) / 0.7, 0, 1));
    const fi = easeInOut2(clamp((sf - 0.3 * (c.order / RING.N)) / 0.7, 0, 1));
    if (ai > 0 || wi > 0 || fi > 0) {
      const ss = stripPose(c, p2, q2);
      p1.lerp(p2, ai);
      q1.slerp(q2, ai);
      s = lerp(s, ss, ai);
      bend = 1 - ai;
      if (wi > 0) {
        const ws = workPose(c, p3, q3);
        p1.lerp(p3, wi);
        q1.slerp(q3, wi);
        s = lerp(s, ws, wi);
        bend *= 1 - wi;
        // designs far round the wheel fade out
        opacity *= 1 - wi * (1 - fi) * smoothstep(Math.abs(c.order - scroll.act), 2.4, 3.4);
      }
      if (fi > 0) {
        const fs = footPose(ph, p3, q3);
        p1.lerp(p3, fi);
        q1.slerp(q3, fi);
        s = lerp(s, fs, fi);
        bend = lerp(bend, 1, fi);
      }
      // the reel fades back while copy passes over it
      opacity *= 1 - 0.85 * scroll.dim * ai * (1 - wi) * (1 - fi);
    }
    if (opacity < 0.004) {
      c.mesh.visible = false;
      continue;
    }
    c.mesh.position.copy(p1);
    c.mesh.quaternion.copy(q1);
    c.mesh.scale.setScalar(s);
    c.mat.uniforms.uBend.value = bend;
    c.mat.uniforms.uOpacity.value = opacity;
    c.shadow.material.uniforms.uAlpha.value = 0.34 * opacity * (1 - bend);
  }
}

function updateCamera() {
  camera.aspect = frame.w / frame.h;
  camera.setViewOffset(frame.w, frame.h, -frame.x, -frame.y, view.w, view.h);
  camera.updateProjectionMatrix();
}

let clock = 0;
function updatePetals(dt) {
  petalMat.uniforms.uAlpha.value = clamp(fx.reveal * 1.4 - 0.4, 0, 1);
  if (petalMat.uniforms.uAlpha.value <= 0) return;
  for (let i = 0; i < petals.length; i++) {
    const q = petals[i];
    q.x += q.vx * dt;
    q.y += q.vy * dt + Math.sin(clock * 0.8 + q.sway) * 0.004 * dt;
    q.rot += q.vr * dt;
    q.ph += q.vf * dt;
    if (q.x < -0.02) q.x += 1.04;
    if (q.y > 1.02) q.y -= 1.04;
    const size = q.size * Math.max(1, Math.min(view.w, view.h) / 700);
    tmpObj.position.set(q.x * view.w, q.y * view.h, 0);
    tmpObj.rotation.set(0, 0, q.rot);
    tmpObj.scale.set(size * (0.2 + 0.8 * Math.abs(Math.cos(q.ph))), size, 1);
    tmpObj.updateMatrix();
    petalMesh.setMatrixAt(i, tmpObj.matrix);
  }
  petalMesh.instanceMatrix.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* Counter (odometer)                                                  */
/* ------------------------------------------------------------------ */

const counter = { value: 1, cols: [] };
(function buildCounter() {
  const spans = $$('.counter-digits .col');
  const sizes = [2, 11, 101]; // hundreds 0-1, tens 0-10, ones 0-100 (cumulative, always rolls forward)
  spans.forEach((col, i) => {
    const strip = document.createElement('span');
    strip.className = 'strip';
    let html = '';
    for (let k = 0; k < sizes[i]; k++) html += `<span>${k % 10}</span>`;
    strip.innerHTML = html;
    col.appendChild(strip);
    counter.cols.push({ strip, pos: 0 });
  });
})();
function updateCounter(dt) {
  const shown = allLoaded ? counter.value : Math.min(counter.value, 3 + 96 * (loadedCount / TO_LOAD));
  const v = Math.round(clamp(shown, 0, 100));
  const targets = [Math.floor(v / 100), Math.floor(v / 10), v];
  const k = 1 - Math.exp(-dt * 16);
  counter.cols.forEach((c, i) => {
    const before = c.pos;
    if (targets[i] < c.pos - 0.5) c.pos = targets[i];
    c.pos += (targets[i] - c.pos) * k;
    if (Math.abs(targets[i] - c.pos) < 0.001) c.pos = targets[i];
    if (c.pos !== before) c.strip.style.transform = `translate3d(0, ${(-c.pos).toFixed(4)}em, 0)`;
  });
}

/* ------------------------------------------------------------------ */
/* Interaction                                                         */
/* ------------------------------------------------------------------ */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let live = false;
let hovered = null;
let drag = null;
let paused = false;

function pick(clientX, clientY) {
  // reels faded back behind the copy can't be picked through it
  if (scroll.dim * scroll.a * (1 - scroll.w) * (1 - scroll.f) > 0.5) return null;
  if (clientX < frame.x || clientX > frame.x + frame.w || clientY < frame.y || clientY > frame.y + frame.h) return null;
  const rect = canvas.getBoundingClientRect();
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(cards.filter((c) => c.mesh.visible && c.mat.uniforms.uOpacity.value > 0.25).map((c) => c.mesh), false);
  return hits.length ? hits[0].object.userData.card : null;
}

function spinBy(pixels) {
  const k = pixels / Math.max(320, frame.w * 0.55);
  if (!phase.ring) arcState.spin += k;
  else if (scroll.a < 0.98 || scroll.f > 0.02) ringState.spin -= k * 0.8; // the reel itself follows the scroll
}

canvas.addEventListener('pointermove', (e) => {
  pointer.px = e.clientX;
  pointer.py = e.clientY;
  pointer.x = (e.clientX / view.w) * 2 - 1;
  pointer.y = (e.clientY / view.h) * 2 - 1;
  pointer.inside = true;
  if (!drag) return;
  const dx = e.clientX - drag.x;
  drag.x = e.clientX;
  drag.moved += Math.abs(dx) + Math.abs(e.clientY - drag.y0) * 0.1;
  const now = performance.now();
  const dtm = Math.max(1, now - drag.t) / 1000;
  drag.t = now;
  spinBy(dx);
  const vel = (dx / Math.max(320, frame.w * 0.55)) / dtm;
  drag.vel = lerp(drag.vel, vel, 0.35);
});
canvas.addEventListener('pointerleave', () => { pointer.inside = false; });
canvas.addEventListener('pointerdown', (e) => {
  if (!live) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y0: e.clientY, t: performance.now(), moved: 0, vel: 0, start: performance.now() };
  if (phase.ring) ringState.user = 0; else arcState.user = 0;
  document.body.classList.add('is-dragging');
});
function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  document.body.classList.remove('is-dragging');
  if (d.moved < 6 && performance.now() - d.start < 500) {
    const card = pick(e.clientX, e.clientY);
    if (!card) return;
    if (phase.ring && scroll.w > 0.9 && scroll.f < 0.1 && card.order !== Math.round(scroll.act)) goToWork(card.order);
    else openLightbox(card.photo);
    return;
  }
  const v = clamp(d.vel, -4, 4);
  if (phase.ring) ringState.user = -v * 0.8; else arcState.user = v;
}
canvas.addEventListener('pointerup', endDrag);
// the browser took the gesture over for scrolling: not a tap, not a throw
canvas.addEventListener('pointercancel', () => {
  drag = null;
  document.body.classList.remove('is-dragging');
});

function updateHover(dt) {
  let target = null;
  if (live && !drag && pointer.inside && pointer.px >= 0) target = pick(pointer.px, pointer.py);
  if (target !== hovered) {
    hovered = target;
    document.body.classList.toggle('is-hover', !!hovered);
  }
  const k = 1 - Math.exp(-dt * 10);
  for (const c of cards) {
    c.hover += ((c === hovered ? 1 : 0) - c.hover) * k;
    c.mat.uniforms.uHover.value = c.hover;
  }
  // smoothed pointer for parallax
  const kp = 1 - Math.exp(-dt * 3);
  pointer.sx += ((pointer.inside ? pointer.x : 0) - pointer.sx) * kp;
  pointer.sy += ((pointer.inside ? pointer.y : 0) - pointer.sy) * kp;
}

/* ---------- Lightbox ---------- */

const lb = {
  el: $('.lightbox'),
  fig: $('.lb-figure'),
  img: $('.lb-img'),
  count: $('.lb-count'),
  title: $('.lb-title'),
  meta: $('.lb-meta'),
  index: 0,
  open: false,
  returnFocus: null,
};

function showPhoto(i, dir = 0) {
  lb.index = (i + PHOTOS) % PHOTOS;
  lb.count.textContent = `${pad2(lb.index + 1)} / ${pad2(PHOTOS)}`;
  const w = WORKS[lb.index];
  lb.title.textContent = w.title;
  lb.meta.textContent = [w.client, w.type].filter(Boolean).join(' \u00b7 ');
  const src = fullSrc(lb.index);
  const pre = new Image();
  pre.src = src;
  const swap = () => {
    lb.img.src = src;
    lb.img.alt = w.client ? `${w.title}, ${w.client}` : w.title;
    gsap.fromTo(lb.img, { opacity: 0, x: dir * 40, scale: dir ? 1 : 0.94 }, { opacity: 1, x: 0, scale: 1, duration: 0.6, ease: 'power3.out' });
  };
  const ready = pre.decode ? pre.decode().catch(() => {}) : Promise.resolve();
  if (dir) gsap.to(lb.img, { opacity: 0, x: -dir * 40, duration: 0.22, ease: 'power2.in', onComplete: () => ready.then(swap) });
  else ready.then(swap);
}

function openLightbox(i, viaKeyboard = false) {
  if (lb.open) return;
  lb.open = true;
  lb.returnFocus = document.activeElement;
  document.documentElement.classList.add('is-locked');
  lb.el.hidden = false;
  lb.img.style.opacity = '0';
  gsap.to(lb.el, { opacity: 1, duration: 0.4, ease: 'power2.out', onComplete: () => { paused = true; } });
  showPhoto(i);
  $('.lb-close').focus({ preventScroll: true, focusVisible: viaKeyboard });
}
function closeLightbox() {
  if (!lb.open) return;
  lb.open = false;
  paused = false;
  if (live) document.documentElement.classList.remove('is-locked');
  gsap.to(lb.el, {
    opacity: 0, duration: 0.35, ease: 'power2.inOut',
    onComplete: () => { lb.el.hidden = true; lb.img.removeAttribute('src'); },
  });
  if (lb.returnFocus && lb.returnFocus.focus) lb.returnFocus.focus({ preventScroll: true });
}
$('.lb-close').addEventListener('click', closeLightbox);
$('.lb-prev').addEventListener('click', () => showPhoto(lb.index - 1, -1));
$('.lb-next').addEventListener('click', () => showPhoto(lb.index + 1, 1));
lb.el.addEventListener('click', (e) => { if (e.target === lb.el || e.target === lb.fig) closeLightbox(); });
window.addEventListener('keydown', (e) => {
  if (!lb.open) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowRight') showPhoto(lb.index + 1, 1);
  else if (e.key === 'ArrowLeft') showPhoto(lb.index - 1, -1);
});
let swipe = null;
lb.el.addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY }; });
lb.el.addEventListener('pointerup', (e) => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - swipe.y)) showPhoto(lb.index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
  swipe = null;
});

(function buildPhotoList() {
  const list = $('#photo-list');
  for (let i = 0; i < PHOTOS; i++) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const w = WORKS[i];
    b.textContent = `Open ${w.client ? `${w.title}, ${w.client}` : w.title}`;
    b.addEventListener('click', () => openLightbox(i, true));
    li.appendChild(b);
    list.appendChild(li);
  }
})();

/* ---------- small DOM bits ---------- */

// back to the top: the brand in the nav and the button in the footer
const toTop = (e) => {
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
};
$('.brand').addEventListener('click', toTop);
$('.to-top').addEventListener('click', toTop);

// copy rises in as it scrolls into view
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add('is-in');
    io.unobserve(e.target);
  }), { threshold: 0.2 });
  $$('.reveal').forEach((el) => io.observe(el));
} else {
  $$('.reveal').forEach((el) => el.classList.add('is-in'));
}

/* ---------- contact details (from the footer's data attributes) ---------- */

function renderContact() {
  const foot = $('.site-foot');
  const box = $('.contact');
  if (!foot || !box) return;
  const email = (foot.dataset.email || '').trim();
  const handle = (foot.dataset.instagram || '').trim().replace(/^@/, '');
  const phone = (foot.dataset.phone || '').trim();
  box.textContent = '';
  const add = (href, text, external) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    if (external) { a.target = '_blank'; a.rel = 'noopener'; }
    box.appendChild(a);
  };
  if (email) add(`mailto:${email}`, email);
  if (handle) add(`https://instagram.com/${encodeURIComponent(handle)}`, `@${handle}`, true);
  if (phone) add(`tel:${phone.replace(/[^\d+]/g, '')}`, phone);
  if (!box.children.length) {
    const p = document.createElement('p');
    p.className = 'contact-soon';
    p.textContent = 'Contact details coming soon';
    box.appendChild(p);
  }
}
renderContact();

/* ---------- hand-drawn marks, drawn to fit each word ---------- */

function seeded(seed) {
  let v = seed % 2147483647;
  if (v <= 0) v += 2147483646;
  return () => (v = (v * 16807) % 2147483647) / 2147483647;
}
function pathFrom(pts) {
  return pts.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
}
// a path in the element's own pixel box; pad is how far the mark reaches outside it
function doodleShape(type, w, h, rnd) {
  const f = (v) => v.toFixed(1);
  if (type === 'circle') {
    // a quick marker loop that overshoots where it started
    const pts = [];
    const n = 72, start = -2.5, turn = TAU * 1.13, ph = rnd() * TAU;
    for (let k = 0; k <= n; k++) {
      const t = k / n, a = start + t * turn;
      const wob = 1 + 0.03 * Math.sin(a * 3 + ph) + 0.06 * t;
      pts.push([w / 2 + (w / 2 + h * 0.14) * wob * Math.cos(a), h / 2 + (h / 2 + h * 0.12) * wob * Math.sin(a) * (1 - 0.08 * t)]);
    }
    return { d: pathFrom(pts), pad: h * 0.8, stroke: Math.max(2, h * 0.045) };
  }
  if (type === 'underline') {
    const pts = [];
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      pts.push([-w * 0.03 + t * w * 1.08, h * 1.12 + Math.sin(t * Math.PI * 2.2 + 0.4) * h * 0.08 - t * h * 0.12]);
    }
    return { d: pathFrom(pts), pad: h, stroke: Math.max(2, h * 0.16) };
  }
  if (type === 'arrow') {
    // curls up from the right towards the top left, then a head
    const pts = [];
    for (let k = 0; k <= 30; k++) {
      const t = k / 30;
      pts.push([w * (0.95 - 0.8 * t) + Math.sin(t * Math.PI) * w * 0.05, h * (0.88 - 0.78 * t) + Math.sin(t * Math.PI) * h * 0.28]);
    }
    const [ex, ey] = pts[pts.length - 1];
    const head = `M${f(ex + w * 0.24)} ${f(ey + h * 0.04)} L${f(ex)} ${f(ey)} L${f(ex + w * 0.03)} ${f(ey + h * 0.36)}`;
    return { d: `${pathFrom(pts)} ${head}`, pad: 6, stroke: Math.max(2, h * 0.075) };
  }
  // sparkle: a four-point star
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2, k = r * 0.12;
  const j = () => (rnd() - 0.5) * r * 0.1;
  return {
    d: `M${f(cx + j())} ${f(cy - r)} Q${f(cx + k)} ${f(cy - k)} ${f(cx + r)} ${f(cy + j())} Q${f(cx + k)} ${f(cy + k)} ${f(cx + j())} ${f(cy + r)} Q${f(cx - k)} ${f(cy + k)} ${f(cx - r)} ${f(cy + j())} Q${f(cx - k)} ${f(cy - k)} ${f(cx)} ${f(cy - r)}`,
    pad: 6,
    stroke: Math.max(2, r * 0.13),
  };
}
function drawDoodles() {
  const NS = 'http://www.w3.org/2000/svg';
  $$('.doodle[data-doodle]').forEach((el, i) => {
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    const shape = doodleShape(el.dataset.doodle, w, h, seeded(i * 7919 + 13));
    let svg = el.querySelector(':scope > .doodle-svg');
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'doodle-svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.appendChild(document.createElementNS(NS, 'path'));
      el.appendChild(svg);
    }
    const { pad } = shape;
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`);
    svg.style.left = svg.style.top = `${-pad}px`;
    svg.style.width = `${w + pad * 2}px`;
    svg.style.height = `${h + pad * 2}px`;
    const path = svg.firstChild;
    path.setAttribute('d', shape.d);
    path.setAttribute('stroke-width', shape.stroke.toFixed(2));
    path.style.setProperty('--len', String(Math.ceil(path.getTotalLength() + 2)));
  });
}

/* ---------- footer marquee ---------- */

const marquee = { track: $('.marquee-track'), x: 0, w: 1 };
function buildMarquee() {
  const { track } = marquee;
  const group = track.firstElementChild;
  const item = group.firstElementChild;
  // repeat the phrase until one group is wider than the screen, then run two groups end to end
  while (track.children.length > 1) track.lastElementChild.remove();
  while (group.children.length > 1) group.lastElementChild.remove();
  const copies = Math.max(1, Math.ceil(view.w / Math.max(1, item.offsetWidth)) + 1);
  for (let k = 1; k < copies; k++) group.appendChild(item.cloneNode(true));
  track.appendChild(group.cloneNode(true));
  marquee.w = Math.max(1, group.offsetWidth);
  marquee.x %= marquee.w;
}
function updateMarquee(dt) {
  if (scroll.f < 0.02 || reduceMotion) return;
  // it runs faster while the page is moving
  marquee.x -= (70 + Math.min(1200, Math.abs(scroll.vel)) * 0.35) * dt;
  if (marquee.x <= -marquee.w) marquee.x += marquee.w;
  marquee.track.style.transform = `translate3d(${marquee.x.toFixed(1)}px, 0, 0)`;
}

/* ---------- work panel: number, title, client and type of the design in focus ---------- */

const workUI = {
  panel: $('.work-panel'),
  name: $('.wn-text'),
  client: $('.work-client'),
  type: $('.work-type'),
  ticks: [],
  cols: [],
  index: -1,
  opacity: -1,
  shown: false,
};
(function buildWork() {
  workEl.style.setProperty('--n', String(PHOTOS));
  $('.wn-of').textContent = `/ ${pad2(PHOTOS)}`;
  const ticksBox = $('.work-ticks');
  WORKS.forEach((w, i) => {
    // one snap point per design, so a flick lands on the next one
    const snap = document.createElement('span');
    snap.className = 'work-snap';
    snap.style.setProperty('--i', String(i));
    workEl.appendChild(snap);
    workSnaps.push(snap);
    const tickBtn = document.createElement('button');
    tickBtn.type = 'button';
    tickBtn.setAttribute('aria-label', `Show ${w.title}`);
    tickBtn.addEventListener('click', () => goToWork(i));
    ticksBox.appendChild(tickBtn);
    workUI.ticks.push(tickBtn);
  });
  // the number rolls like the loader's counter: tens, then ones counted up to the last design
  $$('.wn-digits .col').forEach((col, k) => {
    const strip = document.createElement('span');
    strip.className = 'strip';
    const count = k === 0 ? Math.floor(PHOTOS / 10) + 1 : PHOTOS + 1;
    strip.innerHTML = Array.from({ length: count }, (_, n) => `<span>${n % 10}</span>`).join('');
    col.appendChild(strip);
    workUI.cols.push({ strip, pos: -1 });
  });
  // a keyboard press reports detail 0: only then does the viewer show its focus ring
  $('.work-open').addEventListener('click', (e) => openLightbox(Math.round(scroll.act), e.detail === 0));
})();

function showWork(i, animate) {
  const w = WORKS[i];
  const apply = () => {
    workUI.name.textContent = w.title;
    workUI.client.textContent = w.client || '';
    workUI.type.textContent = w.type || '';
  };
  gsap.killTweensOf([workUI.name, workUI.client, workUI.type]);
  if (!animate || reduceMotion) {
    apply();
    gsap.set([workUI.name, workUI.client, workUI.type], { yPercent: 0, y: 0, opacity: 1 });
    return;
  }
  const dir = i > workUI.index ? 1 : -1;
  gsap.to(workUI.name, {
    yPercent: -105 * dir, opacity: 0, duration: 0.18, ease: 'power2.in',
    onComplete: () => {
      apply();
      gsap.fromTo(workUI.name, { yPercent: 105 * dir, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.55, ease: 'power3.out' });
      gsap.fromTo([workUI.client, workUI.type], { y: 10 * dir, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.05, delay: 0.08, ease: 'power2.out' });
    },
  });
}

function updateWorkUI(dt) {
  // the panel fades in as the wheel settles and out as the footer arrives
  const op = clamp(scroll.w * 1.5 - 0.5, 0, 1) * (1 - scroll.f);
  if (Math.abs(op - workUI.opacity) > 0.004) {
    workUI.opacity = op;
    workUI.panel.style.opacity = op.toFixed(3);
  }
  if (op > 0.9 && !workUI.shown) {
    workUI.shown = true;
    workUI.panel.classList.add('is-in');
  }
  const i = Math.round(scroll.act);
  if (i !== workUI.index) {
    showWork(i, workUI.index >= 0 && op > 0.2);
    workUI.ticks.forEach((t, k) => t.classList.toggle('is-on', k === i));
    workUI.index = i;
  }
  const targets = [Math.floor((i + 1) / 10), i + 1];
  const k = 1 - Math.exp(-dt * 14);
  workUI.cols.forEach((c, n) => {
    const before = c.pos;
    if (c.pos < 0) c.pos = targets[n];
    c.pos += (targets[n] - c.pos) * k;
    if (Math.abs(targets[n] - c.pos) < 0.001) c.pos = targets[n];
    if (c.pos !== before) c.strip.style.transform = `translate3d(0, ${(-c.pos).toFixed(4)}em, 0)`;
  });
}

/* ---------- "View" tag that follows the pointer over a design ---------- */

const tag = { el: $('.tag-view'), x: 0, y: 0, on: 0, idle: true };
const finePointer = matchMedia('(pointer: fine)').matches;
function updateTag(dt) {
  if (!finePointer) return;
  const want = hovered && !drag ? 1 : 0;
  if (tag.idle && want) { tag.x = pointer.px + 18; tag.y = pointer.py + 18; }
  tag.on += (want - tag.on) * (1 - Math.exp(-dt * 14));
  if (!want && tag.on < 0.003) {
    if (!tag.idle) { tag.el.style.opacity = '0'; tag.idle = true; }
    return;
  }
  tag.idle = false;
  const k = 1 - Math.exp(-dt * 20);
  tag.x += (pointer.px + 18 - tag.x) * k;
  tag.y += (pointer.py + 18 - tag.y) * k;
  tag.el.style.transform = `translate3d(${tag.x.toFixed(1)}px, ${tag.y.toFixed(1)}px, 0) scale(${(0.6 + 0.4 * tag.on).toFixed(3)})`;
  tag.el.style.opacity = tag.on.toFixed(3);
}

/* ---------- music ---------- */

// The score starts as the page opens wherever the browser allows sound on its own; elsewhere it
// starts on the first tap, click or key press anywhere. The nav button mutes it for this visit.
const music = createMusic();
const soundBtn = $('.sound');
const soundLabel = $('.sound-label');
function showSound() {
  const waiting = music.on && !music.audible;
  soundBtn.classList.toggle('is-on', music.audible);
  soundBtn.classList.toggle('is-waiting', waiting);
  soundBtn.setAttribute('aria-pressed', String(music.on));
  soundLabel.textContent = waiting ? 'Tap for sound' : 'Sound';
}
music.onChange(showSound);
soundBtn.addEventListener('click', () => {
  if (music.on && !music.audible) music.unlock(); // still blocked: this tap is what lets it play
  else if (music.on) music.pause();
  else music.play();
  showSound();
});
// a touch only counts as an interaction once the finger lifts, so listen for the whole gesture
const GESTURES = ['pointerdown', 'pointerup', 'mousedown', 'touchend', 'click', 'keydown'];
function onGesture(e) {
  if (!soundBtn.contains(e.target)) music.unlock();
}
GESTURES.forEach((type) => window.addEventListener(type, onGesture, { capture: true, passive: true }));
music.onChange(() => {
  if (music.audible) GESTURES.forEach((type) => window.removeEventListener(type, onGesture, { capture: true }));
});
music.play();

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

function nameFlip() {
  const name = $('.loader-name');
  const word = $('.loader-word');
  const target = $('.brand-word');
  return {
    x: () => {
      const n = name.getBoundingClientRect(), a = word.getBoundingClientRect(), b = target.getBoundingClientRect();
      const s = b.height / a.height;
      return b.left - n.left - s * (a.left - n.left);
    },
    y: () => {
      const n = name.getBoundingClientRect(), a = word.getBoundingClientRect(), b = target.getBoundingClientRect();
      const s = b.height / a.height;
      return b.top - n.top - s * (a.top - n.top);
    },
    scale: () => target.getBoundingClientRect().height / word.getBoundingClientRect().height,
  };
}

// backdrop in, name into the nav, nav links in, scene framed below the nav
function addReveal(tl, gate, first) {
  const ir = first ? {} : { immediateRender: false };
  tl.to(fx, { reveal: 1, duration: 0.55, ease: 'power2.inOut' }, gate + 0.05);
  tl.to(fx, { zoom: 1, duration: 1.6, ease: 'power2.out' }, gate + 0.05);
  tl.to('.counter', { opacity: 0, filter: 'blur(6px)', y: -8, duration: 0.6, ease: 'power2.inOut' }, gate + 0.1);
  tl.to('.loader-dot', { opacity: 0, duration: 0.3, ease: 'power1.out' }, gate + 0.25);

  tl.to('.loader-name', { ...nameFlip(), duration: 1.0, ease: 'power3.inOut' }, gate + 0.45);
  tl.set('.brand-word', { visibility: 'visible' }, gate + 1.45);
  tl.set('.loader-name', { visibility: 'hidden' }, gate + 1.45);
  tl.fromTo('.brand-dot', { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.5, ...ir }, gate + 1.45);
  tl.fromTo(['.role', '.sound'], { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.035, ...ir }, gate + 1.5);

  tl.to(fx, { inset: 1, duration: 0.8, ease: 'power3.inOut', onUpdate: applyInset }, gate + 1.1);
}

// the reverse: nav links out, name back out of the nav, backdrop back to paper
function addRewind(tl, at) {
  tl.to(['.role', '.sound', '.brand-dot'], { opacity: 0, duration: 0.3, ease: 'power1.in' }, at);

  tl.set('.loader-name', { visibility: 'visible' }, at + 0.3);
  tl.set('.brand-word', { visibility: 'hidden' }, at + 0.3);
  tl.to('.loader-name', { x: 0, y: 0, scale: 1, duration: 0.95, ease: 'power3.inOut' }, at + 0.3);
  tl.to('.loader-dot', { opacity: 1, duration: 0.3, ease: 'power1.out' }, at + 1.0);

  tl.to(fx, { inset: 0, duration: 0.8, ease: 'power3.inOut', onUpdate: applyInset }, at + 0.2);
  tl.to(fx, { reveal: 0, duration: 0.7, ease: 'power2.inOut' }, at + 0.3);
  tl.to(fx, { zoom: 1.06, duration: 0.7, ease: 'power2.inOut' }, at + 0.3);
}

// the name and the counter start straight away, while the photos are still arriving
function playLoader() {
  gsap.fromTo('.loader-name .ch', { y: 0, yPercent: 112 }, { yPercent: 0, duration: 0.8, stagger: 0.06, ease: 'power3.out', delay: 0.04 });
  gsap.to(counter, { value: 100, duration: 1.15, ease: 'sine.inOut' });
}

function buildTimeline() {
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });

  /* part 1: reels fly out of the centre and fan into a rainbow, top first */
  for (const c of arcCards) tl.to(c, { p: 1, duration: 0.6, ease: 'power2.out' }, 0.02 + c.rank * 0.115);

  // hold until every image is decoded, then upload the big backdrop while the scene is still
  const gate = 2.3;
  tl.addPause(gate, () => onAllLoaded(() => {
    if (bg.tex) renderer.initTexture(bg.tex);
    requestAnimationFrame(() => tl.play());
  }));
  addReveal(tl, gate, true);
  tl.to(arcState, { t: 1, duration: 1.3, ease: 'none' }, gate + 0.25);
  tl.to(arcState, { speed: 0.13, duration: 1.6, ease: 'sine.inOut' }, gate + 0.5);

  /* hold on the arc page, then rewind to the loader; the arc drops away, outer reels first */
  const back = gate + 5.0;
  addRewind(tl, back);
  tl.to(arcState, { speed: 0, duration: 0.6, ease: 'power1.out' }, back);
  const maxRank = ARC.N / 2;
  for (const c of arcCards) tl.to(c, { p: 0, duration: 0.5, ease: 'power2.in' }, back + 0.1 + (maxRank - c.rank) * 0.018);
  tl.set(counter, { value: 0 }, back + 0.6);

  /* part 2: the counter rolls again while a ring builds, then the camera dives inside it */
  const ring = back + 1.0;
  intro.switchAt = back + 0.95;
  tl.to('.counter', { opacity: 1, filter: 'blur(0px)', y: 0, duration: 0.4, ease: 'power2.out' }, ring - 0.05);
  tl.to(counter, { value: 100, duration: 1.15, ease: 'sine.inOut' }, ring);
  for (const c of ringCards) tl.to(c, { p: 1, duration: 0.6, ease: 'power3.out' }, ring + 0.12 + c.order * 0.1);
  tl.to(ringState, { speed: 0.12, duration: 1.2, ease: 'sine.in' }, ring + 0.2);

  const gate2 = ring + 2.45;
  addReveal(tl, gate2, false);
  tl.to(ringState, { t: 1, duration: 1.05, ease: 'none' }, gate2 + 0.12);
  tl.to(ringState, { speed: 0.21, duration: 1.2, ease: 'sine.inOut' }, gate2 + 0.4);

  tl.call(goLive, null, gate2 + 1.9);
  return tl;
}

function goLive() {
  if (live) return;
  live = true;
  document.body.classList.add('is-live');
  document.documentElement.classList.remove('is-locked');
  measureScroll();
  preloadFullPhotos();
}

// jump straight to a point of the intro without firing its pause / callbacks
function seekIntro(tl, t) {
  tl.pause();
  gsap.set('.loader-name .ch', { y: 0, yPercent: 0 });
  counter.value = 100;
  tl.seek(t, true);
  applyInset();
  // callbacks are suppressed while seeking, so settle the counters by hand
  counter.cols.forEach((c) => { c.pos = -1; });
  updateCounter(10);
  if (t >= tl.duration() - 0.5) goLive();
}

/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */

let last = performance.now();
function tick() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (paused) return;
  clock += dt;

  // which scene is on stage follows the timeline, so seeking lands in the right one
  const ringNow = !!intro.tl && intro.tl.time() >= intro.switchAt;
  if (ringNow !== phase.ring) {
    phase.ring = ringNow;
    document.body.classList.toggle('intro-ring', ringNow);
  }
  arcGroup.visible = !phase.ring;
  ringGroup.visible = phase.ring;

  updateCounter(dt);
  updateHover(dt);
  updateScroll(dt);
  if (phase.ring) updateRing(dt); else updateArc(dt);
  updateCamera();
  updatePetals(dt);
  updateWorkUI(dt);
  updateHiRes();
  updateMarquee(dt);
  updateTag(dt);

  // the colour field glows behind the design in focus
  const ffa = frame.w / frame.h;
  const gx = frame.x + frame.w * (0.5 + work.x / (10 * ffa));
  const gy = frame.y + frame.h * (0.5 - work.y / 10);
  bgMat.uniforms.uGlow.value.set(gx / view.w, 1 - gy / view.h, (work.Ha / 10) * (frame.h / view.h));
  bgMat.uniforms.uTint.value.copy(tint);
  bgMat.uniforms.uTintAmt.value = scroll.tint;
  bgMat.uniforms.uReveal.value = fx.reveal;
  bgMat.uniforms.uZoom.value = fx.zoom;
  bgMat.uniforms.uShift.value = fx.shift;
  bgMat.uniforms.uView.value.set(view.w, view.h);
  bgMat.uniforms.uFrame.value.set(0, 0, view.w, view.h);

  renderer.clear();
  renderer.render(bgScene, bgCam);
  renderer.clearDepth();
  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
  resize();
  loadTextures();

  // wait for the type so the name never swaps fonts mid-animation (capped so slow fonts never block)
  const fonts = document.fonts
    ? Promise.all([
      document.fonts.load('400 100px "Instrument Serif"'),
      document.fonts.load('400 100px "Geist Mono"'),
    ]).catch(() => {})
    : Promise.resolve();
  await Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]);
  resize();
  // the handwriting and italics aren't needed for the intro; redraw the marks once they arrive
  if (document.fonts) {
    Promise.all([
      document.fonts.load('600 40px Caveat'),
      document.fonts.load('italic 400 40px "Instrument Serif"'),
    ]).catch(() => {}).then(() => { drawDoodles(); buildMarquee(); measureScroll(); });
  }

  const tl = buildTimeline();
  intro.tl = tl;
  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  if ('ResizeObserver' in window) new ResizeObserver(measureScroll).observe($('.page'));

  last = performance.now();
  gsap.ticker.add(tick);

  if (query.has('t')) {
    // debug: freeze the intro at a given time (?t=3.2)
    onAllLoaded(() => {
      gsap.ticker.remove(tick);
      seekIntro(tl, parseFloat(query.get('t')));
      last = performance.now();
      tick();
      document.documentElement.dataset.ready = '1';
    });
    window.__site = { tl, seek: (t) => { seekIntro(tl, t); last = performance.now(); tick(); } };
    return;
  }
  if (reduceMotion) {
    onAllLoaded(() => {
      seekIntro(tl, tl.duration());
      arcState.speed *= 0.3;
      ringState.speed *= 0.3;
    });
    return;
  }
  playLoader();
  // the reels fly out once their photos are decoded, so none arrives blank (capped for very slow networks)
  const cardsReady = new Promise((resolve) => onCardsLoaded(resolve));
  const atLeast = new Promise((resolve) => setTimeout(resolve, 250));
  const cap = new Promise((resolve) => setTimeout(resolve, 8000));
  Promise.race([Promise.all([cardsReady, atLeast]), cap]).then(() => tl.play());
}

boot();
