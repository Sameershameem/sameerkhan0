import * as THREE from '../vendor/three.module.min.js';

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
// Saima's cut-out comes in several heights; the page takes the smallest that covers her on screen
const PORTRAIT_SIZES = [1200, 1600, 2000, 2600];
const portraitSrc = (h) => `assets/img/saima/saima-${h}.webp`;
const portraitFile = (need) => PORTRAIT_SIZES.find((h) => h >= need) || PORTRAIT_SIZES[PORTRAIT_SIZES.length - 1];

// Saima's cut-out, measured from the image: fractions of its width (w) or height (h)
const FIG = {
  aspect: 775 / 1448, // width / height
  headX: 0.54, // centre of her head (w)
  headW: 0.27, // width of her head and scarf at the brow (w)
  headTop: 0.025, // top of her head, from the image top (h)
  chin: 0.18, // chin, from the image top (h)
  bodyHalf: 0.4, // half the figure's width where the scarf drapes over her shoulders (w)
};

// The designs, in order, from the JSON in index.html: title, client, type, aspect, field colour, ink.
const WORKS = (() => {
  try { return JSON.parse($('#works').textContent); } catch { return []; }
})();
const PHOTOS = WORKS.length;

const query = new URLSearchParams(location.search);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;

const intro = { tl: null, done: false };

// No WebGL: the portrait and name as plain page content, and the designs as a scrolling strip.
function fallback() {
  document.body.classList.add('no-webgl');
  const hero = $('.hero');
  const name = document.createElement('p');
  name.className = 'fallback-name';
  name.innerHTML = 'Saima <em>Ahmed</em>';
  const img = new Image();
  img.className = 'fallback-portrait';
  img.src = portraitSrc(1600);
  img.alt = 'Saima Ahmed';
  hero.append(name, img);
  const strip = document.createElement('div');
  strip.className = 'fallback';
  WORKS.forEach((w, i) => {
    const im = new Image();
    im.src = cardSrc(i);
    im.alt = w.client ? `${w.title}, ${w.client}` : w.title;
    im.loading = 'lazy';
    strip.appendChild(im);
  });
  $('.work').appendChild(strip);
  $('.brand-word').style.visibility = 'visible';
  gsap.set(['.brand-dot', '.nav-work'], { opacity: 1 });
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
  // dense screens don't need multisampling: the cards and the cut-out antialias their own edges
  renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 1.5, powerPreference: 'high-performance' });
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
const clearTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
clearTex.needsUpdate = true;
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
/* Scene: the designs, Saima and her name                              */
/* ------------------------------------------------------------------ */

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 500);

// World units: the frame (the rect the scene is composed for) is 10 units tall at z = 0.
const CAM_FOV = 30;
const CAM_DIST = 5 / Math.tan(THREE.MathUtils.degToRad(CAM_FOV / 2));
camera.position.set(0, 0, CAM_DIST);

// Draw order of the see-through layers, back to front: her name, the designs behind her, her
// shadow and Saima herself, then the designs in front of her.
const ORDER = { name: 0, behind: 1, shadow: 2, saima: 3, front: 4 };

const uvVertex = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/* ---------- design cards ---------- */

// a card's height is its width times its design's aspect (1 for square posts, 1.25 for 4:5)
const aspectOf = (i) => (WORKS[i] && WORKS[i].aspect) || 1;

