import * as THREE from 'three';
import { plushFabric, furry, felt, beadEye, lightUniforms } from './plush.js';

// The plush teddy from the reference photo: a white bear in a blue fluffy shark hood with a white
// felt "teeth" trim, pink and green dots on top, blue sleeves, fish patches on the belly and white
// feet with blue soles. It stands about 2.2 units tall, faces +z, and is rigged for walking.

const ellipsoid = (rx, ry, rz, w = 56, h = 40) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 12, 36);

export const HIP_Y = 0.44; // hip pivot height; also the leg's length down to the sole
const SHOULDER = new THREE.Vector3(0.335, 1.0, 0.02);
const NECK_Y = 1.12;
const HEAD = new THREE.Vector3(0, 0.4, 0.03); // head centre, in the neck's space
const HOOD = new THREE.Vector3(0, 0.45, -0.085); // hood centre, in the neck's space (behind the face)
const HOOD_R = 0.61;
const HOLE = [0, -0.19, 0.66, 0.6]; // face opening, in hood-direction space

function fishTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 160;
  const g = cv.getContext('2d');
  g.translate(64, 84);
  g.rotate(-0.25);
  g.lineWidth = 6;
  g.strokeStyle = '#1f2f66';
  g.fillStyle = '#a3b8ea';
  // body and tail
  g.beginPath();
  g.ellipse(0, -10, 30, 44, 0, 0, Math.PI * 2);
  g.moveTo(0, 30);
  g.lineTo(-24, 66);
  g.lineTo(24, 66);
  g.closePath();
  g.fill();
  g.stroke();
  // scales and an eye
  g.lineWidth = 4;
  for (const y of [-12, 6]) {
    g.beginPath();
    g.arc(0, y, 16, 0.2 * Math.PI, 0.8 * Math.PI);
    g.stroke();
  }
  g.fillStyle = '#1f2f66';
  g.beginPath();
  g.arc(8, -34, 5, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

function patchMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uKey: lightUniforms.uKey },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        vUv = uv;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      uniform vec3 uKey;
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        if (t.a < 0.5) discard;
        float key = clamp((dot(normalize(vN), uKey) + 0.5) / 1.5, 0.0, 1.0);
        gl_FragColor = vec4(t.rgb * (0.5 + 0.55 * key), 1.0);
      }
    `,
  });
}

function shadowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(60,48,40,0.55)');
  grad.addColorStop(0.45, 'rgba(60,48,40,0.25)');
  grad.addColorStop(1, 'rgba(60,48,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(cv);
}

export function createBear({ shells = 10 } = {}) {
  const fabrics = {
    white: plushFabric({ color: '#f1ede6', tip: '#ffffff', sheenAmt: 0.28, furLen: 0.042, density: 54, shells }),
    face: plushFabric({ color: '#f3efe9', tip: '#ffffff', sheenAmt: 0.2, furLen: 0.02, density: 74, shells: Math.max(3, Math.round(shells * 0.6)) }),
    hood: plushFabric({
      color: '#7590d8', tip: '#9fb4ee', sheen: '#e4ebfd', sheenAmt: 0.38, furLen: 0.06, density: 42, shells,
      inside: '#4a62a8', hole: HOLE, droop: [0, -0.55, 0.12],
    }),
    sleeve: plushFabric({ color: '#7590d8', tip: '#9fb4ee', sheen: '#e4ebfd', sheenAmt: 0.38, furLen: 0.055, density: 46, shells }),
    feet: plushFabric({ color: '#f1ede6', tip: '#ffffff', sheenAmt: 0.22, furLen: 0.018, density: 72, shells: Math.max(3, Math.round(shells * 0.5)), sole: -0.022 }),
  };
  const furries = [];
  const part = (geo, fabric, opts) => {
    const m = furry(geo, fabric, opts);
    furries.push(m);
    return m;
  };

  const root = new THREE.Group();
  const pelvis = new THREE.Group();
  root.add(pelvis);

  // body, tail and the fish on the belly
  const body = part(ellipsoid(0.42, 0.44, 0.36), fabrics.white);
  body.position.set(0, 0.74, 0);
  pelvis.add(body);
  const tail = part(ellipsoid(0.1, 0.1, 0.1, 24, 18), fabrics.white);
  tail.position.set(0, 0.6, -0.37);
  pelvis.add(tail);
  const fishMat = patchMaterial(fishTexture());
  for (const side of [-1, 1]) {
    const x = 0.15 * side, y = -0.07;
    const z = 0.36 * Math.sqrt(1 - (x / 0.42) ** 2 - (y / 0.44) ** 2);
    const n = new THREE.Vector3(x / 0.42 ** 2, y / 0.44 ** 2, z / 0.36 ** 2).normalize();
    const fish = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.19), fishMat);
    fish.position.set(x, 0.74 + y, z).addScaledVector(n, 0.03);
    fish.lookAt(fish.position.clone().add(n));
    fish.rotateZ(side * 0.18);
    pelvis.add(fish);
  }

  // legs: hip pivots, each with a leg and a foot whose sole is blue
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(0.19 * side, HIP_Y, 0);
    const leg = part(capsule(0.135, 0.1), fabrics.white);
    leg.position.set(0, -0.17, 0);
    hip.add(leg);
    const foot = part(ellipsoid(0.16, 0.1, 0.235), fabrics.feet);
    foot.position.set(0, -HIP_Y + 0.1, 0.07);
    hip.add(foot);
    pelvis.add(hip);
    return hip;
  });

  // arms: blue sleeves with white paws, hanging a little out from the shoulders
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(SHOULDER.x * side, SHOULDER.y, SHOULDER.z);
    shoulder.rotation.z = 0.42 * side;
    const sleeve = part(capsule(0.125, 0.2), fabrics.sleeve);
    sleeve.position.set(0, -0.19, 0);
    shoulder.add(sleeve);
    const paw = part(ellipsoid(0.115, 0.11, 0.115, 32, 24), fabrics.white);
    paw.position.set(0, -0.37, 0.03);
    shoulder.add(paw);
    pelvis.add(shoulder);
    return shoulder;
  });

  // head: face, muzzle, nose, mouth, bead eyes, and the hood over it all
  const neck = new THREE.Group();
  neck.position.set(0, NECK_Y, 0);
  pelvis.add(neck);
  const head = part(ellipsoid(0.5, 0.48, 0.48), fabrics.face);
  head.position.copy(HEAD);
  neck.add(head);
  const muzzle = part(ellipsoid(0.2, 0.15, 0.13, 40, 30), fabrics.face, { shells: 2 });
  muzzle.position.copy(HEAD).add(new THREE.Vector3(0, -0.12, 0.39));
  neck.add(muzzle);
  const nose = new THREE.Mesh(ellipsoid(0.072, 0.052, 0.046, 32, 24), felt('#6b3f2e', { gloss: 0.35, sheenAmt: 0.1 }));
  nose.position.copy(HEAD).add(new THREE.Vector3(0, -0.045, 0.515));
  neck.add(nose);
  const thread = felt('#4a3024', { sheenAmt: 0 });
  const stitch = (pts) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p).add(HEAD)));
    neck.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.0065, 6), thread));
  };
  stitch([[0, -0.095, 0.515], [0, -0.135, 0.51]]);
  stitch([[-0.05, -0.17, 0.49], [-0.022, -0.148, 0.507], [0, -0.135, 0.51]]);
  stitch([[0.05, -0.17, 0.49], [0.022, -0.148, 0.507], [0, -0.135, 0.51]]);

  const eyes = [-1, 1].map((side) => {
    const mat = beadEye();
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 96, 72), mat);
    eye.position.copy(HEAD).add(new THREE.Vector3(0.178 * side, 0.075, 0.44));
    // each bead looks a little outwards, as sewn-on eyes do
    eye.lookAt(eye.position.clone().add(new THREE.Vector3(0.18 * side, 0.02, 1)));
    neck.add(eye);
    return eye;
  });

  const hood = part(new THREE.SphereGeometry(HOOD_R, 72, 56), fabrics.hood);
  hood.position.copy(HOOD);
  neck.add(hood);
  // the hood's white fluffy lining frames the face
  const rimDir = (a) => {
    const x = HOLE[2] * Math.sin(a), y = HOLE[1] + HOLE[3] * Math.cos(a);
    return new THREE.Vector3(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y)));
  };
  const rim = new THREE.CatmullRomCurve3(
    Array.from({ length: 48 }, (_, k) => HOOD.clone().addScaledVector(rimDir((k / 48) * Math.PI * 2), HOOD_R - 0.012)),
    true,
  );
  const lining = part(new THREE.TubeGeometry(rim, 160, 0.044, 16, true), fabrics.white);
  neck.add(lining);
  // white felt teeth along the top of the opening
  const toothMat = felt('#fbf8f2', { sheenAmt: 0.12 });
  const toothGeo = new THREE.ConeGeometry(0.042, 0.085, 14).scale(1, 1, 0.55);
  for (let k = 0; k <= 10; k++) {
    const a = THREE.MathUtils.degToRad(-66 + k * 13.2);
    const dir = rimDir(a);
    const tooth = new THREE.Mesh(toothGeo, toothMat);
    tooth.position.copy(HOOD).addScaledVector(dir, HOOD_R + 0.02);
    const inward = new THREE.Vector3(-dir.x * 0.6, HOLE[1] - dir.y, -0.25).normalize();
    tooth.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), inward);
    tooth.translateY(0.035);
    neck.add(tooth);
  }
  // the hood creature's eyes: pink felt with dark olive pupils, looking up from the top of the hood
  const patch = (dir, r, color, lift) => {
    const n = new THREE.Vector3(...dir).normalize();
    const m = new THREE.Mesh(ellipsoid(r[0], r[1], r[2], 36, 26), felt(color, { sheenAmt: 0.1 }));
    m.position.copy(HOOD).addScaledVector(n, HOOD_R + lift);
    m.lookAt(m.position.clone().add(n));
    neck.add(m);
  };
  for (const side of [-1, 1]) {
    patch([0.42 * side, 0.56, 0.71], [0.135, 0.118, 0.03], '#f3c4cf', 0.05);
    patch([0.29 * side, 0.68, 0.68], [0.075, 0.07, 0.03], '#3c4130', 0.066);
  }

  // a soft contact shadow on the white floor
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  shadow.scale.set(1, 0.72, 1);
  shadow.renderOrder = -1;
  root.add(shadow);

  const allMaterials = new Set();
  root.traverse((o) => { if (o.material) allMaterials.add(o.material); });

  return {
    root, pelvis, body, legs, arms, neck, eyes, shadow,
    eyeMaterials: eyes.map((e) => e.material),
    fabrics,
    // fewer fur shells when the camera is close and the strands would cover the whole screen
    setFur(k) {
      for (const m of furries) {
        const fur = m.userData.fur;
        if (fur) fur.count = Math.max(0, Math.round(fur.userData.maxShells * k));
      }
    },
    dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const m of allMaterials) {
        if (m.map) m.map.dispose();
        if (m.uniforms && m.uniforms.uMap && m.uniforms.uMap.value) m.uniforms.uMap.value.dispose();
        m.dispose();
      }
    },
  };
}

// One moment of the walk cycle. phase advances by PI per step; amp is the leg swing in radians.
// The pelvis drops as the legs spread, so the planted foot stays on the floor.
export function poseWalk(bear, phase, amp) {
  const s = Math.sin(phase), c = Math.cos(phase);
  const k = amp / 0.5;
  const swing = amp * s;
  bear.legs[0].rotation.x = -swing;
  bear.legs[1].rotation.x = swing;
  bear.legs[0].position.y = HIP_Y + 0.07 * k * Math.max(0, c);
  bear.legs[1].position.y = HIP_Y + 0.07 * k * Math.max(0, -c);
  bear.pelvis.position.y = -HIP_Y * (1 - Math.cos(swing)) + 0.012 * k * Math.abs(c);
  bear.arms[0].rotation.x = swing * 0.9;
  bear.arms[1].rotation.x = -swing * 0.9;
  bear.pelvis.rotation.z = 0.065 * k * s;
  bear.pelvis.rotation.y = 0.06 * k * s;
  bear.neck.rotation.z = -0.05 * k * Math.sin(phase - 0.45);
  bear.neck.rotation.x = 0.035 * k * Math.cos(2 * phase - 0.6);
}
