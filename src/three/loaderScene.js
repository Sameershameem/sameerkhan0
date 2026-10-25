import * as THREE from 'three';
import gsap from 'gsap';
import { createBear, poseWalk, HIP_Y } from './bear.js';

// Colours are used as given (sRGB), so the eye's mocha matches the page's CSS exactly.
THREE.ColorManagement.enabled = false;

const TAU = Math.PI * 2;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = THREE.MathUtils.lerp;

const STEP_TIME = 0.28; // seconds per step at full stride
const SWING = 0.5; // leg swing at full stride, in radians
const STRIDE = 2 * HIP_Y * Math.sin(SWING); // how far one step carries the bear
const EYE_R = 0.072;
// where the camera ends up: just off the lower part of the left eye, beside the glow of light
// through it, where the bead is closest to the page's mocha
const EYE_SPOT = new THREE.Vector3(-0.18, -0.48, 0.86).normalize();
const END_DIST = 0.06;
const FRAME_BUDGET = 11; // ms of GPU time a frame may take

// Quality, best first. The first tier the GPU draws within budget is used: the pixel ratio (above the
// screen's own on 1x screens, for smoother fur), the share of fur shells, and the lens blur.
const TIERS = {
  desktop: [
    { dpr: 2, shells: 1, lens: true },
    { dpr: 2, shells: 0.8, lens: false },
    { dpr: 1.5, shells: 0.7, lens: false },
    { dpr: 1.2, shells: 0.55, lens: false },
    { dpr: 1, shells: 0.45, lens: false },
    { dpr: 0.8, shells: 0.35, lens: false },
  ],
  mobile: [
    { dpr: 2, shells: 1, lens: false },
    { dpr: 1.6, shells: 0.75, lens: false },
    { dpr: 1.3, shells: 0.6, lens: false },
    { dpr: 1, shells: 0.5, lens: false },
    { dpr: 0.8, shells: 0.4, lens: false },
  ],
};

// A damped spring: what it drives follows its target with a little lag and overshoot, the way a
// soft toy's heavy head and floppy arms do.
function spring(freq, damping) {
  const w = TAU * freq;
  return {
    x: 0,
    v: 0,
    to(target, dt) {
      for (let t = dt; t > 1e-6; t -= 1 / 120) {
        const h = Math.min(t, 1 / 120);
        this.v += (w * w * (target - this.x) - 2 * damping * w * this.v) * h;
        this.x += this.v * h;
      }
      return this.x;
    },
    snap(target) {
      this.v = 0;
      this.x = target;
      return target;
    },
  };
}

// The walk, worked out once per layout so any moment of it can be drawn exactly: full stride, then
// steps that shorten to a halt. Each step covers the distance its swing spans, so the feet never
// slide. For u in 0..1 it gives how far along the path the bear is, the step phase (PI a step) and
// the leg swing.
function planWalk(distance) {
  const speed = STRIDE / STEP_TIME;
  const brake = Math.min(distance * 0.35, STRIDE * 1.5);
  const tBrake = (2 * brake) / speed;
  const total = (distance - brake) / speed + tBrake;
  const N = 600;
  const dt = total / N;
  const along = new Float32Array(N + 1), phase = new Float32Array(N + 1), amp = new Float32Array(N + 1);
  let s = 0, p = 0;
  for (let i = 0; i <= N; i++) {
    const k = 1 - smooth(clamp01((i * dt - (total - tBrake)) / tBrake));
    const a = SWING * Math.pow(k, 0.6);
    along[i] = s;
    phase[i] = p;
    amp[i] = a;
    s += speed * k * dt;
    if (a > 1e-3) p += (Math.PI * speed * k * dt) / (2 * HIP_Y * Math.sin(a));
  }
  for (let i = 0; i <= N; i++) along[i] /= along[N];
  return { total, N, along, phase, amp };
}

function sampleWalk(plan, u, out) {
  const f = clamp01(u) * plan.N;
  const i = Math.min(plan.N - 1, Math.floor(f));
  const t = f - i;
  out.along = lerp(plan.along[i], plan.along[i + 1], t);
  out.phase = lerp(plan.phase[i], plan.phase[i + 1], t);
  out.amp = lerp(plan.amp[i], plan.amp[i + 1], t);
  return out;
}

