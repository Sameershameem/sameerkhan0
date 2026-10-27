import * as THREE from 'three';
import { chromeMatcap } from './matcap.js';

// Colours are used as given (sRGB), to match the page's CSS.
THREE.ColorManagement.enabled = false;

const TAU = Math.PI * 2;

// The portrait cut-out, sampled into one particle per pixel of a small grid: its place in the picture
// (0..1, origin bottom left) and its colour.
export async function samplePortrait(url, cols) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const rows = Math.round((cols * img.naturalHeight) / img.naturalWidth);
  const cv = document.createElement('canvas');
  cv.width = cols;
  cv.height = rows;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, cols, rows);
  const px = g.getImageData(0, 0, cols, rows).data;
  const pts = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const k = (y * cols + x) * 4;
      if (px[k + 3] < 160) continue;
      pts.push([(x + 0.5) / cols, 1 - (y + 0.5) / rows, px[k] / 255, px[k + 1] / 255, px[k + 2] / 255]);
    }
  }
  return { pts, cols, rows };
}

const particleVertex = /* glsl */`
  uniform vec4 uRect;   // the photo's box: left, bottom, width, height (css px, origin bottom left)
  uniform vec2 uView;   // canvas size, css px
  uniform float uP;     // 0 = a swirl of starlight, 1 = gathered into the portrait
  uniform float uTime;
  uniform float uSize;  // dot size once gathered, css px
  uniform float uDpr;
  uniform float uFade;
  attribute vec2 aUv;
  attribute vec3 aColor;
  attribute vec2 aFrom;
  attribute vec3 aFromColor;
  attribute vec4 aSeed; // x: order of arrival (centre first), y z w: random
  varying vec3 vColor;
  varying float vAlpha;
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
  void main() {
    vec2 centre = uView * 0.5;
    float maxR = length(uView) * 0.5;
    float delay = aSeed.x * 0.4 + aSeed.y * 0.1;
    float t = clamp((uP - delay) / 0.5, 0.0, 1.0);
    float e = t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
    // the swirl turns slowly; leaving it, each particle spirals in to its place
    vec2 rel = rot(uTime * 0.04) * aFrom * maxR;
    rel = rot(e * (1.4 + aSeed.w * 1.2)) * rel;
    vec2 target = uRect.xy + aUv * uRect.zw;
    vec2 pos = mix(centre + rel, target, e);
    pos += (1.0 - e) * vec2(sin(uTime * 0.7 + aSeed.y * 40.0), cos(uTime * 0.6 + aSeed.z * 40.0)) * 3.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
    gl_PointSize = mix(1.0 + aSeed.w * 2.4, uSize, e) * uDpr;
    vColor = mix(aFromColor, aColor, smoothstep(0.35, 0.95, t));
    vAlpha = mix(0.45 + 0.5 * aSeed.z, 1.0, e) * uFade;
  }
`;
const dotFragment = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.3, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

// stars that keep drifting and twinkling through the hero once the portrait has formed
const dustVertex = /* glsl */`
  uniform vec2 uView;
  uniform float uTime;
  uniform float uDpr;
  uniform float uAlpha;
  uniform vec2 uPointer;
  attribute vec4 aSeed;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = aSeed.xy;
    p.y = fract(p.y + uTime * (0.006 + aSeed.z * 0.012));
    p.x = fract(p.x + sin(uTime * 0.25 + aSeed.w * 30.0) * 0.01 + uPointer.x * 0.01 * aSeed.z);
    vec2 pos = p * uView;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
    gl_PointSize = (1.0 + aSeed.z * 2.6) * uDpr;
    vColor = aColor;
    float tw = 0.5 + 0.5 * sin(uTime * (0.8 + aSeed.w * 1.6) + aSeed.x * 50.0);
    vAlpha = uAlpha * (0.25 + 0.6 * tw) * smoothstep(0.0, 0.08, p.y) * (1.0 - smoothstep(0.88, 1.0, p.y));
  }
`;

