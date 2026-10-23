import * as THREE from '../vendor/three.module.min.js';

const gsap = window.gsap;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const { lerp, clamp, smoothstep } = THREE.MathUtils;
const TAU = Math.PI * 2;

THREE.ColorManagement.enabled = false;

const PHOTOS = 15;
// backdrop photo: size variants (px wide), aspect, and the point that stays in view when cropped
const BG_WIDTHS = [1600, 2560, 3840];
const BG_ASPECT = 1.5;
const BG_POS = { x: 0.5, y: 0.3 }; // like CSS object-position, y from the top
const BG_FOCUS = { x: 0.5, y: 0.68 }; // zoom anchor (the hill crest), y from the bottom
const pad2 = (n) => String(n).padStart(2, '0');
const cardSrc = (i) => `assets/img/cards/${pad2(i + 1)}.webp`;
const fullSrc = (i) => `assets/img/full/${pad2(i + 1)}.webp`;

const query = new URLSearchParams(location.search);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// The reference plays two intros: a rainbow arc of reels, and a ring you fly into.
// Alternate between them on each visit (?intro=arc|ring forces one).
function pickVariant() {
  const forced = query.get('intro');
  if (forced === 'arc' || forced === 'ring') return forced;
  try {
    const next = localStorage.getItem('sam.intro') === 'arc' ? 'ring' : 'arc';
    localStorage.setItem('sam.intro', next);
    return next;
  } catch {
    return Math.random() < 0.5 ? 'arc' : 'ring';
  }
}
const variant = pickVariant();
const isArc = variant === 'arc';
document.body.classList.add(`intro-${variant}`);

function formatStat(el, v) {
  const dec = parseInt(el.dataset.dec || '0', 10);
  const padTo = parseInt(el.dataset.pad || '0', 10);
  return v.toFixed(dec).padStart(padTo, '0') + (el.dataset.suffix || '');
}

// No WebGL: show the photos as a simple scrolling strip instead of the 3D scene.
function fallback() {
  document.body.classList.add('no-webgl');
  const strip = document.createElement('div');
  strip.className = 'fallback';
  for (let i = 0; i < PHOTOS; i++) {
    const img = new Image();
    img.src = cardSrc(i);
    img.alt = `Photo ${i + 1} of ${PHOTOS}`;
    img.loading = 'lazy';
    strip.appendChild(img);
  }
  document.body.appendChild(strip);
  $('.brand-word').style.visibility = 'visible';
  gsap.set(['.brand-dot', '.crumbs > *', '.mode > *', '.stat', '.u sup'], { opacity: 1 });
  gsap.set('.line-in', { y: 0, yPercent: 0 });
  gsap.set('.u', { '--draw': 1 });
  $$('.stat-num').forEach((el) => { el.textContent = formatStat(el, parseFloat(el.dataset.to)); });
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
const panel = { t: 0, r: 0, b: 0, l: 0, radius: 0 };
const frame = { x: 0, y: 0, w: 1, h: 1 };
const fx = { reveal: 0, inset: 0, zoom: 1.06 };

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
    uPaper: { value: new THREE.Vector3(0.973, 0.973, 0.965) },
    uView: { value: new THREE.Vector2(1, 1) },
    uFrame: { value: new THREE.Vector4(0, 0, 1, 1) },
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
    uniform vec3 uPaper;
    uniform vec2 uView;
    uniform vec4 uFrame; // x, y (from bottom), w, h in css px
    varying vec2 vUv;
    void main() {
      // the photo covers the framed panel like object-fit: cover (uv y up)
      vec2 p = vUv * uView - uFrame.xy;
      vec2 disp = vec2(max(uFrame.z, uFrame.w * uImgAspect));
      disp.y = disp.x / uImgAspect;
      vec2 off = (uFrame.zw - disp) * vec2(uPos.x, 1.0 - uPos.y);
      vec2 uv = (p - off) / disp;
      uv = (uv - uFocus) / uZoom + uFocus;
      // negative lod bias keeps the grass crisp when the photo is drawn smaller than its pixels
      vec3 bgCol = texture2D(uBg, vec2(uv.x, 1.0 - uv.y), -0.5).rgb;
      // soft bloom outward from the middle of the scene
      float d = length(vUv - vec2(0.5, 0.42));
      float e = uReveal * 1.45;
      float m = 1.0 - smoothstep(e - 0.4, e, d);
      m *= smoothstep(0.0, 0.08, uReveal);
      gl_FragColor = vec4(mix(uPaper, bgCol, m), 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
});
const bgQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat);
bgScene.add(bgQuad);