const cardVertex = /* glsl */`
  uniform float uHover;
  uniform float uLift;
  uniform float uBend;   // 1 = curved to sit on a ring, 0 = flat
  uniform float uBendR;  // ring radius in the card's own units; negative bends round the outside
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
      uBendR: { value: -10 },
    },
    vertexShader: cardVertex,
    fragmentShader: cardFragment,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

// a soft shadow under each card once it lies flat (in the reel and the work wheel)
const SHADOW_PAD = 1.5;
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
      vertexShader: uvVertex,
      fragmentShader: shadowFragment,
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.position.set(0, -h * 0.07, -0.08);
  mesh.renderOrder = -1;
  return mesh;
}

// One card per design. They build a circle while the page loads, then orbit Saima, travel down the
// page, settle on the work wheel and finish as a ring above the footer.
const RING = { N: PHOTOS, R: 10 };
RING.w = ((TAU * RING.R) / RING.N) * 0.86;
RING.h = RING.w; // a square card's height; poses size cards by it
const ringState = { spin: 0, speed: 0, user: 0, orbit: 0 };

const cards = [];
{
  const geos = {};
  for (let i = 0; i < PHOTOS; i++) {
    const asp = aspectOf(i);
    const geo = geos[asp] || (geos[asp] = new THREE.PlaneGeometry(RING.w, RING.w * asp, 24, 1));
    const mat = makeCardMaterial(new THREE.Vector2(RING.w, RING.w * asp));
    // cards face out from the ring, so they curve away from the viewer round its outside
    mat.uniforms.uBendR.value = -RING.R;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    const shadow = makeShadow(RING.w, RING.w * asp);
    mesh.add(shadow);
    const card = {
      mesh, mat, shadow,
      photo: i,
      order: i,
      aspect: asp,
      theta: (i / PHOTOS) * TAU, // its place round the circle and the orbit; 0 is the top / the front
      rank: Math.min(i, PHOTOS - i), // the circle builds out from the top, both ways round
      side: i <= PHOTOS / 2 ? 1 : -1,
      p: 0,
      hover: 0,
      hi: false,
    };
    mesh.userData.card = card;
    cards.push(card);
    scene.add(mesh);
  }
}

/* ---------- Saima ---------- */

const SAIMA_Z = 0;
const saima = { rise: 0, sheen: -1, x: 0, y: -5, H: 9, op: 0 };
const saimaGeo = new THREE.PlaneGeometry(FIG.aspect, 1);
saimaGeo.translate(0, 0.5, 0); // origin at the middle of the bottom edge, where she is cropped
// She is drawn flat to the screen at a box in the canvas's own pixels (uRect, set by placeSaima), so
// the pointer's parallax moves the ring and her name round her while she stays pin-sharp. Her mesh
// keeps its place in the scene for picking; the draw order layers her, so she needs no depth test.
const saimaMat = new THREE.ShaderMaterial({
  uniforms: { uMap: { value: clearTex }, uOpacity: { value: 0 }, uSheen: { value: -1 }, uRect: { value: new THREE.Vector4(-1, -1, 0, 0) } },
  vertexShader: /* glsl */`
    uniform vec4 uRect; // left, bottom, width, height in clip space
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(uRect.xy + uv * uRect.zw, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D uMap;
    uniform float uOpacity;
    uniform float uSheen;
    varying vec2 vUv;
    void main() {
      // the texture is sized to her pixels on screen; the bias keeps it on the full-size level
      vec4 t = texture2D(uMap, vec2(vUv.x, 1.0 - vUv.y), -0.6);
      if (t.a < 0.004) discard;
      // a touch of warmth so she sits in the sunlit meadow
      vec3 c = t.rgb * vec3(1.03, 1.0, 0.97);
      // a band of light passes over her as she arrives
      float band = exp(-pow((vUv.x * 0.5 + vUv.y - uSheen) * 6.0, 2.0));
      c = mix(c, vec3(1.0, 0.98, 0.94), band * 0.22);
      gl_FragColor = vec4(c, t.a * uOpacity);
    }
  `,
  transparent: true,
  depthWrite: false,
  depthTest: false,
});
const saimaMesh = new THREE.Mesh(saimaGeo, saimaMat);
saimaMesh.renderOrder = ORDER.saima;
saimaMesh.frustumCulled = false;
saimaMesh.visible = false;
scene.add(saimaMesh);

// a soft shadow just behind her, from her own silhouette blurred through the texture's mipmaps
const saimaShadowMat = new THREE.ShaderMaterial({
  uniforms: { uMap: { value: clearTex }, uAlpha: { value: 0 } },
  vertexShader: uvVertex,
  fragmentShader: /* glsl */`
    uniform sampler2D uMap;
    uniform float uAlpha;
    varying vec2 vUv;
    void main() {
      float a = texture2D(uMap, vec2(vUv.x, 1.0 - vUv.y), 3.5).a;
      gl_FragColor = vec4(0.05, 0.09, 0.18, a * uAlpha);
    }
  `,
  transparent: true,
  depthWrite: false,
});
const saimaShadow = new THREE.Mesh(saimaGeo, saimaShadowMat);
saimaShadow.renderOrder = ORDER.shadow;
saimaShadow.visible = false;
scene.add(saimaShadow);

// her outline at low resolution, so a click on her (and not on the sky beside her) can be told apart
const portraitMask = { data: null, w: 0, h: 0 };
function buildPortraitMask(img) {
  const w = 96, h = Math.round(96 / FIG.aspect);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  portraitMask.data = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) portraitMask.data[k] = px[k * 4 + 3];
  portraitMask.w = w;
  portraitMask.h = h;
}
function portraitAlpha(u, v) {
  const { data, w, h } = portraitMask;
  if (!data) return 0;
  const x = clamp(Math.floor(u * w), 0, w - 1);
  const y = clamp(Math.floor((1 - v) * h), 0, h - 1);
  return data[y * w + x] / 255;
}

/* ---------- her name, behind her ---------- */

// Each word is drawn into its own canvas at the size it is shown, and its letters rise in one by one.
const nameAnim = { t: 0 };
const NAME_COLOR = new THREE.Color('#fffaf2');
const nameFragment = /* glsl */`
  uniform sampler2D uMap;
  uniform float uT;          // seconds since the letters started to rise
  uniform float uEdges[9];   // where each letter starts, across the word (0..1)
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float letter = 0.0;
    for (int i = 1; i < 9; i++) letter += step(uEdges[i], vUv.x);
    float p = clamp((uT - letter * 0.075) / 0.95, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - p, 4.0);
    // each letter slides up out of a slot at the bottom of the word
    float sy = vUv.y + (1.0 - e);
    if (sy > 1.0) discard;
    float a = texture2D(uMap, vec2(vUv.x, sy)).a;
    gl_FragColor = vec4(uColor, a * uOpacity * smoothstep(0.0, 0.25, p));
  }
