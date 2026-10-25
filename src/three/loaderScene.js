import * as THREE from 'three';
import gsap from 'gsap';
import { createBear, poseWalk } from './bear.js';
import { updateLights } from './plush.js';

// Colours are used as given (sRGB), so the eye's mocha matches the page's CSS exactly.
THREE.ColorManagement.enabled = false;

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = THREE.MathUtils.lerp;
// distance along the walk: it enters at full stride and settles to a halt (speed 1.25 -> 0)
const walkEase = (u) => -0.75 * u ** 3 + 0.5 * u ** 2 + 1.25 * u;

const STEP_TIME = 0.27; // seconds per step, on average
const STRIDE = 0.4;

// The loader: a white room, the bear walks in from the right, stops in the middle, turns to look at
// the camera, and the camera dives into its mocha eye. Everything is driven by one GSAP timeline.
export function createLoaderScene(canvas, { mobile = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0xffffff, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.002, 80);
  const bear = createBear({ shells: mobile ? 7 : 11 });
  scene.add(bear.root);

  const home = new THREE.Vector3();
  const homeLook = new THREE.Vector3(0, 1.02, 0);
  const start = new THREE.Vector3();
  const path = { steps: 10, yaw: -1.2 };
  const st = { walk: 0, turn: 0, look: 0, zoom: 0, fade: 0 };

  function layout() {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    // tall screens step back so the bear keeps room around it
    const dist = aspect < 0.75 ? 9.6 : aspect < 1.15 ? 8.4 : 7.4;
    home.set(0, 1.3, dist);
    // it starts just past the right edge, a little further back, so it walks in at an angle
    const sz = aspect < 0.75 ? -0.9 : -1.7;
    const halfW = Math.tan(THREE.MathUtils.degToRad(16)) * (dist - sz) * aspect;
    start.set(halfW + 0.75, 0, sz);
    const d = start.length();
    path.steps = Math.max(4, Math.round(d / STRIDE));
    path.yaw = Math.atan2(-start.x, -start.z);
    camera.updateProjectionMatrix();
  }
  layout();

  // the walk's length depends on the screen, so the timeline is built after the first layout
  const tl = gsap.timeline({ paused: true });
  tl.to(st, { walk: 1, duration: path.steps * STEP_TIME * 1.12, ease: 'none' });
  tl.to(st, { turn: 1, duration: 0.85, ease: 'power1.inOut' }, '+=0.06');
  tl.to(st, { look: 1, duration: 0.6, ease: 'power2.out' }, '-=0.3');
  tl.addLabel('dive', '+=0.22');
  tl.to(st, { zoom: 1, duration: 1.75, ease: 'power3.inOut' }, 'dive');
  tl.to(st, { fade: 1, duration: 0.35, ease: 'power1.in' }, 'dive+=1.42');

  const eyePos = new THREE.Vector3();
  const eyeDir = new THREE.Vector3();
  const target = new THREE.Vector3();
  const look = new THREE.Vector3();
  const ORIGIN = new THREE.Vector3();
  let clock = 0;

  function pose() {
    // along the path, one step per half turn of the cycle, ending with the feet together
    const p = walkEase(st.walk);
    bear.root.position.lerpVectors(start, ORIGIN, p);
    let phase = p * path.steps * Math.PI;
    let amp = 0.5;
    // turning to face the camera: two small shuffling steps, the head leading the body
    const bodyTurn = smooth(clamp01((st.turn - 0.12) / 0.88));
    const headTurn = smooth(clamp01(st.turn * 1.45));
    if (st.turn > 0) {
      phase = path.steps * Math.PI + st.turn * 2 * Math.PI;
      amp = 0.16 * Math.sin(Math.PI * st.turn);
    }
    poseWalk(bear, phase, amp);
    const bodyYaw = lerp(path.yaw, 0, bodyTurn);
    bear.root.rotation.y = bodyYaw;
    bear.neck.rotation.y = lerp(path.yaw, 0, headTurn) - bodyYaw;
    // looking at the camera: a curious tilt and a little nod; still breathing while it waits
    const calm = 1 - st.zoom;
    const breathe = Math.sin(clock * 2.2) * 0.012 * st.look * calm;
    bear.neck.rotation.z += 0.13 * st.look;
    bear.neck.rotation.x += 0.07 * st.look + breathe;
    bear.pelvis.scale.set(1 - breathe * 0.4, 1 + breathe * 0.8, 1 - breathe * 0.4);
    bear.arms[0].rotation.x += -0.12 * st.look;
    bear.arms[1].rotation.x += -0.12 * st.look;
    // the shadow tightens as the body lifts
    const lift = bear.pelvis.position.y;
    bear.shadow.scale.set(1 - lift * 1.5, 0.72 - lift * 1.1, 1);
  }

  function placeCamera() {
    const z = st.zoom;
    camera.position.copy(home);
    camera.fov = 32;
    if (z > 0) {
      bear.root.updateMatrixWorld(true);
      const eye = bear.eyes[0];
      eye.getWorldPosition(eyePos);
      eye.getWorldDirection(eyeDir);
      target.copy(eyePos).addScaledVector(eyeDir, 0.06 + 0.1);
      camera.position.lerpVectors(home, target, z);
      look.lerpVectors(homeLook, eyePos, smooth(clamp01(z * 1.5)));
      camera.fov = lerp(32, 26, z);
      camera.lookAt(look);
      // close up, the pupil narrows and the fur thins (it would cover the whole screen)
      const near = smooth(clamp01((z - 0.45) / 0.5));
      for (const m of bear.eyeMaterials) m.uniforms.uPupil.value = lerp(0.36, 0.07, near);
      bear.setFur(1 - smooth(clamp01((z - 0.3) / 0.38)));
    } else {
      camera.lookAt(homeLook);
    }
    camera.updateProjectionMatrix();
  }

  function render(dt = 0) {
    clock += dt;
    pose();
    placeCamera();
    updateLights(camera);
    renderer.render(scene, camera);
  }

  let waiting = false;
  let ready = false;
  tl.call(() => {
    if (!ready) {
      tl.pause();
      waiting = true;
    }
  }, null, 'dive');

  const tick = (_, dt) => render(dt / 1000);

  return {
    tl,
    state: st,
    resize() {
      layout();
      render();
    },
    // compile every shader up front, so nothing stalls when the bear walks into view
    async prepare() {
      try {
        if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
        else renderer.compile(scene, camera);
      } catch { /* compile on first draw instead */ }
      render();
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
      render();
    },
    dispose() {
      gsap.ticker.remove(tick);
      tl.kill();
      bear.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