// paints the page colour around the framed panel (rounded, antialiased); drawn last
const maskScene = new THREE.Scene();
const maskMat = new THREE.ShaderMaterial({
  uniforms: {
    uView: bgMat.uniforms.uView,
    uFrame: bgMat.uniforms.uFrame,
    uRadius: { value: 0 },
    uColor: { value: new THREE.Color(0xefefec) },
  },
  vertexShader: bgMat.vertexShader,
  fragmentShader: /* glsl */`
    uniform vec2 uView;
    uniform vec4 uFrame;
    uniform float uRadius;
    uniform vec3 uColor;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv * uView - (uFrame.xy + uFrame.zw * 0.5);
      vec2 q = abs(p) - uFrame.zw * 0.5 + uRadius;
      float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
      float a = smoothstep(-0.5, 0.5, d);
      if (a <= 0.0) discard;
      gl_FragColor = vec4(uColor, a);
    }
  `,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
const maskQuad = new THREE.Mesh(bgQuad.geometry, maskMat);
maskScene.add(maskQuad);
const paperColor = new THREE.Color(0xf8f8f6);
const pageColor = new THREE.Color(0xefefec);

const PETAL_COLORS = ['#ffffff', '#f6b26b', '#fbe3b5', '#f39a4e', '#ffffff', '#f7c873'];
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

const CARD_ASPECT = 16 / 9;

const cardVertex = /* glsl */`
  uniform float uHover;
  uniform float uLift;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
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
    // faint glassy edge
    float edge = 1.0 - smoothstep(0.0, uSize.x * 0.035, -d);
    col += edge * 0.07;
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
      uRadius: { value: size.x * 0.075 },
      uOpacity: { value: 1 },
      uHover: { value: 0 },
      uLift: { value: size.x * 0.08 },
    },
    vertexShader: cardVertex,
    fragmentShader: cardFragment,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

/* ---------- Arc (rainbow) ---------- */
const ARC = { N: 30 };
const arcGroup = new THREE.Group();
const arcState = { t: 0, spin: 0, speed: 0, user: 0 };

/* ---------- Ring (carousel you fly into) ---------- */
const RING = { N: 20, R: 10 };
RING.h = RING.R * 0.45;
RING.w = RING.h / CARD_ASPECT;
const ringGroup = new THREE.Group();
const ringState = { t: 0, spin: 0, speed: 0, user: 0, build: 0 };

function bentPlane(w, h, R) {
  const g = new THREE.PlaneGeometry(w, h, 24, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const a = x / R;
    pos.setXYZ(i, R * Math.sin(a), pos.getY(i), R * (1 - Math.cos(a)));
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

if (isArc) {
  const geo = new THREE.PlaneGeometry(1, CARD_ASPECT);
  const size = new THREE.Vector2(1, CARD_ASPECT);
  for (let i = 0; i < ARC.N; i++) {
    const mat = makeCardMaterial(size);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.order = 'ZYX';
    mesh.visible = false;
    const rank = Math.min(i, ARC.N - i);
    const card = { mesh, mat, photo: i % PHOTOS, theta: (i / ARC.N) * TAU, rank, side: i <= ARC.N / 2 ? 1 : -1, p: 0, hover: 0 };
    mesh.userData.card = card;
    cards.push(card);
    arcGroup.add(mesh);
  }
  scene.add(arcGroup);
} else {
  const geo = bentPlane(RING.w, RING.h, RING.R);
  const size = new THREE.Vector2(RING.w, RING.h);
  const step = TAU / RING.N;
  for (let i = 0; i < RING.N; i++) {
    const mat = makeCardMaterial(size);
    mat.uniforms.uOpacity.value = 0;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    // build starts at the front-right and runs right -> back -> left -> front
    const phi = (3 * Math.PI) / 4 - i * step;
    const photo = i < PHOTOS ? i : (i - PHOTOS + 7) % PHOTOS;
    const card = { mesh, mat, photo, phi, order: i, p: 0, hover: 0 };
    mesh.userData.card = card;
    cards.push(card);
    ringGroup.add(mesh);
  }
  scene.add(ringGroup);
}

/* ---------- textures (decoded off the main thread when possible) ---------- */

const TO_LOAD = PHOTOS + 1; // reels + backdrop
let loadedCount = 0;
let allLoaded = false;
const loadWaiters = [];
function onAllLoaded(fn) { allLoaded ? fn() : loadWaiters.push(fn); }

function applyTexture(i, tex) {
  tex.flipY = false;
  tex.anisotropy = maxAniso;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  renderer.initTexture(tex);
  photoTex[i] = tex;
  for (const c of cards) {
    if (c.photo !== i) continue;
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
// smallest backdrop that still has a pixel for every screen pixel at full screen
function bgSrc() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const need = Math.max(view.w, view.h * BG_ASPECT) * dpr;
  const fits = BG_WIDTHS.filter((w) => w <= renderer.capabilities.maxTextureSize);
  const w = fits.find((x) => x >= need * 0.9) || fits[fits.length - 1];
  return `assets/img/bg/hills-${w}.webp`;
}

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

function loadTextures() {
  const useBitmap = typeof createImageBitmap === 'function';
  const bitmapLoader = useBitmap ? new THREE.ImageBitmapLoader() : null;
  const imgLoader = new THREE.TextureLoader();
  const load = (src, apply) => {
    const viaImage = () => imgLoader.load(src, (t) => { apply(t); markLoaded(); }, undefined, markLoaded);
    if (bitmapLoader) bitmapLoader.load(src, (bmp) => { apply(new THREE.Texture(bmp)); markLoaded(); }, undefined, viaImage);
    else viaImage();
  };
  load(bgSrc(), applyBackdrop);
  for (let i = 0; i < PHOTOS; i++) load(cardSrc(i), (tex) => applyTexture(i, tex));
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
  const fov = lerp(84, 88, land);
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
  renderer.setPixelRatio(view.dpr);
  renderer.setSize(view.w, view.h, false);

  const probe = measure.probe || (measure.probe = Object.assign(document.body.appendChild(document.createElement('div')), {
    style: 'position:absolute;visibility:hidden;pointer-events:none;width:var(--pad);height:var(--radius)',
  }));
  panel.l = panel.r = probe.offsetWidth;
  panel.radius = probe.offsetHeight;
  panel.t = $('.nav').offsetHeight;
  panel.b = $('.foot').offsetHeight;

  const fa = (view.w - panel.l - panel.r) / Math.max(1, view.h - panel.t - panel.b);
  const fa0 = view.w / view.h;
  if (isArc) {
    layout.arcFrom = arcLoaderPose(fa0);
    layout.arcTo = arcFinalPose(fa);
  } else {
    layout.ringFrom = ringLoaderPose(fa0);
    layout.ringTo = ringFinalPose(fa);
  }

  bgCam.right = view.w;
  bgCam.top = view.h;
  bgCam.updateProjectionMatrix();
  bgQuad.position.set(view.w / 2, view.h / 2, 0);
  bgQuad.scale.set(view.w, view.h, 1);
  maskQuad.position.copy(bgQuad.position);
  maskQuad.scale.copy(bgQuad.scale);
}

function resize() {
  measure();
  applyInset();
}

function applyInset() {
  const p = fx.inset;
  const t = panel.t * p, r = panel.r * p, b = panel.b * p, l = panel.l * p;
  maskMat.uniforms.uRadius.value = panel.radius * p;
  maskMat.uniforms.uColor.value.lerpColors(paperColor, pageColor, p);
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

  for (const c of cards) {
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

  camera.fov = lerp(a.fov, b.fov, tf);
  camera.position.copy(vA);
  camera.up.set(0, 1, 0);
  camera.lookAt(lookTarget);
  camera.rotateZ(lerp(a.roll, b.roll, tf));

  ringState.spin += (ringState.speed + ringState.user) * dt;
  ringState.user *= Math.exp(-dt * 2.2);
  ringGroup.rotation.y = ringState.spin;

  const R = RING.R;
  for (const c of cards) {
    const p = c.p;
    c.mesh.visible = p > 0.001;
    if (!c.mesh.visible) continue;
    c.mesh.position.set(R * Math.sin(c.phi), 0, -R * Math.cos(c.phi));
    // hinge open from the previous card
    c.mesh.rotation.set(0, -c.phi - (1 - p) * 1.7, 0);
    const s = 0.72 + 0.28 * p;
    c.mesh.scale.set(s, s, s);
    c.mat.uniforms.uOpacity.value = clamp(p * 1.6, 0, 1);
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
  if (clientX < frame.x || clientX > frame.x + frame.w || clientY < frame.y || clientY > frame.y + frame.h) return null;
  const rect = canvas.getBoundingClientRect();
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(cards.filter((c) => c.mesh.visible).map((c) => c.mesh), false);
  return hits.length ? hits[0].object.userData.card : null;
}

function spinBy(pixels) {
  const k = pixels / Math.max(320, frame.w * 0.55);
  if (isArc) arcState.spin += k;
  else ringState.spin -= k * 0.8;
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
  if (isArc) arcState.user = 0; else ringState.user = 0;
  document.body.classList.add('is-dragging');
});
function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  document.body.classList.remove('is-dragging');
  if (d.moved < 6 && performance.now() - d.start < 500) {
    const card = pick(e.clientX, e.clientY);
    if (card) openLightbox(card.photo);
    return;
  }
  const v = clamp(d.vel, -4, 4);
  if (isArc) arcState.user = v; else ringState.user = -v * 0.8;
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  if (!live) return;
  e.preventDefault();
  const d = clamp(e.deltaY + e.deltaX, -120, 120) * 0.004;
  if (isArc) arcState.user += d; else ringState.user -= d * 0.8;
}, { passive: false });

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
  index: 0,
  open: false,
  returnFocus: null,
};

function showPhoto(i, dir = 0) {
  lb.index = (i + PHOTOS) % PHOTOS;
  lb.count.textContent = `${pad2(lb.index + 1)} / ${pad2(PHOTOS)}`;
  const src = fullSrc(lb.index);
  const pre = new Image();
  pre.src = src;
  const swap = () => {
    lb.img.src = src;
    lb.img.alt = `Photo ${lb.index + 1} of ${PHOTOS}`;
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
    b.textContent = `Open photo ${i + 1}`;
    b.addEventListener('click', () => openLightbox(i, true));
    li.appendChild(b);
    list.appendChild(li);
  }
})();

/* ---------- small DOM bits ---------- */

$$('.mode-btn').forEach((btn) => btn.addEventListener('click', () => {
  $$('.mode-btn').forEach((b) => {
    const on = b === btn;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}));

function countUp(el, duration) {
  const o = { v: 0 };
  return gsap.to(o, {
    v: parseFloat(el.dataset.to), duration, ease: 'expo.out',
    onUpdate: () => { el.textContent = formatStat(el, o.v); },
  });
}

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

function buildTimeline() {
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
  const chars = $$('.loader-name .ch');

  // name + counter
  tl.fromTo(chars, { y: 0, yPercent: 112 }, { yPercent: 0, duration: 0.8, stagger: 0.09 }, 0.04);
  tl.to(counter, { value: 100, duration: 1.15, ease: 'sine.inOut' }, 0);

  if (isArc) {
    // reels fly out of the centre and fan into a rainbow, top first
    for (const c of cards) {
      tl.to(c, { p: 1, duration: 0.6, ease: 'power2.out' }, 0.02 + c.rank * 0.115);
    }
  } else {
    for (const c of cards) {
      tl.to(c, { p: 1, duration: 0.6, ease: 'power3.out' }, 0.12 + c.order * 0.1);
    }
    tl.to(ringState, { speed: 0.12, duration: 1.2, ease: 'sine.in' }, 0.2);
  }

  // hold until every reel is decoded
  const gate = isArc ? 2.3 : 2.45;
  tl.addPause(gate, () => onAllLoaded(() => {
    if (bg.tex) renderer.initTexture(bg.tex);
    requestAnimationFrame(() => tl.play());
  }));

  // backdrop reveal
  tl.to(fx, { reveal: 1, duration: 0.55, ease: 'power2.inOut' }, gate + 0.05);
  tl.to(fx, { zoom: 1, duration: 1.6, ease: 'power2.out' }, gate + 0.05);
  tl.to('.counter', { opacity: 0, filter: 'blur(6px)', y: -8, duration: 0.6, ease: 'power2.inOut' }, gate + 0.1);
  tl.to('.loader-dot', { opacity: 0, duration: 0.3, ease: 'power1.out' }, gate + 0.25);

  // scene transition
  if (isArc) {
    tl.to(arcState, { t: 1, duration: 1.3, ease: 'none' }, gate + 0.25);
    tl.to(arcState, { speed: 0.13, duration: 1.6, ease: 'sine.inOut' }, gate + 0.5);
  } else {
    tl.to(ringState, { t: 1, duration: 1.05, ease: 'none' }, gate + 0.12);
    tl.to(ringState, { speed: 0.21, duration: 1.2, ease: 'sine.inOut' }, gate + 0.4);
  }

  // name shrinks into the nav
  const flip = nameFlip();
  tl.to('.loader-name', { ...flip, duration: 1.0, ease: 'power3.inOut' }, gate + 0.45);
  tl.set('.brand-word', { visibility: 'visible' }, gate + 1.45);
  tl.set('.loader-name', { visibility: 'hidden' }, gate + 1.45);
  tl.fromTo('.brand-dot', { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.5 }, gate + 1.45);
  tl.fromTo(['.crumbs > *', '.mode > *'], { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.035 }, gate + 1.5);

  // frame the scene into the panel
  tl.to(fx, { inset: 1, duration: 0.8, ease: 'power3.inOut', onUpdate: applyInset }, gate + 1.1);

  // copy
  tl.fromTo('.line-in', { y: 0, yPercent: 115 }, { yPercent: 0, duration: 0.95, stagger: 0.12, ease: 'power3.out' }, gate + 1.35);
  tl.to('.stat', { opacity: 1, duration: 0.6, stagger: 0.08, ease: 'power2.out' }, gate + 1.6);
  $$('.stat-num').forEach((el, i) => tl.add(countUp(el, 1.9), gate + 1.6 + i * 0.08));
  tl.to('.u', { '--draw': 1, duration: 0.9, stagger: 0.13, ease: 'power3.out' }, gate + 2.05);
  tl.to('.u sup', { opacity: 1, duration: 0.5, stagger: 0.13, ease: 'power2.out' }, gate + 2.25);

  tl.call(goLive, null, gate + 1.9);
  return tl;
}

function goLive() {
  live = true;
  document.body.classList.add('is-live');
}

// jump straight to a point of the intro without firing its pause / callbacks
function seekIntro(tl, t) {
  tl.pause();
  tl.seek(t, true);
  applyInset();
  // callbacks are suppressed while seeking, so settle the counters by hand
  counter.cols.forEach((c) => { c.pos = -1; });
  updateCounter(10);
  if (t >= tl.duration() - 0.5) {
    $$('.stat-num').forEach((el) => { el.textContent = formatStat(el, parseFloat(el.dataset.to)); });
    goLive();
  }
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

  updateCounter(dt);
  updateHover(dt);
  if (isArc) updateArc(dt); else updateRing(dt);
  updateCamera();
  updatePetals(dt);

  bgMat.uniforms.uReveal.value = fx.reveal;
  bgMat.uniforms.uZoom.value = fx.zoom;
  bgMat.uniforms.uView.value.set(view.w, view.h);
  bgMat.uniforms.uFrame.value.set(frame.x, view.h - frame.y - frame.h, frame.w, frame.h);

  renderer.clear();
  renderer.render(bgScene, bgCam);
  renderer.clearDepth();
  renderer.render(scene, camera);
  if (fx.inset > 0.0005) renderer.render(maskScene, bgCam);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
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

  const tl = buildTimeline();
  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

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
    window.__sam = { tl, seek: (t) => { seekIntro(tl, t); last = performance.now(); tick(); } };
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
  tl.play();
}

boot();