// Liquid chrome: a tube swept along a path in the vertex shader, swelling as drops travel along it.
// Positions and normals come from the path, so the shape can flow without new geometry.
const chromeVertex = /* glsl */`
  uniform float uTime;
  uniform float uGrow;   // 0..1: how much of it has poured in
  uniform vec3 uCenter;
  uniform vec3 uRad;     // loop: radius x, height wave, radius z
  uniform float uTube;
  uniform mat3 uRot;
  uniform vec3 uP0;      // ribbon: a cubic curve through these (ribbons only)
  uniform vec3 uP1;
  uniform vec3 uP2;
  uniform vec3 uP3;
  varying vec3 vN;
  varying vec3 vView;
  varying float vZ;
  vec3 path(float u) {
    #ifdef RIBBON
      float s = 1.0 - u;
      vec3 p = s * s * s * uP0 + 3.0 * s * s * u * uP1 + 3.0 * s * u * u * uP2 + u * u * u * uP3;
      p.y += sin(u * 6.0 + uTime * 0.6) * uTube * 0.6;
      return p;
    #else
      float a = u * 6.2831853 + uTime * 0.1;
      float wob = 1.0 + 0.06 * sin(a * 3.0 - uTime * 0.55);
      return vec3(cos(a) * uRad.x * wob, sin(a * 2.0 + uTime * 0.35) * uRad.y, sin(a) * uRad.z * wob);
    #endif
  }
  float radius(float u) {
    float a = u * 6.2831853;
    #ifdef RIBBON
      float r = uTube * pow(sin(3.14159 * u), 0.7) * (0.8 + 0.25 * sin(a * 2.0 - uTime * 0.7));
    #else
      float s = 0.62 + 0.5 * sin(a - uTime * 0.42) + 0.22 * sin(a * 3.0 + uTime * 0.7) + 0.1 * sin(a * 7.0 - uTime);
      float r = uTube * max(0.3, s);
    #endif
    return r * (1.0 - smoothstep(uGrow * 1.12 - 0.12, uGrow * 1.12, u));
  }
  vec3 surf(float u, float v) {
    vec3 c = path(u);
    vec3 T = normalize(path(u + 0.002) - c);
    vec3 B = normalize(cross(T, vec3(0.0, 1.0, 0.0)));
    vec3 N = cross(B, T);
    float ang = v * 6.2831853;
    return c + radius(u) * (cos(ang) * N + sin(ang) * B);
  }
  void main() {
    float u = uv.x, v = uv.y;
    vec3 p = surf(u, v);
    vec3 n = normalize(cross(surf(u, v + 0.01) - p, surf(u + 0.0015, v) - p));
    p = uRot * p + uCenter;
    n = uRot * n;
    vZ = p.z;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    vView = mv.xyz;
    vN = normalize(mat3(viewMatrix) * n);
    gl_Position = projectionMatrix * mv;
  }
`;
const chromeFragment = /* glsl */`
  uniform sampler2D uMatcap;
  uniform float uFront; // the front canvas keeps only the half of the loop in front of the portrait
  varying vec3 vN;
  varying vec3 vView;
  varying float vZ;
  void main() {
    if (uFront > 0.5 && vZ < 0.0) discard;
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(-vView);
    vec3 x = normalize(vec3(v.z, 0.0, -v.x));
    vec3 y = cross(v, x);
    vec2 uv = vec2(dot(x, n), dot(y, n)) * 0.495 + 0.5;
    vec3 col = texture2D(uMatcap, uv).rgb;
    float f = pow(1.0 - abs(dot(n, v)), 3.0);
    col = mix(col, vec3(0.78, 0.86, 1.0), f * 0.35);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function chromeMaterial(matcap, { ribbon = false, front = false } = {}, shared = null) {
  // the loop's two halves share one set of uniforms, so they move as one
  const uniforms = shared || {
    uTime: { value: 0 },
    uGrow: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uRad: { value: new THREE.Vector3(1, 0.1, 1) },
    uTube: { value: 0.1 },
    uRot: { value: new THREE.Matrix3() },
    uP0: { value: new THREE.Vector3() },
    uP1: { value: new THREE.Vector3() },
    uP2: { value: new THREE.Vector3() },
    uP3: { value: new THREE.Vector3() },
    uMatcap: { value: matcap },
  };
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uFront: { value: front ? 1 : 0 } },
    vertexShader: chromeVertex,
    fragmentShader: chromeFragment,
    defines: ribbon ? { RIBBON: '' } : {},
    side: THREE.DoubleSide,
  });
}

export function createHeroScene({ back, front, mobile = false }) {
  const mk = (canvas) => {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.setClearColor(0x000000, 0);
    return r;
  };
  const rb = mk(back);
  const rf = mk(front);
  const sceneBack = new THREE.Scene();
  const sceneDots = new THREE.Scene();
  const sceneFront = new THREE.Scene();
  // world units are css px at z = 0, origin at the canvas centre, so the DOM and the scene line up
  const persp = new THREE.PerspectiveCamera(30, 1, 1, 50000);
  const ortho = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);

  const view = { w: 1, h: 1, dpr: 1 };
  const rect = new THREE.Vector4(0, 0, 1, 1);
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const intro = { p: 0, fade: 1, grow: 0, dust: 0 };

  // ---- the chrome loop round the waist, its front half redrawn in front of the portrait, and two ribbons
  // (a texture or geometry can serve both canvases; each renderer uploads its own copy)
  const matcap = chromeMatcap();
  const loopGeo = new THREE.PlaneGeometry(1, 1, mobile ? 160 : 240, mobile ? 28 : 40);
  const loopBack = chromeMaterial(matcap);
  const loopU = loopBack.uniforms;
  const loopFront = chromeMaterial(matcap, { front: true }, loopU);
  const loopMeshB = new THREE.Mesh(loopGeo, loopBack);
  const loopMeshF = new THREE.Mesh(loopGeo, loopFront);
  for (const m of [loopMeshB, loopMeshF]) m.frustumCulled = false;
  sceneBack.add(loopMeshB);
  sceneFront.add(loopMeshF);

  const ribbons = [0, 1].map(() => {
    const mat = chromeMaterial(matcap, { ribbon: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, mobile ? 90 : 140, mobile ? 20 : 28), mat);
    mesh.frustumCulled = false;
    sceneBack.add(mesh);
    return mat;
  });

  // ---- particles that gather into the portrait
  let points = null;
  let pointsMat = null;
  function setPortrait(sample) {
    const n = sample.pts.length;
    const aUv = new Float32Array(n * 2);
    const aColor = new Float32Array(n * 3);
    const aFrom = new Float32Array(n * 2);
    const aFromColor = new Float32Array(n * 3);
    const aSeed = new Float32Array(n * 4);
    // a spiral galaxy of starlight: arms radiating from a bright core, each star a little bluer or
    // paler than its neighbours, a few of them white-hot
    const FIBRES = 150;
    const tone = Array.from({ length: FIBRES }, () => Math.random());
    const light = new THREE.Color('#a9c0ff');
    const deep = new THREE.Color('#2f4fc8');
    const glint = [new THREE.Color('#ffffff'), new THREE.Color('#dfe8ff')];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const [u, v, r, g, b] = sample.pts[i];
      aUv[i * 2] = u;
      aUv[i * 2 + 1] = v;
      aColor.set([r, g, b], i * 3);
      const fibre = Math.floor(Math.random() * FIBRES);
      const rad = 0.01 + 1.1 * Math.pow(Math.random(), 1.15);
      const ang = ((fibre + (Math.random() - 0.5) * 0.18) / FIBRES) * TAU + rad * 2.2;
      aFrom[i * 2] = Math.cos(ang) * rad;
      aFrom[i * 2 + 1] = Math.sin(ang) * rad;
      if (Math.random() < 0.06) c.copy(glint[i % 2]);
      else c.copy(deep).lerp(light, Math.min(1, tone[fibre] * 0.8 + Math.random() * 0.35));
      // the core burns white
      c.lerp(glint[0], Math.max(0, 1 - rad / 0.2) * 0.85);
      aFromColor.set([c.r, c.g, c.b], i * 3);
      // the middle of the portrait arrives first
      const du = (u - 0.5) * 1.6, dv = v - 0.6;
      aSeed.set([Math.min(1, Math.sqrt(du * du + dv * dv) / 0.75), Math.random(), Math.random(), Math.random()], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aUv', new THREE.BufferAttribute(aUv, 2));
    geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
    geo.setAttribute('aFrom', new THREE.BufferAttribute(aFrom, 2));
    geo.setAttribute('aFromColor', new THREE.BufferAttribute(aFromColor, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 4));
    pointsMat = new THREE.ShaderMaterial({
      uniforms: {
        uRect: { value: rect },
        uView: { value: new THREE.Vector2(1, 1) },
        uP: { value: 0 },
        uTime: { value: 0 },
        uSize: { value: 3 },
        uDpr: { value: 1 },
        uFade: { value: 1 },
      },
      vertexShader: particleVertex,
      fragmentShader: dotFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    points = new THREE.Points(geo, pointsMat);
    points.frustumCulled = false;
    points.userData.rows = sample.rows;
    sceneDots.add(points);
    layout();
  }

  // ---- dust
  const DUST = mobile ? 90 : 170;
  const dustSeed = new Float32Array(DUST * 4);
  const dustColor = new Float32Array(DUST * 3);
  const dustPalette = ['#edf1fb', '#b8cbff', '#ffffff', '#7fa2ff'].map((c) => new THREE.Color(c));
  for (let i = 0; i < DUST; i++) {
    dustSeed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    const c = dustPalette[i % dustPalette.length];
    dustColor.set([c.r, c.g, c.b], i * 3);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST * 3), 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 4));
  dustGeo.setAttribute('aColor', new THREE.BufferAttribute(dustColor, 3));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: {
      uView: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uDpr: { value: 1 },
      uAlpha: { value: 0 },
      uPointer: { value: new THREE.Vector2() },
    },
    vertexShader: dustVertex,
    fragmentShader: dotFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  sceneDots.add(dust);

  // ---- layout: everything is placed from the photo's box on the page
  function layout() {
    const { w, h, dpr } = view;
    for (const r of [rb, rf]) {
      r.setPixelRatio(dpr);
      r.setSize(w, h, false);
    }
    persp.aspect = w / h;
    persp.fov = 30;
    persp.position.set(0, 0, h / 2 / Math.tan(THREE.MathUtils.degToRad(15)));
    persp.near = 10;
    persp.far = persp.position.z * 3;
    persp.lookAt(0, 0, 0);
    persp.updateProjectionMatrix();
    ortho.right = w;
    ortho.top = h;
    ortho.updateProjectionMatrix();
    if (pointsMat) {
      pointsMat.uniforms.uView.value.set(w, h);
      pointsMat.uniforms.uDpr.value = dpr;
      pointsMat.uniforms.uSize.value = Math.max(1.6, (rect.w / points.userData.rows) * 1.45);
    }
    dustMat.uniforms.uView.value.set(w, h);
    dustMat.uniforms.uDpr.value = dpr;
    // the loop sits round the waist, a little wider than the figure, tipped towards us
    const fw = rect.z, fh = rect.w;
    const cx = rect.x + fw / 2 - w / 2;
    const cy = rect.y + fh * 0.43 - h / 2;
    loopU.uCenter.value.set(cx, cy, 0);
    loopU.uRad.value.set(fw * 0.78, fh * 0.045, fw * 0.5);
    loopU.uTube.value = fh * 0.052;
    // two ribbons curl in from the edges, clear of the type: one at the top right, one at the
    // bottom left, as in the reference
    const r0 = ribbons[0].uniforms;
    const r1 = ribbons[1].uniforms;
    if (w >= h) {
      r0.uP0.value.set(w * 0.6, h * 0.41, -120);
      r0.uP1.value.set(w * 0.33, h * 0.4, -80);
      r0.uP2.value.set(w * 0.31, h * 0.2, -60);
      r0.uP3.value.set(w * 0.6, h * 0.16, -60);
      r1.uP0.value.set(-w * 0.6, -h * 0.28, -100);
      r1.uP1.value.set(-w * 0.38, -h * 0.3, -70);
      r1.uP2.value.set(-w * 0.35, -h * 0.5, -60);
      r1.uP3.value.set(-w * 0.44, -h * 0.62, -60);
    } else {
      r0.uP0.value.set(w * 0.7, h * 0.12, -120);
      r0.uP1.value.set(w * 0.3, h * 0.1, -80);
      r0.uP2.value.set(w * 0.28, -h * 0.04, -60);
      r0.uP3.value.set(w * 0.7, -h * 0.08, -60);
      r1.uP0.value.set(-w * 0.7, -h * 0.3, -100);
      r1.uP1.value.set(-w * 0.32, -h * 0.32, -70);
      r1.uP2.value.set(-w * 0.3, -h * 0.5, -60);
      r1.uP3.value.set(-w * 0.4, -h * 0.62, -60);
    }
    r0.uTube.value = Math.min(w, h) * (mobile ? 0.036 : 0.034);
    r1.uTube.value = Math.min(w, h) * (mobile ? 0.03 : 0.028);
  }

  const euler = new THREE.Euler();
  const m4 = new THREE.Matrix4();
  let time = 0;
  let active = true;
  function render(dt) {
    time += dt;
    pointer.sx += (pointer.x - pointer.sx) * (1 - Math.exp(-dt * 3));
    pointer.sy += (pointer.y - pointer.sy) * (1 - Math.exp(-dt * 3));
    // the loop tips forward and turns a little with the pointer
    euler.set(0.36 + pointer.sy * 0.08, pointer.sx * 0.12, -0.12 + pointer.sx * 0.05);
    m4.makeRotationFromEuler(euler);
    loopU.uRot.value.setFromMatrix4(m4);
    loopU.uTime.value = time;
    loopU.uGrow.value = intro.grow;
    for (const r of ribbons) {
      r.uniforms.uTime.value = time;
      r.uniforms.uGrow.value = intro.grow;
      r.uniforms.uRot.value.identity();
    }
    if (pointsMat) {
      pointsMat.uniforms.uTime.value = time;
      pointsMat.uniforms.uP.value = intro.p;
      pointsMat.uniforms.uFade.value = intro.fade;
      points.visible = intro.fade > 0.003;
    }
    dustMat.uniforms.uTime.value = time;
    dustMat.uniforms.uAlpha.value = intro.dust;
    dustMat.uniforms.uPointer.value.set(pointer.sx, pointer.sy);
    rb.autoClear = false;
    rb.clear();
    rb.render(sceneBack, persp);
    rb.render(sceneDots, ortho);
    rf.render(sceneFront, persp);
  }

  return {
    intro,
    setPortrait,
    setView(w, h, dpr) {
      view.w = Math.max(1, w);
      view.h = Math.max(1, h);
      view.dpr = dpr;
      layout();
    },
    // the photo's box in the canvas, css px from the bottom left
    setRect(x, y, w, h) {
      rect.set(x, y, w, h);
      layout();
    },
    setPointer(x, y) {
      pointer.x = x;
      pointer.y = y;
    },
    setActive(on) { active = on; },
    get active() { return active; },
    render,
    async prepare() {
      for (const [r, s, c] of [[rb, sceneBack, persp], [rb, sceneDots, ortho], [rf, sceneFront, persp]]) {
        try { r.compile(s, c); } catch { /* compiles on first draw */ }
      }
    },
    dispose() {
      for (const s of [sceneBack, sceneDots, sceneFront]) {
        s.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
      }
      matcap.dispose();
      rb.dispose();
      rf.dispose();
    },
  };
}