// A camera lens for the dive: the scene is drawn into a multisampled target with its depth, then
// gathered on a golden-angle spiral weighted by each sample's circle of confusion, so the eye stays
// sharp while the fur around it melts into soft bokeh.
function makeLens(renderer) {
  const target = new THREE.WebGLRenderTarget(4, 4, { samples: 4, depthTexture: new THREE.DepthTexture(4, 4) });
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: target.texture },
      tDepth: { value: target.depthTexture },
      uRes: { value: new THREE.Vector2(4, 4) },
      uNear: { value: 0.1 },
      uFar: { value: 40 },
      uFocus: { value: 1 },
      uBlur: { value: 0 },
      uMax: { value: 20 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      #define TAPS 40
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform vec2 uRes;
      uniform float uNear;
      uniform float uFar;
      uniform float uFocus;
      uniform float uBlur;
      uniform float uMax;
      varying vec2 vUv;
      float viewZ(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
      float coc(float z) { return min(abs(z - uFocus) / z * uBlur, uMax); }
      void main() {
        float z0 = viewZ(texture2D(tDepth, vUv).x);
        float c0 = coc(z0);
        float radius = max(c0, 0.5 * min(uMax, uBlur));
        vec3 col = texture2D(tColor, vUv).rgb;
        float tot = 1.0;
        // each pixel starts the spiral at its own angle, which turns banding into fine grain
        float spin = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        for (int i = 1; i < TAPS; i++) {
          float fi = float(i);
          float r = radius * sqrt(fi / float(TAPS - 1));
          float a = fi * 2.39996323 + spin;
          vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
          float z = viewZ(texture2D(tDepth, uv).x);
          float c = coc(z);
          // what is behind can't blur over something sharper in front of it
          if (z > z0) c = min(c, c0 * 2.0);
          float m = smoothstep(r - 1.0, r + 1.0, c);
          col += mix(col / tot, texture2D(tColor, uv).rgb, m);
          tot += 1.0;
        }
        gl_FragColor = vec4(col / tot, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const screen = new THREE.Scene();
  screen.add(quad);
  const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2();
  return {
    uniforms: material.uniforms,
    screen,
    flat,
    render(scene, camera) {
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
      material.uniforms.uRes.value.copy(size);
      material.uniforms.uNear.value = camera.near;
      material.uniforms.uFar.value = camera.far;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(screen, flat);
    },
    // give the target's memory back while the lens is not in use
    shrink() {
      if (target.width > 4) target.setSize(4, 4);
    },
    dispose() {
      target.depthTexture.dispose();
      target.dispose();
      material.dispose();
      quad.geometry.dispose();
    },
  };
}

// The loader: a white room, the bear walks in from the right, stops in the middle, turns to look at
// the camera, waves, and the camera dives into its mocha eye. One GSAP timeline drives the story;
// springs add the follow-through that makes a plush feel soft.
export function createLoaderScene(canvas, { mobile = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0xffffff, 1);
  const tiers = mobile ? TIERS.mobile : TIERS.desktop;
  const quality = { dpr: 1, shells: 1, lens: false };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
  const bear = createBear({ shells: mobile ? 18 : 28 });
  scene.add(bear.root);
  const lens = makeLens(renderer);

  const home = new THREE.Vector3();
  const homeLook = new THREE.Vector3(0, 1.05, 0);
  const start = new THREE.Vector3();
  const ORIGIN = new THREE.Vector3();
  let yaw = -1.2;
  let plan = null;
  const st = { walk: 0, turn: 0, look: 0, wave: 0, zoom: 0, fade: 0 };

  // the pixel ratio a tier draws at on this screen
  const pixelRatio = (t) => Math.min(t.dpr, Math.max(window.devicePixelRatio || 1, 1.5));

  function size() {
    renderer.setPixelRatio(pixelRatio(quality));
    renderer.setSize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), false);
  }

  function layout() {
    size();
    const aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
    camera.aspect = aspect;
    // tall screens step back so the bear keeps room around it
    const dist = aspect < 0.75 ? 9.6 : aspect < 1.15 ? 8.4 : 7.4;
    home.set(0, 1.32, dist);
    // it starts just past the right edge, a little further back, so it walks in at an angle
    const sz = aspect < 0.75 ? -0.9 : -1.7;
    const halfW = Math.tan(THREE.MathUtils.degToRad(16)) * (dist - sz) * aspect;
    start.set(halfW + 1.25, 0, sz);
    yaw = Math.atan2(-start.x, -start.z);
    plan = planWalk(start.length());
  }
  layout();

  // the story; the walk's length depends on the screen, so it is built after the first layout
  const tl = gsap.timeline({ paused: true });
  tl.to(st, { walk: 1, duration: plan.total, ease: 'none' });
  tl.to(st, { turn: 1, duration: 0.9, ease: 'power1.inOut' }, '+=0.05');
  tl.to(st, { look: 1, duration: 0.6, ease: 'power2.out' }, '-=0.35');
  tl.addLabel('hello');
  tl.to(st, { wave: 1, duration: 1.3, ease: 'none' }, 'hello');
  tl.addLabel('dive', 'hello+=1.0');
  tl.to(st, { zoom: 1, duration: 2.0, ease: 'power2.inOut' }, 'dive');
  tl.to(st, { fade: 1, duration: 0.4, ease: 'power1.in' }, 'dive+=1.55');

  const springs = {
    neckX: spring(2.2, 0.5),
    neckY: spring(1.8, 0.75),
    neckZ: spring(2.0, 0.45),
    armL: spring(2.8, 0.42),
    armR: spring(2.8, 0.42),
    raise: spring(2.4, 0.55),
    wag: spring(3.2, 0.5),
    swayX: spring(2.6, 0.3),
    swayY: spring(3.4, 0.3),
    swayZ: spring(2.6, 0.3),
  };
  const lastPos = new THREE.Vector3();
  const motion = new THREE.Vector3();
  let snapNext = true;

  const walk = { along: 0, phase: 0, amp: 0 };
  const qRest = new THREE.Quaternion();
  const qWave = new THREE.Quaternion();
  const qWag = new THREE.Quaternion();
  const DOWN = new THREE.Vector3(0, -1, 0);
  const FORWARD = new THREE.Vector3(0, 0, 1);
  // the waving paw: up beside the cheek, a little in front of the hood
  const WAVE_DIR = new THREE.Vector3(0.5, 0.52, 0.7).normalize();
  let clock = 0;

  function pose(dt, s, snap) {
    const go = (sp, target) => (snap ? sp.snap(target) : sp.to(target, dt));
    sampleWalk(plan, s.walk, walk);
    bear.root.position.lerpVectors(start, ORIGIN, walk.along);
    let { phase, amp } = walk;
    // turning to face the camera: two small shuffling steps
    if (s.turn > 0) {
      phase = plan.phase[plan.N] + s.turn * TAU;
      amp = 0.16 * Math.sin(Math.PI * s.turn);
    }
    poseWalk(bear, phase, amp);
    const bodyYaw = lerp(yaw, 0, smooth(clamp01((s.turn - 0.12) / 0.88)));
    bear.root.rotation.y = bodyYaw;

    // the head: it glances at the camera as the bear arrives and leads the turn; it bobs a little
    // behind each step, steadies against the body's sway, then tilts, curious, and nods hello
    const calm = 1 - s.zoom;
    const breathe = Math.sin(clock * 2.3) * calm * smooth(clamp01(s.turn));
    const glance = 0.3 * smooth(clamp01((s.walk - 0.62) / 0.38));
    const headYaw = lerp(yaw, 0, Math.max(glance, smooth(clamp01(s.turn * 1.4))));
    const raise = smooth(clamp01(s.wave / 0.22)) * (1 - smooth(clamp01((s.wave - 0.74) / 0.26)));
    bear.neck.rotation.y = go(springs.neckY, headYaw - bodyYaw);
    bear.neck.rotation.x = go(springs.neckX, -0.9 * bear.pelvis.position.y + 0.07 * s.look + 0.012 * breathe - 0.04 * raise);
    bear.neck.rotation.z = go(springs.neckZ, -0.5 * bear.pelvis.rotation.z + 0.13 * s.look - 0.03 * raise);
    bear.pelvis.scale.x *= 1 - 0.004 * breathe;
    bear.pelvis.scale.y *= 1 + 0.008 * breathe;
    bear.pelvis.scale.z *= 1 - 0.004 * breathe;

    // the arms swing a beat behind the legs
    const [armL, armR] = bear.arms;
    armL.rotation.x = go(springs.armL, armL.rotation.x - 0.1 * s.look);
    armR.rotation.x = go(springs.armR, armR.rotation.x - 0.1 * s.look);
    // hello: the paw comes up beside the cheek and waves twice
    const up = go(springs.raise, raise);
    const wag = go(springs.wag, 0.32 * Math.sin(clamp01((s.wave - 0.14) / 0.66) * TAU * 2) * raise);
    if (up > 0.001) {
      qRest.setFromEuler(armR.rotation);
      qWave.setFromUnitVectors(DOWN, WAVE_DIR).premultiply(qWag.setFromAxisAngle(FORWARD, wag));
      armR.quaternion.slerpQuaternions(qRest, qWave, up);
    }

    // the fur swings a beat behind the body: it trails as the bear walks, bounces with each step
    // and swings forward when it stops
    motion.copy(bear.root.position).y += bear.pelvis.position.y;
    if (snap || dt <= 0) motion.set(0, 0, 0);
    else motion.sub(lastPos).divideScalar(dt).multiplyScalar(-0.35);
    lastPos.copy(bear.root.position).y += bear.pelvis.position.y;
    bear.sway.set(go(springs.swayX, motion.x), go(springs.swayY, motion.y), go(springs.swayZ, motion.z));

    // the shadow tightens as the body lifts
    const lift = bear.pelvis.position.y;
    bear.shadow.scale.set(1 - lift * 1.5, 0.72 - lift * 1.1, 1);
    bear.update();
  }

  const look = new THREE.Vector3();
  const spot = new THREE.Vector3();
  const eyeN = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const view = { focus: 1, blur: 0 };

  function placeCamera(s) {
    const z = s.zoom;
    const eye = bear.eyes[0];
    spot.copy(EYE_SPOT).multiplyScalar(EYE_R).applyMatrix4(eye.matrixWorld);
    if (z <= 0) {
      camera.position.copy(home);
      // the camera leans a touch towards the bear as it comes in
      look.copy(homeLook);
      look.x += bear.root.position.x * 0.03;
      camera.fov = 32;
    } else {
      // the dive: straight at the eye, closing the distance at a steady rate of magnification
      eyeN.copy(EYE_SPOT).transformDirection(eye.matrixWorld);
      toCam.subVectors(home, spot);
      const d0 = toCam.length();
      toCam.divideScalar(d0).lerp(eyeN, smooth(clamp01(z * 1.3))).normalize();
      camera.position.copy(spot).addScaledVector(toCam, d0 * Math.pow(END_DIST / d0, z));
      look.lerpVectors(homeLook, spot, smooth(clamp01(z * 1.6)));
      camera.fov = lerp(32, 24, smooth(z));
    }
    camera.lookAt(look);
    camera.updateMatrixWorld();
    const dist = camera.position.distanceTo(spot);
    camera.near = Math.min(0.5, dist * 0.2);
    camera.far = dist + 30;
    camera.updateProjectionMatrix();
    // close up, the lens softens all but the eye, and the fur shortens so its strands don't fill
    // the screen
    view.blur = smooth(clamp01((z - 0.22) / 0.45));
    view.focus = -tmp.copy(spot).applyMatrix4(camera.matrixWorldInverse).z;
    bear.setFur(1 - 0.75 * smooth(clamp01((z - 0.2) / 0.5)), quality.shells);
  }

  function render(dt = 0, s = st, snap = false) {
    clock += dt;
    pose(dt, s, snap || snapNext);
    snapNext = false;
    placeCamera(s);
    if (quality.lens && view.blur > 0.01) {
      const px = renderer.getPixelRatio();
      lens.uniforms.uFocus.value = view.focus;
      lens.uniforms.uBlur.value = view.blur * 26 * px;
      lens.uniforms.uMax.value = 22 * px;
      lens.render(scene, camera);
    } else {
      renderer.render(scene, camera);
    }
  }

  // the hardest frame of the intro, halfway into the dive with the head filling the screen
  const HARDEST = { walk: 1, turn: 1, look: 1, wave: 0, zoom: 0.4, fade: 0 };

  function useTier(t) {
    Object.assign(quality, t);
    if (!t.lens) lens.shrink();
    size();
  }

  // Time the hardest frame at the best tier; if it is too slow, jump to the tier the timing says
  // will fit (a frame's cost goes with its pixels and its shells), check that one, and so on down.
  async function benchmark() {
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const cost = (t) => pixelRatio(t) ** 2 * (0.35 + 0.65 * t.shells) * (t.lens ? 1.3 : 1);
    const measure = async (t) => {
      useTier(t);
      render(0, HARDEST, true); // the first draw at a new size sets up its buffers
      sync();
      const times = [];
      for (let k = 0; k < 3; k++) {
        await frame();
        if (!alive) return 0;
        sync();
        const t0 = performance.now();
        render(0, HARDEST, true);
        sync();
        times.push(performance.now() - t0);
        if (times[k] > FRAME_BUDGET * 3) break;
      }
      times.sort((a, b) => a - b);
      return times[times.length >> 1];
    };
    const shown = canvas.style.opacity;
    canvas.style.opacity = '0';
    let i = 0;
    let ms = await measure(tiers[0]);
    while (alive && ms > FRAME_BUDGET && i < tiers.length - 1) {
      const unit = ms / cost(tiers[i]);
      let j = i + 1;
      while (j < tiers.length - 1 && unit * cost(tiers[j]) > FRAME_BUDGET) j++;
      i = j;
      ms = await measure(tiers[i]);
    }
    useTier(tiers[i]);
    canvas.style.opacity = shown;
    return ms;
  }

  let waiting = false;
  let ready = false;
  let alive = true;
  tl.call(() => {
    if (!ready) {
      tl.pause();
      waiting = true;
    }
  }, null, 'hello');

  const tick = (_, dt) => render(Math.min(dt, 50) / 1000);

  return {
    tl,
    state: st,
    quality,
    resize() {
      layout();
      render();
    },
    // compile every shader up front, so nothing stalls once the bear is walking
    async prepare() {
      useTier(tiers[0]);
      try {
        if (renderer.compileAsync) {
          await renderer.compileAsync(scene, camera);
          await renderer.compileAsync(lens.screen, lens.flat);
        } else {
          renderer.compile(scene, camera);
          renderer.compile(lens.screen, lens.flat);
        }
      } catch { /* compile on first draw instead */ }
      render(0, st, true);
    },
    // pick the quality the GPU can hold at a steady frame rate (or the given tier); false when
    // even the lightest is too slow to play smoothly
    async tune(tier) {
      let ms = 0;
      if (tier != null) useTier(tiers[Math.min(tier, tiers.length - 1)]);
      else ms = await benchmark();
      if (!alive) return false;
      snapNext = true;
      render(0);
      return ms <= FRAME_BUDGET * 2;
    },
    play() {
      gsap.ticker.add(tick);
      tl.play();
    },
    setReady() {
      ready = true;
      if (waiting) {
        waiting = false;
        tl.play();
      }
    },
    // debug: hold the sequence at a given second
    seek(t) {
      ready = true;
      gsap.ticker.remove(tick);
      tl.pause();
      tl.seek(t, false);
      clock = t;
      render(0, st, true);
    },
    dispose() {
      alive = false;
      gsap.ticker.remove(tick);
      tl.kill();
      lens.dispose();
      bear.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
