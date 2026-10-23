import * as THREE from '../vendor/three.module.min.js';

// Painted sunset sky: gradient + cirrus streaks + three layers of cumulus.
// Each cumulus layer is a soft union of puffs with warped, fbm-roughened outlines,
// shaded from the field normal plus a noise light-gradient for the small bumps.
// Rendered once per size into a texture, so it costs a single texture fetch per frame.

const TEX_W = 1024;
const PUFF_ROWS = 6; // capacity: TEX_W * PUFF_ROWS puff entries (bins duplicate wide puffs)
const MAX_PUFFS = TEX_W * PUFF_ROWS;
const BINS = 24;
const UNION_K = '11.0'; // GLSL float literal

const vertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  precision highp float;
  uniform vec2 uRes;
  uniform float uUnit;
  // rows 0..${PUFF_ROWS - 1}: puffs (x, y, r, bias) sorted by layer then x-bin;
  // rows ${PUFF_ROWS}..${PUFF_ROWS + 2}: [start, end) of each bin, one row per layer
  uniform highp sampler2D uPuffTex;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
    return v;
  }

  vec3 skyGradient(float v, float u) {
    vec3 c0 = vec3(0.99, 0.80, 0.66);
    vec3 c1 = vec3(0.95, 0.75, 0.76);
    vec3 c2 = vec3(0.80, 0.73, 0.88);
    vec3 c3 = vec3(0.54, 0.69, 0.93);
    vec3 c4 = vec3(0.33, 0.55, 0.88);
    vec3 c = mix(c0, c1, smoothstep(0.0, 0.2, v));
    c = mix(c, c2, smoothstep(0.15, 0.42, v));
    c = mix(c, c3, smoothstep(0.38, 0.7, v));
    c = mix(c, c4, smoothstep(0.66, 1.0, v));
    float g = exp(-length(vec2((u - 0.82) * 1.3, v + 0.02)) * 2.8);
    c = mix(c, vec3(1.0, 0.87, 0.64), g * 0.5);
    return c;
  }

  // soft union of paraboloid puffs; returns density and a heightfield normal
  float field(vec2 p, int layer, int bin, out vec3 n) {
    vec2 range = texelFetch(uPuffTex, ivec2(bin, ${PUFF_ROWS} + layer), 0).xy;
    int i0 = int(range.x), i1 = int(range.y);
    float sw = 0.0;
    vec2 g = vec2(0.0);
    for (int i = i0; i < i1; i++) {
      vec4 c = texelFetch(uPuffTex, ivec2(i % ${TEX_W}, i / ${TEX_W}), 0);
      vec2 d = (p - c.xy) / c.z;
      float f = 1.0 - dot(d, d) + c.w;
      if (f < -1.5) continue;
      float w = exp(${UNION_K} * (f - 1.0));
      sw += w;
      g += w * d;
    }
    if (sw <= 0.0) { n = vec3(0.0, 0.0, 1.0); return -8.0; }
    float D = log(sw) / ${UNION_K} + 1.0;
    g /= sw;
    n = normalize(vec3(g, sqrt(clamp(D, 0.0, 1.0)) + 0.22));
    return D;
  }

  vec4 cloudLayer(vec2 p, vec2 q, float v, float u, int layer, int bin, float warm, float haze, float detail) {
    // billowy outlines: warp the lookup before sampling the puffs
    float seed = float(layer) * 7.3;
    vec2 wq = q * 2.2 + seed;
    vec2 warp = vec2(fbm(wq), fbm(wq + 5.2)) - 0.5;
    vec2 wq2 = q * 11.0 + seed;
    vec2 warp2 = vec2(noise(wq2), noise(wq2 + 3.1)) - 0.5;
    vec3 n;
    float D = field(p + (warp * 0.1 + warp2 * 0.02) * uUnit * detail, layer, bin, n);
    if (D < -0.8) return vec4(0.0);
    float nz = fbm(q * 10.0 + seed);
    D += (nz - 0.5) * 0.3 * detail;
    float a = smoothstep(0.0, 0.05, D);
    if (a <= 0.0) return vec4(0.0);

    vec3 L = normalize(vec3(0.38, 0.88, 0.32));
    float lit = dot(n, L);
    float nzL = fbm(q * 10.0 + seed + L.xy * 0.05);
    lit += (nz - nzL) * 1.6 * detail;
    lit = clamp(lit * 0.7 + 0.36, 0.0, 1.0);

    vec3 lightC = mix(vec3(1.0, 0.98, 0.93), vec3(1.0, 0.9, 0.66), warm);
    vec3 midC   = mix(vec3(0.97, 0.83, 0.82), vec3(0.99, 0.72, 0.52), warm);
    vec3 shadeC = mix(vec3(0.73, 0.67, 0.86), vec3(0.88, 0.6, 0.62), warm);
    vec3 col = mix(shadeC, midC, smoothstep(0.22, 0.46, lit));
    col = mix(col, lightC, smoothstep(0.5, 0.74, lit));
    // silver lining on thin, sunward edges
    float thin = 1.0 - smoothstep(0.0, 0.2, D);
    col = mix(col, lightC, thin * smoothstep(0.3, 0.75, lit) * 0.6);
    // thin edges let some sky through
    col = mix(col, skyGradient(v, u), thin * (1.0 - lit) * 0.25);
    col *= 0.98 + 0.04 * noise(p * 0.11);
    col = mix(col, skyGradient(v, u), haze);
    return vec4(col, a);
  }

  void main() {
    vec2 p = vUv * uRes;
    float v = vUv.y;
    float u = vUv.x;
    vec2 q = p / uUnit;
    vec3 col = skyGradient(v, u);

    // cirrus streaks
    float s1 = fbm(vec2(q.x * 1.2 - q.y * 2.4, q.y * 8.0) + 3.1);
    float s2 = fbm(vec2(q.x * 2.2 + q.y * 1.3, q.y * 15.0) + 11.7);
    float upper = smoothstep(0.42, 0.92, v);
    col = mix(col, vec3(0.99, 0.79, 0.80), smoothstep(0.55, 0.8, s1) * upper * 0.62);
    col = mix(col, vec3(1.0, 0.93, 0.9), smoothstep(0.66, 0.86, s2) * upper * 0.42);

    int bin = clamp(int(u * ${BINS}.0), 0, ${BINS - 1});
    vec4 c;
    c = cloudLayer(p, q, v, u, 0, bin, 0.3, 0.42, 0.7);
    col = mix(col, c.rgb, c.a);
    c = cloudLayer(p, q, v, u, 1, bin, 0.25, 0.04, 1.0);
    col = mix(col, c.rgb, c.a);
    c = cloudLayer(p, q, v, u, 2, bin, 0.85, 0.0, 1.0);
    col = mix(col, c.rgb, c.a);

    gl_FragColor = vec4(col, 1.0);
  }