`;
const nameWords = [
  { text: 'Saima', italic: false },
  { text: 'Ahmed', italic: true },
].map((w) => {
  const cv = document.createElement('canvas');
  const tex = new THREE.CanvasTexture(cv);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex },
      uT: { value: 0 },
      uEdges: { value: new Array(9).fill(2) },
      uOpacity: { value: 0 },
      uColor: { value: NAME_COLOR },
    },
    vertexShader: uvVertex,
    fragmentShader: nameFragment,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = ORDER.name;
  mesh.visible = false;
  scene.add(mesh);
  return { ...w, cv, tex, mat, mesh, ready: false, cx: 0, cy: 0, pw: 1, ph: 1 };
});

/* ---------- textures (decoded off the main thread when possible) ---------- */

const TO_LOAD = PHOTOS + 2; // designs, backdrop and portrait
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
  const c = cards[i];
  if (c && !c.hi) {
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
// Image URLs, sized for this screen, and their early downloads come from the inline script in index.html.
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
async function decodeBlob(blob, options = undefined) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob, options); } catch { /* decode through an <img> instead */ }
  }
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  URL.revokeObjectURL(img.src);
  return img;
}
async function decodeImage(url, fresh = false, options = undefined) {
  return decodeBlob(await fetchBlob(url, fresh), options);
}
// an early download that failed gets one fresh try
const loadImage = (url, options) => decodeImage(url, false, options).catch(() => decodeImage(url, true, options));

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

// Saima's texture is resampled by the browser's high-quality scaler to exactly her height in the
// canvas's pixels, so the GPU draws it 1:1 instead of blending in a softer mipmap level
const portrait = { blob: null, fileH: 0, tex: null, texW: 0, texH: 0, busy: false };
function portraitNeed() {
  const fh = Math.max(1, view.h - panel.t);
  return Math.max(64, Math.round((hero.Hs / 10) * fh * (canvas.height / Math.max(1, view.h))));
}
function decodePortrait() {
  const need = portraitNeed();
  const k = need / portrait.fileH;
  const opts = { premultiplyAlpha: 'none' }; // straight alpha, so her edges blend cleanly over the sky
  if (k > 0.3 && k < 1.3 && Math.abs(k - 1) > 0.005) {
    Object.assign(opts, { resizeWidth: Math.round(need * FIG.aspect), resizeHeight: need, resizeQuality: 'high' });
  }
  return decodeBlob(portrait.blob, opts);
}
function applyPortrait(img) {
  const tex = prepTexture(new THREE.Texture(img));
  tex.anisotropy = 1;
  renderer.initTexture(tex);
  const old = portrait.tex;
  portrait.tex = tex;
  portrait.texW = img.width;
  portrait.texH = img.height;
  saimaMat.uniforms.uMap.value = tex;
  saimaShadowMat.uniforms.uMap.value = tex;
  if (old) {
    old.dispose();
    if (old.image && old.image.close) old.image.close();
  }
  if (!portraitMask.data) buildPortraitMask(img);
}
async function loadPortrait() {
  portrait.fileH = assets.portraitH || portraitFile(portraitNeed());
  const url = assets.portrait || portraitSrc(portrait.fileH);
  portrait.blob = await fetchBlob(url).catch(() => fetchBlob(url, true));
  applyPortrait(await decodePortrait());
}
// after a resize: a new size from the same file, or a bigger file for a bigger screen
async function refreshPortrait() {
  if (!portrait.blob || portrait.busy) return;
  const need = portraitNeed();
  if (Math.abs(need - portrait.texH) / portrait.texH < 0.04) return;
  portrait.busy = true;
  try {
    const file = portraitFile(need);
    if (file > portrait.fileH) {
      portrait.blob = await fetchBlob(portraitSrc(file), true);
      portrait.fileH = file;
    }
    applyPortrait(await decodePortrait());
    quality.wait = Math.max(quality.wait, 0.3);
  } catch { /* keep the texture it has */ }
  portrait.busy = false;
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
  loadPortrait().catch(() => {}).finally(markLoaded);
}

// The design in focus on the work wheel, and its neighbours, swap to sharper textures so their type
// stays crisp: the full-size file where the design is drawn large, the 768 px card elsewhere. Their
// upload waits for a quiet moment, so it never interrupts a scroll.
const hiRes = new Map(); // design index -> { img, tex, dropped }
const uploads = [];
let lastUpload = 0;
function focusSrc(i) {
  const px = work.Ha * ((view.h - panel.t) / 10) * view.dpr;
  return px > 800 ? fullSrc(i) : cardSrc(i);
}
function wantHiRes(i) {
  if (hiRes.has(i)) return;
  const url = focusSrc(i);
  if (url === assets.cards[i]) return; // the card texture is already sharp enough
  const entry = { img: null, tex: null, dropped: false };
  hiRes.set(i, entry);
  loadImage(url).then((img) => {
    if (entry.dropped) { if (img.close) img.close(); return; }
    entry.img = img;
    uploads.push(i);
  }).catch(() => hiRes.delete(i));
}
function flushUploads(now) {
  // an upload can take a frame or two on a phone, so it waits until the page (and the wheel) is still
  if (!uploads.length || now - lastUpload < 200 || scroll.still < 0.7) return;
  const i = uploads.shift();
  const entry = hiRes.get(i);
  if (!entry || entry.dropped || !entry.img) return;
  entry.tex = prepTexture(new THREE.Texture(entry.img));
  renderer.initTexture(entry.tex);
  lastUpload = now;
  quality.wait = Math.max(quality.wait, 0.2);
  cards[i].mat.uniforms.uMap.value = entry.tex;
  cards[i].hi = true;
}
function dropHiRes(i) {
  const entry = hiRes.get(i);
  if (!entry) return;
  entry.dropped = true;
  hiRes.delete(i);
  const c = cards[i];
  c.mat.uniforms.uMap.value = photoTex[i] || blankTex;
  c.hi = false;
  if (entry.tex) entry.tex.dispose();
  if (entry.img && entry.img.close) entry.img.close();
}
function updateHiRes(now) {
  const on = scroll.w > 0.35 && scroll.f < 0.5;
  const center = Math.round(scroll.act);
  for (const i of hiRes.keys()) if (!on || Math.abs(i - center) > 1) dropHiRes(i);
  if (on) {
    wantHiRes(center);
    if (center > 0) wantHiRes(center - 1);
    if (center < PHOTOS - 1) wantHiRes(center + 1);
  }
  flushUploads(now);
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

// the circle the designs build while loading
const loader = { y: -0.4, R: 3, s: 0.4 };
// the hero: Saima stands on the bottom edge, the ring orbits her hands and waist
const hero = { wide: true, fa: 1.6, Hs: 9, x: 0, R: 6, tilt: 0.17, nameZ: -8.5, em: 2.5, note: new THREE.Vector3() };
// the hand-written note under her name, a DOM element placed from hero.note
const note = { el: $('.hero-note'), on: false, fits: true, x: -1, y: -1, op: -1 };
// About on wide screens: she steps into the right half and the ring tightens round her
const about = { x: 4, Hs: 8, R: 3.5 };
const quality = { scale: 1, n: 0, late: 0, wait: 2 };
let fontsReady = false;

function layoutLoader(fa0) {
  loader.R = Math.min(3, 10 * fa0 * 0.34);
  loader.s = (((TAU * loader.R) / PHOTOS) * 1.04) / RING.w;
}

function layoutHero(fa) {
  const W = 10 * fa;
  hero.fa = fa;
  hero.wide = fa >= 1;
  hero.Hs = hero.wide ? lerp(9.1, 8.6, smoothstep(fa, 1.3, 2.4)) : lerp(7.0, 8.2, smoothstep(fa, 0.45, 0.95));
  const Ws = hero.Hs * FIG.aspect;
  hero.x = 0;
  // the side cards' inner edges must clear her shoulders: an edge sits at R * (1 - half a card)
  const edge = 1 - (0.5 * RING.w) / RING.R;
  const minR = (FIG.bodyHalf * Ws + 0.25) / edge;
  hero.R = Math.max(minR, hero.wide ? Math.min(6.4, W * 0.36) : Math.min(3.3, W * 0.64));
  hero.nameZ = -(hero.R + 2.5);
  about.R = Math.max(2, W / 4 - 0.45);
  about.Hs = Math.min(hero.Hs * 0.92, (about.R * edge - 0.25) / (FIG.bodyHalf * FIG.aspect));
  about.x = W / 4 + 0.2;
}

// metrics of a word drawn at px size: ink box and letter starts, all in px
function measureWord(word, px) {
  const ctx = word.cv.getContext('2d');
  ctx.font = `${word.italic ? 'italic ' : ''}400 ${px}px "Instrument Serif", "Times New Roman", serif`;
  const m = ctx.measureText(word.text);
  const left = m.actualBoundingBoxLeft || 0;
  const right = m.actualBoundingBoxRight || m.width;
  const asc = m.actualBoundingBoxAscent || px * 0.7;
  const desc = m.actualBoundingBoxDescent || px * 0.2;
  const starts = [];
  for (let k = 0; k < word.text.length; k++) starts.push(ctx.measureText(word.text.slice(0, k)).width);
  return { left, right, asc, desc, ink: left + right, starts };
}

// sizes and draws the two words, and places them round her head
function layoutName() {
  if (!fontsReady) return;
  const fh = Math.max(1, view.h - panel.t);
  const upx = (fh / 10) * view.dpr; // texture px per world unit at z = 0
  const W = 10 * hero.fa;
  const Ws = hero.Hs * FIG.aspect;
  const [w0, w1] = nameWords;
  const m0 = measureWord(w0, 100), m1 = measureWord(w1, 100);
  const headX = hero.x + (FIG.headX - 0.5) * Ws;
  const headTop = -5 + hero.Hs * (1 - FIG.headTop);
  const chin = -5 + hero.Hs * (1 - FIG.chin);
  const asc = Math.max(m0.asc, m1.asc) / 100;
  let em, place;
  if (hero.wide) {
    // one line, split round her head like a magazine masthead
    const gap = FIG.headW * Ws + 0.8;
    const leftRoom = headX - gap / 2 - (-W / 2 + 0.5);
    const rightRoom = W / 2 - 0.5 - (headX + gap / 2);
    em = Math.min(leftRoom / (m0.ink / 100), rightRoom / (m1.ink / 100), (4.7 - chin) / asc);
    place = [{ x: headX - gap / 2, y: chin, align: 'right' }, { x: headX + gap / 2, y: chin, align: 'left' }];
  } else {
    // two lines above her, the second tucked just behind the top of her head
    em = (Math.min((W - 0.8) / (m0.ink / 100), (W - 0.8) / (m1.ink / 100))) * 0.94;
    const fit = (e) => headTop - 0.12 * e + 0.95 * e + asc * e;
    if (fit(em) > 4.75) em *= (4.75 - headTop) / (fit(em) - headTop);
    const base2 = headTop - 0.12 * em;
    place = [{ x: -W / 2 + 0.4, y: base2 + 0.95 * em, align: 'left' }, { x: W / 2 - 0.4, y: base2, align: 'right' }];
  }
  hero.em = em;
  const px = Math.max(8, Math.round(em * upx));
  nameWords.forEach((word, k) => {
    const m = measureWord(word, px);
    const pad = Math.ceil(px * 0.08);
    const cw = Math.ceil(m.ink + pad * 2), ch = Math.ceil(m.asc + m.desc + pad * 2);
    word.cv.width = cw;
    word.cv.height = ch;
    const ctx = word.cv.getContext('2d');
    ctx.font = `${word.italic ? 'italic ' : ''}400 ${px}px "Instrument Serif", "Times New Roman", serif`;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    const ox = pad + m.left, oy = pad + m.asc;
    ctx.fillText(word.text, ox, oy);
    const edges = new Array(9).fill(2);
    m.starts.forEach((s, n) => { edges[n] = (ox + s) / cw; });
    word.mat.uniforms.uEdges.value = edges;
    word.tex.dispose();
    word.tex.image = word.cv;
    word.tex.needsUpdate = true;
    // place by the ink box and the baseline, in world units as seen at z = 0
    word.pw = cw / upx;
    word.ph = ch / upx;
    const p = place[k];
    const left = p.align === 'right' ? p.x - (pad + m.ink) / upx : p.x - pad / upx;
    word.cx = left + word.pw / 2;
    word.cy = p.y - (ch - oy) / upx + word.ph / 2;
    word.ready = true;
  });
  // the hand-written note hangs just under the end of "Ahmed", clear of her face:
  // where one line would reach over it, it breaks onto two, and if even that won't fit it stays hidden
  const last = nameWords[1];
  const noteR = last.cx + last.pw / 2 - Math.ceil(px * 0.08) / upx;
  hero.note.set(noteR, place[1].y - 0.16 * em, 0);
  if (note.el) {
    const unitPx = fh / 10; // css px per world unit at z = 0
    const clear = (headX + (FIG.headW / 2) * Ws + 0.08) * unitPx;
    const hn = note.el.querySelector('.hn');
    note.el.classList.remove('is-stacked');
    note.fits = noteR * unitPx - hn.offsetWidth > clear;
    if (!note.fits) {
      note.el.classList.add('is-stacked');
      note.fits = noteR * unitPx - hn.offsetWidth > clear;
    }
  }
  renderer.initTexture(w0.tex);
  renderer.initTexture(w1.tex);
}

// up to 2x with a mouse, 3x on phones and tablets; a huge, dense screen draws a little under its own
function targetDpr() {
  const fit = Math.sqrt(16e6 / Math.max(1, view.w * view.h));
  return Math.min(window.devicePixelRatio || 1, finePointer ? 2 : 3, fit);
}

function measure() {
  view.w = Math.max(1, canvas.clientWidth);
  view.h = Math.max(1, canvas.clientHeight);
  // the canvas works at the screen's own density, so the scene is as sharp as the page's text;
  // slower devices step down from there
  view.dpr = Math.max(1, targetDpr() * quality.scale);
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
  layoutLoader(view.w / view.h);
  layoutHero(fa);
  measureStrip(fa);

  bgCam.right = view.w;
  bgCam.top = view.h;
  bgCam.updateProjectionMatrix();
  bgQuad.position.set(view.w / 2, view.h / 2, 0);
  bgQuad.scale.set(view.w, view.h, 1);
}

let decorTimer = 0;
const laidOut = { w: 0, h: 0 };
function resize(force = false) {
  // phones fire resizes as their address bar slides in and out mid-scroll; the canvas (100lvh) keeps
  // its size through those, so nothing is redone and the scroll carries on undisturbed
  if (!force && canvas.clientWidth === laidOut.w && canvas.clientHeight === laidOut.h) return;
  laidOut.w = canvas.clientWidth;
  laidOut.h = canvas.clientHeight;
  measure();
  applyInset();
  measureScroll();
  clearTimeout(decorTimer);
  decorTimer = setTimeout(() => {
    layoutName();
    drawDoodles();
    buildMarquee();
    refreshPortrait();
  }, 120);
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
/* Scroll: hero -> about -> work -> footer                             */
/* ------------------------------------------------------------------ */

// a: hero -> about; on wide screens Saima steps aside with the ring, on tall ones the ring
//    unrolls into a reel that travels with the page
// w: about -> work, the cards turn into a wheel that brings one design forward at a time (act)
// f: work -> footer, the cards roll back up into a ring above the footer
const scroll = { y: 0, raw: 0, vh: 1, footTop: 1, a: 0, w: 0, f: 0, act: 0, dim: 0, offset: 0, tint: 0, vel: 0, still: 0, settle: 0 };
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
const textRects = []; // the copy blocks' boxes in page coordinates, so no layout is read per frame

function measureScroll() {
  scroll.vh = view.h; // the large viewport: steady while a phone's address bar comes and goes
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
  const sy = window.scrollY;
  textRects.length = 0;
  for (const el of textBlocks) {
    const r = el.getBoundingClientRect();
    textRects.push({ top: r.top + sy, bottom: r.bottom + sy, left: r.left, right: r.right });
  }
}

// smooth wheel scrolling on desktop, quick to follow the wheel; touch keeps the browser's own momentum
const lenis = window.Lenis && finePointer && !reduceMotion ? new window.Lenis({ lerp: 0.12, smoothWheel: true }) : null;
if (lenis) lenis.stop();
const easeScroll = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function scrollToY(y, duration = 1.2) {
  if (lenis) lenis.scrollTo(y, { duration, easing: easeScroll });
  else window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
}

// scroll the page so design i sits in focus on the wheel
function goToWork(i) {
  scrollToY(work.top + i * work.step, 1.1);
}

// the reel is a column beside the copy on wide screens, a band across tall ones
function measureStrip(fa) {
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
  for (const r of textRects) {
    if (r.right < x0 || r.left > x1) continue;
    const iy = Math.min(y1, r.bottom - scroll.raw) - Math.max(y0, r.top - scroll.raw);
    if (iy > 0) cover = Math.max(cover, iy / (y1 - y0));
  }
  return clamp(cover * 2.5, 0, 1);
}

function updateScroll(dt) {
  const raw = live ? window.scrollY : 0;
  // the nav steps aside while reading down the page and returns on the way back up
  const dy = raw - scroll.raw;
  let away = nav.classList.contains('is-away');
  if (raw > scroll.vh * 0.5 && dy > 3 && intro.done) away = true;
  else if (dy < -3 || raw < scroll.vh * 0.5) away = false;
  if (away !== nav.classList.contains('is-away')) nav.classList.toggle('is-away', away);
  scroll.vel += ((dt > 0 ? dy / dt : 0) - scroll.vel) * (1 - Math.exp(-dt * 6));
  scroll.still = Math.abs(dy) > 0.5 ? 0 : scroll.still + dt;
  scroll.raw = raw;

  // the page itself scrolls smoothly (Lenis on wheels, momentum on touch), so the scene follows it
  // exactly; a plain wheel without Lenis gets a little smoothing of its own
  if (lenis || !finePointer) scroll.y = raw;
  else {
    scroll.y += (raw - scroll.y) * (1 - Math.exp(-dt * 14));
    if (Math.abs(raw - scroll.y) < 0.05) scroll.y = raw;
  }
  const { y, vh } = scroll;
  const footStart = scroll.footTop - vh; // the footer's top edge reaches the bottom of the screen
  const workStart = work.top - vh * 0.78;
  scroll.a = smoothstep(y, vh * 0.02, vh * 0.9);
  scroll.w = smoothstep(y, workStart, work.top - vh * 0.04);
  scroll.f = smoothstep(y, footStart + vh * 0.05, footStart + vh * 0.9);
  // once the page comes to rest, the wheel turns on to the nearest design so it never stops halfway
  const act = clamp((y - work.top) / work.step, 0, PHOTOS - 1);
  const settleTo = scroll.still > 0.15 && scroll.w > 0.98 && scroll.f < 0.02 ? Math.round(act) - act : 0;
  scroll.settle += (settleTo - scroll.settle) * (1 - Math.exp(-dt * 6));
  scroll.act = act + scroll.settle;
  // the reel only travels while every card is in it, so no card wraps around mid-flight
  scroll.offset = (clamp(y, vh * 0.9, Math.max(vh * 0.9, workStart)) - vh * 0.9) / vh * strip.perVh;
  // the hills sink as the page rises, leaving open sky behind the copy
  fx.shift = lerp(0.55 * (1 - Math.pow(1 - scroll.a, 3)), 0.62, easeInOut2(scroll.f));
  const cover = !hero.wide && scroll.a * (1 - scroll.w) * (1 - scroll.f) > 0.01 ? textOverlap() : 0;
  scroll.dim += (cover - scroll.dim) * (1 - Math.exp(-dt * 6));

  // the page takes on the colour of the design in focus, and its text turns light on dark ones
  const i0 = Math.floor(scroll.act), i1 = Math.min(PHOTOS - 1, i0 + 1);
  tint.copy(fieldColors[i0]).lerp(fieldColors[i1], smoothstep(scroll.act - i0, 0.3, 0.7));
  scroll.tint = 0.9 * easeInOut2(scroll.w) * (1 - easeInOut2(scroll.f));
  const light = scroll.tint > 0.45 && WORKS[Math.round(scroll.act)].ink === 'light';
  if (light !== document.body.classList.contains('ink-light')) document.body.classList.toggle('ink-light', light);
}

/* ------------------------------------------------------------------ */
/* Poses                                                               */
/* ------------------------------------------------------------------ */

const easeInOut3 = gsap.parseEase('power3.inOut');
const easeInOut2 = gsap.parseEase('power2.inOut');

const p1 = new THREE.Vector3();
const p2 = new THREE.Vector3();
const p3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const q3 = new THREE.Quaternion();
const qy = new THREE.Quaternion();
const eul = new THREE.Euler();
const eulZYX = new THREE.Euler(0, 0, 0, 'ZYX');
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const ringCenter = new THREE.Vector3();
const footCenter = new THREE.Vector3();
const camLook = new THREE.Vector3();
const projected = new THREE.Vector3();

// a card on the loading circle; it flies out of the centre edge-on, then opens up, its top outwards
function loaderPose(c, pos, quat) {
  const r = loader.R * c.p;
  pos.set(r * Math.sin(c.theta), loader.y + r * Math.cos(c.theta), 0);
  quat.setFromEuler(eulZYX.set(0, (1 - c.p) * Math.PI * 0.5 * c.side, -c.theta));
  return loader.s * (0.3 + 0.7 * c.p);
}

// a card on a ring round `center`, tilted back by `tilt`, facing out; ph = 0 is the front
function orbitPose(ph, center, R, tilt, pos, quat) {
  pos.set(R * Math.sin(ph), 0, R * Math.cos(ph)).applyAxisAngle(AXIS_X, tilt).add(center);
  quat.setFromAxisAngle(AXIS_X, tilt).multiply(qy.setFromAxisAngle(AXIS_Y, ph));
  return R / RING.R;
}

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

// a card's place in the tilted ring above the footer; returns its scale
function footPose(ph, pos, quat) {
  return orbitPose(ph, footCenter.set(0, footRing.yc, 0), footRing.R, FOOT_TILT, pos, quat);
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

/* ------------------------------------------------------------------ */
/* Per-frame scene update                                              */
/* ------------------------------------------------------------------ */

const pointer = { x: 0, y: 0, sx: 0, sy: 0, px: -1, py: -1, inside: false, moved: false };
let clock = 0;

// Saima's box in the canvas's own pixels, as the unmoved camera sees her at z = 0. Once she is at
// rest it is snapped to whole pixels and to the texture's exact size, so every texel lands on a pixel.
const sBox = { l: 0, b: 0, h: 0 };
function placeSaima(x, y, H) {
  const bw = canvas.width, bh = canvas.height;
  const kx = bw / view.w, ky = bh / view.h; // canvas pixels per css px
  const unit = frame.h / 10; // css px per world unit at z = 0
  let h = H * unit * ky;
  let l = (frame.x + frame.w / 2 + (x - (H * FIG.aspect) / 2) * unit) * kx;
  let b = bh - (frame.y + frame.h / 2 - y * unit) * ky;
  const still = Math.abs(l - sBox.l) + Math.abs(b - sBox.b) + Math.abs(h - sBox.h) < 0.3;
  sBox.l = l;
  sBox.b = b;
  sBox.h = h;
  let w = h * FIG.aspect;
  if (still) {
    if (portrait.texH && Math.abs(h / portrait.texH - 1) < 0.02) {
      l += (w - portrait.texW) / 2;
      w = portrait.texW;
      h = portrait.texH;
    }
    l = Math.round(l);
    b = Math.round(b);
  }
  saimaMat.uniforms.uRect.value.set((l / bw) * 2 - 1, (b / bh) * 2 - 1, (w / bw) * 2, (h / bh) * 2);
}

function updateScene(dt) {
  ringState.spin += (ringState.speed + ringState.user) * dt;
  ringState.user *= Math.exp(-dt * 2.2);
  // scrolling turns the ring too, so it keeps moving while the page does
  const spin = ringState.spin + (scroll.y / scroll.vh) * 1.1;
  const wide = hero.wide;
  const ea = easeInOut2(scroll.a);

  // Saima: rises in, steps into the right half for About on wide screens (or sinks away on tall
  // ones), and sinks away as the work arrives
  const H = wide ? lerp(hero.Hs, about.Hs, ea) : hero.Hs;
  const x = wide ? lerp(hero.x, about.x, ea) : hero.x;
  // on tall screens she clears out quickly, before the About copy reaches her
  const leave = Math.min(1, easeInOut2(clamp(scroll.w * 1.3, 0, 1)) + (wide ? 0 : easeInOut2(clamp(scroll.a * 1.7, 0, 1))));
  const y = -5 - (1 - saima.rise) * H * 0.6 - leave * H * 1.08;
  const op = smoothstep(saima.rise, 0, 0.25) * (1 - scroll.f);
  const shown = op > 0.004 && y + H > -5.05;
  // the ring stays round her waist even while she rises in
  ringCenter.set(x, -5 + H * 0.4, 0);
  const R = wide ? lerp(hero.R, about.R, ea) : hero.R;

  for (const c of cards) {
    if (c.p <= 0.001) { c.mesh.visible = false; continue; }
    const ph = c.theta + spin;
    // the loading circle tips back into the orbit, each card a moment after the one before
    const oi = easeInOut3(clamp(ringState.orbit * 1.4 - 0.4 * (c.order / PHOTOS), 0, 1));
    let s, bend;
    let opacity = clamp(c.p * 1.6, 0, 1);
    if (oi < 1) {
      s = loaderPose(c, p1, q1);
      bend = 0;
      if (oi > 0) {
        const os = orbitPose(ph, ringCenter, R, hero.tilt, p2, q2);
        p1.lerp(p2, oi);
        q1.slerp(q2, oi);
        s = lerp(s, os, oi);
        bend = oi;
      }
    } else {
      s = orbitPose(ph, ringCenter, R, hero.tilt, p1, q1);
      bend = 1;
    }
    p1.y += Math.sin(clock * 1.2 + c.order * 1.3) * 0.05 * oi; // a gentle bob while orbiting

    // tall screens: About unrolls the orbit into a reel; the back of the ring leaves first
    const ai = wide ? 0 : easeInOut2(clamp((scroll.a - 0.35 * (1 + Math.cos(ph)) * 0.5) / 0.65, 0, 1));
    // the cards nearest the first design reach the wheel first
    const wi = easeInOut2(clamp((scroll.w - 0.3 * Math.min(1, Math.abs(c.order - scroll.act) / 6)) / 0.7, 0, 1));
    const fi = easeInOut2(clamp((scroll.f - 0.3 * (c.order / RING.N)) / 0.7, 0, 1));
    if (ai > 0 || wi > 0 || fi > 0) {
      if (ai > 0) {
        const ss = stripPose(c, p2, q2);
        p1.lerp(p2, ai);
        q1.slerp(q2, ai);
        s = lerp(s, ss, ai);
        bend *= 1 - ai;
      }
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
    c.mesh.visible = true;
    c.mesh.position.copy(p1);
    c.mesh.quaternion.copy(q1);
    c.mesh.scale.setScalar(s);
    // behind her or in front of her
    c.mesh.renderOrder = shown && p1.z < SAIMA_Z ? ORDER.behind : ORDER.front;
    c.mat.uniforms.uBend.value = bend;
    c.mat.uniforms.uOpacity.value = opacity;
    const sa = 0.34 * opacity * (1 - bend);
    c.shadow.visible = sa > 0.002;
    c.shadow.material.uniforms.uAlpha.value = sa;
  }

  // Saima holds perfectly still, square to the screen, so she stays sharp
  saimaMesh.visible = saimaShadow.visible = shown;
  if (shown) {
    saima.x = x;
    saima.y = y;
    saima.H = H;
    saimaMesh.position.set(x, y, SAIMA_Z);
    saimaMesh.scale.set(H, H, 1);
    placeSaima(x, y, H);
    saimaMat.uniforms.uOpacity.value = op;
    saimaMat.uniforms.uSheen.value = saima.sheen;
    saimaShadow.position.set(saima.x + H * 0.025, y - H * 0.004, SAIMA_Z - 0.35);
    saimaShadow.scale.set(H * 1.01, H * 1.01, 1);
    saimaShadowMat.uniforms.uAlpha.value = op * 0.2;
  }

  // her name rides up with the page, a little slower than the copy, and fades as About arrives
  const nameOp = 1 - smoothstep(scroll.a, 0.2, 0.7);
  const lift = (scroll.y / (Math.max(1, view.h - panel.t) / 10)) * 0.85;
  const k = (CAM_DIST - hero.nameZ) / CAM_DIST; // further back, so drawn larger to look the same size
  for (const word of nameWords) {
    word.mesh.visible = word.ready && nameOp > 0.004 && nameAnim.t > 0;
    if (!word.mesh.visible) continue;
    word.mesh.position.set(word.cx * k, (word.cy + lift) * k, hero.nameZ);
    word.mesh.scale.set(word.pw * k, word.ph * k, 1);
    word.mat.uniforms.uT.value = nameAnim.t;
    word.mat.uniforms.uOpacity.value = nameOp;
  }
  updateNote(nameOp, lift, k);
}

// the hand-written note follows the end of her name
function updateNote(nameOp, lift, k) {
  if (!note.el) return;
  // it fades a little ahead of the name, so it is gone before it reaches the nav
  const op = note.on && note.fits ? nameOp * nameOp : 0;
  if (op > 0.004) {
    projected.set(hero.note.x * k, (hero.note.y + lift) * k, hero.nameZ).project(camera);
    const x = Math.round(((projected.x + 1) / 2) * view.w);
    const y = Math.round(((1 - projected.y) / 2) * view.h);
    if (x !== note.x || y !== note.y) {
      note.x = x;
      note.y = y;
      note.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }
  if (Math.abs(op - note.op) > 0.004) {
    note.op = op;
    note.el.style.opacity = op.toFixed(3);
  }
}

function updateCamera() {
  // a small parallax with the pointer: Saima holds still while the ring and her name shift round her
  const live = fx.inset;
  camera.position.set(pointer.sx * 0.55 * live, -pointer.sy * 0.3 * live, CAM_DIST);
  camLook.set(pointer.sx * 0.12 * live, -pointer.sy * 0.06 * live, 0);
  camera.lookAt(camLook);
  camera.aspect = frame.w / frame.h;
  camera.setViewOffset(frame.w, frame.h, -frame.x, -frame.y, view.w, view.h);
  camera.updateProjectionMatrix();
}

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

// a device that keeps missing frames steps its pixel density down until the motion runs smoothly;
// one-off hitches (an upload, a font arriving) don't count, only a steady run of late frames
function adaptQuality(dt) {
  if (!live || paused || document.hidden) {
    quality.n = quality.late = 0;
    return;
  }
  if (quality.wait > 0) {
    quality.wait -= dt;
    return;
  }
  quality.n++;
  if (dt > 1 / 45) quality.late++;
  if (quality.n < 90) return;
  const late = quality.late / quality.n;
  quality.n = quality.late = 0;
  if (late > 0.25 && targetDpr() * quality.scale > 1.01) {
    quality.scale = Math.max(0.6, quality.scale - 0.15);
    measure();
    quality.wait = 1;
  }
}

/* ------------------------------------------------------------------ */
/* Counter (odometer)                                                  */
/* ------------------------------------------------------------------ */

const counter = { value: 1, cols: [] };
(function buildCounter() {
  const spans = $$('.counter-digits .col');
  const sizes = [2, 11, 101]; // hundreds 0-1, tens 0-10, ones 0-100 (cumulative, always rolls forward)
  spans.forEach((col, i) => {
    const s = document.createElement('span');
    s.className = 'strip';
    let html = '';
    for (let k = 0; k < sizes[i]; k++) html += `<span>${k % 10}</span>`;
    s.innerHTML = html;
    col.appendChild(s);
    counter.cols.push({ strip: s, pos: 0 });
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
const SAIMA = { saima: true };
const pickTargets = [];
const pickHits = [];
let live = false;
let hovered = null;
let drag = null;
let paused = false;

// the design (or Saima) under a point on the screen
function pick(clientX, clientY) {
  // reels faded back behind the copy can't be picked through it
  if (scroll.dim * scroll.a * (1 - scroll.w) * (1 - scroll.f) > 0.5) return null;
  if (clientX < frame.x || clientX > frame.x + frame.w || clientY < frame.y || clientY > frame.y + frame.h) return null;
  ndc.set((clientX / view.w) * 2 - 1, -(clientY / view.h) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  pickTargets.length = 0;
  for (const c of cards) if (c.mesh.visible && c.mat.uniforms.uOpacity.value > 0.25) pickTargets.push(c.mesh);
  if (saimaMesh.visible && saimaMat.uniforms.uOpacity.value > 0.5) pickTargets.push(saimaMesh);
  pickHits.length = 0;
  for (const hit of raycaster.intersectObjects(pickTargets, false, pickHits)) {
    if (hit.object !== saimaMesh) return hit.object.userData.card;
    if (hit.uv && portraitAlpha(hit.uv.x, hit.uv.y) > 0.4) return SAIMA;
  }
  return null;
}

function spinBy(pixels) {
  // the wheel and the reel follow the scroll, so only the rings can be turned by hand
  if (scroll.w > 0.02 && scroll.f < 0.98) return;
  if (!hero.wide && scroll.a > 0.02 && scroll.f < 0.98) return;
  ringState.spin += (pixels / Math.max(320, frame.w * 0.55)) * 0.8;
}

canvas.addEventListener('pointermove', (e) => {
  pointer.px = e.clientX;
  pointer.py = e.clientY;
  pointer.x = (e.clientX / view.w) * 2 - 1;
  pointer.y = (e.clientY / view.h) * 2 - 1;
  pointer.inside = true;
  pointer.moved = true;
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
  ringState.user = 0;
  document.body.classList.add('is-dragging');
});
function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  document.body.classList.remove('is-dragging');
  if (d.moved < 6 && performance.now() - d.start < 500) {
    const target = pick(e.clientX, e.clientY);
    if (!target) return;
    if (target === SAIMA) scrollToY($('#about').offsetTop, 1.3);
    else if (scroll.w > 0.9 && scroll.f < 0.1 && target.order !== Math.round(scroll.act)) goToWork(target.order);
    else openLightbox(target.photo);
    return;
  }
  if (scroll.w < 0.02 || scroll.f > 0.98) ringState.user = clamp(d.vel, -4, 4) * 0.8;
}
canvas.addEventListener('pointerup', endDrag);
// the browser took the gesture over for scrolling: not a tap, not a throw
canvas.addEventListener('pointercancel', () => {
  drag = null;
  document.body.classList.remove('is-dragging');
});

let hoverFrame = 0;
function updateHover(dt) {
  // the scene moves under a still pointer too, so the pick is redone on a move and every few frames
  let target = null;
  if (live && !drag && pointer.inside && pointer.px >= 0) {
    target = hovered;
    if (pointer.moved || ++hoverFrame % 4 === 0) {
      pointer.moved = false;
      target = pick(pointer.px, pointer.py);
    }
  }
  if (target !== hovered) {
    hovered = target;
    document.body.classList.toggle('is-hover', !!hovered);
    if (hovered) setTag(hovered === SAIMA);
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
  lb.meta.textContent = [w.client, w.type].filter(Boolean).join(' · ');
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
  if (lenis) lenis.stop();
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
  if (live) {
    document.documentElement.classList.remove('is-locked');
    if (lenis) lenis.start();
  }
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
  scrollToY(0, 1.6);
};
$('.brand').addEventListener('click', toTop);
$('.to-top').addEventListener('click', toTop);
$('.nav-work').addEventListener('click', () => goToWork(0));

// the lede's words rise into place one after another; marked-up words stay whole
function splitWords(el) {
  let i = 0;
  const wrap = (node, free) => {
    const w = document.createElement('span');
    w.className = free ? 'w is-free' : 'w';
    const inner = document.createElement('span');
    inner.className = 'wi';
    inner.style.setProperty('--i', String(i++));
    w.appendChild(inner);
    node.parentNode.insertBefore(w, node);
    inner.appendChild(node);
  };
  [...el.childNodes].forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parts = node.textContent.split(/(\s+)/);
      const frag = document.createDocumentFragment();
      parts.forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
        const t = document.createTextNode(part);
        frag.appendChild(t);
      });
      const nodes = [...frag.childNodes];
      node.parentNode.replaceChild(frag, node);
      nodes.forEach((t) => { if (!/^\s+$/.test(t.textContent)) wrap(t, false); });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      wrap(node, true);
    }
  });
}
$$('.lede').forEach(splitWords);

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
    // one marker per design, where the page stands when that design is in focus
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
    const s = document.createElement('span');
    s.className = 'strip';
    const count = k === 0 ? Math.floor(PHOTOS / 10) + 1 : PHOTOS + 1;
    s.innerHTML = Array.from({ length: count }, (_, n) => `<span>${n % 10}</span>`).join('');
    col.appendChild(s);
    workUI.cols.push({ strip: s, pos: -1 });
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

/* ---------- a tag that follows the pointer: "View" over a design, a hello over Saima ---------- */

const tag = { el: $('.tag-view'), x: 0, y: 0, on: 0, idle: true };
function setTag(isSaima) {
  tag.el.classList.toggle('is-saima', isSaima);
  tag.el.textContent = isSaima ? 'hi, I’m Saima!' : 'View';
}
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

// the name and the counter start straight away, while the images are still arriving
function playLoader() {
  gsap.fromTo('.loader-name .ch', { y: 0, yPercent: 112 }, { yPercent: 0, duration: 0.8, stagger: 0.06, ease: 'power3.out', delay: 0.04 });
  gsap.to(counter, { value: 100, duration: 1.15, ease: 'sine.inOut' });
}

function showNote() {
  if (!note.el) return;
  note.on = true;
  note.el.classList.add('is-in');
}

function buildTimeline() {
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });

  // the designs fly out of the centre into a circle, top first
  for (const c of cards) tl.to(c, { p: 1, duration: 0.6, ease: 'power2.out' }, 0.02 + c.rank * 0.1);

  // hold until every image is decoded, then upload the big backdrop while the scene is still
  const gate = 1.5;
  tl.addPause(gate, () => onAllLoaded(() => {
    if (bg.tex) renderer.initTexture(bg.tex);
    requestAnimationFrame(() => tl.play());
  }));

  // the meadow blooms in and the loader steps aside
  tl.to(fx, { reveal: 1, duration: 0.6, ease: 'power2.inOut' }, gate + 0.05);
  tl.to(fx, { zoom: 1, duration: 1.8, ease: 'power2.out' }, gate + 0.05);
  tl.to('.counter', { opacity: 0, filter: 'blur(6px)', y: -8, duration: 0.6, ease: 'power2.inOut' }, gate + 0.1);
  tl.to('.loader-dot', { opacity: 0, duration: 0.3, ease: 'power1.out' }, gate + 0.25);

  // the circle tips back into an orbit and starts to turn
  tl.to(ringState, { orbit: 1, duration: 1.5, ease: 'none' }, gate + 0.15);
  tl.to(ringState, { speed: 0.14, duration: 1.4, ease: 'sine.inOut' }, gate + 0.6);

  // Saima rises into the middle of it, a band of light passing over her
  tl.to(saima, { rise: 1, duration: 1.5, ease: 'expo.out' }, gate + 0.35);
  tl.fromTo(saima, { sheen: -0.6 }, { sheen: 1.8, duration: 1.7, ease: 'power2.inOut', immediateRender: false }, gate + 0.55);

  // her name rises behind her, letter by letter
  tl.to(nameAnim, { t: 2, duration: 2, ease: 'none' }, gate + 0.55);

  // the loader's name shrinks into the nav, and the scene is framed below it
  tl.to('.loader-name', { ...nameFlip(), duration: 1.0, ease: 'power3.inOut' }, gate + 0.45);
  tl.set('.brand-word', { visibility: 'visible' }, gate + 1.45);
  tl.set('.loader-name', { visibility: 'hidden' }, gate + 1.45);
  tl.fromTo('.brand-dot', { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.5 }, gate + 1.45);
  tl.fromTo('.nav-work', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.6 }, gate + 1.5);
  tl.to(fx, { inset: 1, duration: 0.8, ease: 'power3.inOut', onUpdate: applyInset }, gate + 1.1);

  // the page can be scrolled as soon as she has arrived; the last touches finish on the way
  tl.call(goLive, null, gate + 1.2);

  // the hand-written note under her name
  tl.call(showNote, null, gate + 1.55);
  tl.call(() => { intro.done = true; }, null, gate + 1.9);
  return tl;
}

function goLive() {
  if (live) return;
  live = true;
  document.body.classList.add('is-live');
  document.documentElement.classList.remove('is-locked');
  if (lenis) lenis.start();
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
  // callbacks are suppressed while seeking, so settle the counters and the note by hand
  counter.cols.forEach((c) => { c.pos = -1; });
  updateCounter(10);
  if (t >= tl.duration() - 0.5) {
    showNote();
    goLive();
    intro.done = true;
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
  if (lenis) lenis.raf(now);
  if (paused) return;
  clock += dt;

  updateScroll(dt);
  updateHover(dt);
  updateScene(dt);
  updateCamera();
  updatePetals(dt);
  updateCounter(dt);
  updateWorkUI(dt);
  updateHiRes(now);
  updateMarquee(dt);
  updateTag(dt);
  adaptQuality(dt);

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
  resize(true);
  loadTextures();

  // wait for the type so neither name swaps fonts mid-animation (capped so slow fonts never block)
  const fonts = document.fonts
    ? Promise.all([
      document.fonts.load('400 100px "Instrument Serif"'),
      document.fonts.load('italic 400 100px "Instrument Serif"'),
      document.fonts.load('400 100px "Geist Mono"'),
    ]).catch(() => {})
    : Promise.resolve();
  await Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]);
  fontsReady = true;
  resize(true);
  layoutName();
  // a font that arrived after the cap, and the handwriting, redraw what uses them
  if (document.fonts) {
    Promise.all([fonts, document.fonts.load('600 40px Caveat')]).catch(() => {}).then(() => {
      layoutName();
      drawDoodles();
      buildMarquee();
      measureScroll();
    });
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
      ringState.speed *= 0.3;
    });
    return;
  }
  playLoader();
  // the designs fly out once their images are decoded, so none arrives blank (capped for slow networks)
  const cardsReady = new Promise((resolve) => onCardsLoaded(resolve));
  const atLeast = new Promise((resolve) => setTimeout(resolve, 250));
  const cap = new Promise((resolve) => setTimeout(resolve, 8000));
  Promise.race([Promise.all([cardsReady, atLeast]), cap]).then(() => tl.play());
}

boot();