`;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Cumulus layout in pixels (y up), adapted to the aspect ratio. Returns three layers.
function layoutPuffs(w, h) {
  const rnd = mulberry32(11);
  const unit = Math.min(w, h);
  const land = THREE.MathUtils.smoothstep(w / h, 0.8, 1.6);
  const L = THREE.MathUtils.lerp;
  const far = [], mid = [], near = [];

  // cumulus: tiers of big lobes, smaller higher up, plus a crest of small lobes on the silhouette;
  // lower lobes get a bias so they sit in front
  const dome = (out, cx, by, cw, ch, rBase, tiers, crest) => {
    const rx = cw / 2;
    for (let t = 0; t < tiers; t++) {
      const f = t / tiers;
      const y = by + f * ch * 0.82;
      const half = rx * Math.sqrt(Math.max(0, 1 - f * f)) * 0.84;
      const r = rBase * (1 - 0.45 * f);
      const n = Math.max(1, Math.round((2 * half) / (r * 1.15)) + (rnd() < 0.5 ? 1 : 0));
      for (let k = 0; k < n; k++) {
        const x = n === 1 ? 0 : -half + (2 * half * k) / (n - 1);
        out.push([cx + x + (rnd() - 0.5) * r * 0.9, y + (rnd() - 0.5) * r * 0.7, r * (0.6 + 0.75 * rnd()), 0.16 * (1 - f)]);
      }
    }
    for (let k = 0; k < crest; k++) {
      const a = Math.PI * (0.12 + 0.76 * rnd());
      const r = rBase * (0.42 + 0.3 * rnd());
      out.push([cx + Math.cos(a) * rx * 0.72, by + Math.sin(a) * ch * 0.7, r, 0.0]);
    }
  };

  const farCount = Math.round(L(2, 4, land));
  for (let i = 0; i < farCount; i++) {
    const cx = w * (0.12 + 0.76 * (i + rnd() * 0.7) / farCount);
    dome(far, cx, h * (0.27 + rnd() * 0.12), unit * (0.16 + rnd() * 0.12), unit * 0.08, unit * 0.036, 2, 3);
  }
  dome(mid, w * L(0.02, 0.05, land), h * 0.02, w * L(0.62, 0.36, land), h * L(0.22, 0.36, land), unit * 0.11, 3, 4);
  dome(mid, w * L(0.86, 0.87, land), -h * 0.04, w * L(0.98, 0.5, land), h * L(0.4, 0.8, land), unit * L(0.15, 0.16, land), 6, 6);
  const bands = Math.max(3, Math.round((w / unit) * 2.0));
  for (let i = 0; i <= bands; i++) {
    const cx = w * (i + (rnd() - 0.5) * 0.6) / bands;
    dome(near, cx, -h * (0.06 + rnd() * 0.05), (w / bands) * (1.3 + rnd() * 0.6), h * (0.16 + rnd() * 0.18), unit * (0.075 + rnd() * 0.035), 2, 3);
  }
  return [far, mid, near];
}

// Sort puffs into vertical bins so each pixel only visits the puffs that can reach it.
function packPuffs(layers, w, unit) {
  const data = new Float32Array(TEX_W * (PUFF_ROWS + 3) * 4);
  const margin = unit * 0.06;
  let count = 0;
  layers.forEach((puffs, li) => {
    for (let b = 0; b < BINS; b++) {
      const x0 = (b / BINS) * w - margin, x1 = ((b + 1) / BINS) * w + margin;
      const start = count;
      for (const p of puffs) {
        const reach = p[2] * Math.sqrt(2.5 + p[3]);
        if (p[0] + reach < x0 || p[0] - reach > x1 || count >= MAX_PUFFS) continue;
        data.set(p, count * 4);
        count++;
      }
      const row = ((PUFF_ROWS + li) * TEX_W + b) * 4;
      data[row] = start;
      data[row + 1] = count;
    }
  });
  return data;
}

export function createSky(renderer) {
  const target = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
  target.texture.generateMipmaps = false;
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;

  const puffTex = new THREE.DataTexture(new Float32Array(TEX_W * (PUFF_ROWS + 3) * 4), TEX_W, PUFF_ROWS + 3, THREE.RGBAFormat, THREE.FloatType);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) },
      uUnit: { value: 1 },
      uPuffTex: { value: puffTex },
    },
    depthTest: false,
    depthWrite: false,
  });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  let lastKey = '';
  function render(cssW, cssH, dpr, force) {
    if (force) lastKey = '';
    // the sky is soft; cap its resolution to keep regeneration cheap on big screens
    const scale = Math.min(dpr, 1.5, 2400 / cssW, 2400 / cssH);
    const w = Math.max(2, Math.round(cssW * scale));
    const h = Math.max(2, Math.round(cssH * scale));
    const key = `${w}x${h}`;
    if (key === lastKey) return;
    lastKey = key;
    target.setSize(w, h);
    puffTex.image.data.set(packPuffs(layoutPuffs(w, h), w, Math.min(w, h)));
    puffTex.needsUpdate = true;
    material.uniforms.uRes.value.set(w, h);
    material.uniforms.uUnit.value = Math.min(w, h);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prev);
  }

  return { texture: target.texture, render };
}
