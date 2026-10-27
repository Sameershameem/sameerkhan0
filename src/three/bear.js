import * as THREE from 'three';
import { furFabric, furry, felt, safetyEye, tileUv, shared } from './fur.js';

// The plush teddy from the reference photo: a cream velvet bear with little bead eyes, in a shaggy
// blue shark hood with a white felt "teeth" trim and pink-and-olive eyes, a fluffy white collar and
// suit with fish on the belly, blue sleeves, and cream feet in blue shoes. About 2.25 units tall,
// facing +z, rigged for walking, turning and waving.

const TAU = Math.PI * 2;
const ellipsoid = (rx, ry, rz, w = 96, h = 72) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
// sphere poles squeeze the strands, so each part keeps its poles where they are not seen
const furBall = (rx, ry, rz, tile, { poles = 'y', w = 96, h = 72 } = {}) => {
  const g = new THREE.SphereGeometry(1, w, h);
  if (poles === 'z') g.rotateX(Math.PI / 2);
  if (poles === 'x') g.rotateZ(Math.PI / 2);
  g.scale(rx, ry, rz);
  const around = poles === 'y' ? (rx + rz) / 2 : poles === 'z' ? (rx + ry) / 2 : (ry + rz) / 2;
  const along = poles === 'y' ? ry : poles === 'z' ? rz : rx;
  return tileUv(g, TAU * around, Math.PI * along, tile);
};
const furCapsule = (r, len, tile) => tileUv(new THREE.CapsuleGeometry(r, len, 16, 64), TAU * r, len + Math.PI * r, tile);

export const HIP_Y = 0.44; // hip pivot height; also the leg's length down to the sole
const SHOULDER = new THREE.Vector3(0.34, 1.0, 0.02);
const NECK_Y = 1.12;
const HEAD = new THREE.Vector3(0, 0.42, 0.04); // head centre, in the neck's space
const HEAD_R = [0.52, 0.49, 0.48];
const MUZZLE = new THREE.Vector3(0, -0.13, 0.4); // muzzle centre, relative to the head
const MUZZLE_R = [0.21, 0.15, 0.13];
const HOOD = new THREE.Vector3(0, 0.47, -0.085); // hood centre, in the neck's space
const HOOD_R = 0.62;
const HOLE = [0, -0.19, 0.66, 0.6]; // face opening, in hood-direction space
const EYE_R = 0.066;
// the bead eyes: a deep sapphire, the colour the camera dives into before the hero's midnight
const EYE_COLOR = '#1c2b6a';

// a point on the muzzle's surface, lifted a little, relative to the head
function onMuzzle(x, y, lift = 0.01) {
  const k = 1 - (x / MUZZLE_R[0]) ** 2 - ((y - MUZZLE.y) / MUZZLE_R[1]) ** 2;
  return new THREE.Vector3(x, y, MUZZLE.z + MUZZLE_R[2] * Math.sqrt(Math.max(0, k)) + lift);
}

function fishTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 320;
  const g = cv.getContext('2d');
  g.translate(128, 168);
  g.scale(2, 2);
  g.rotate(-0.25);
  g.lineWidth = 6;
  g.lineJoin = 'round';
  g.strokeStyle = '#1f2f66';
  g.fillStyle = '#8fa8e6';
  g.beginPath();
  g.ellipse(0, -10, 30, 44, 0, 0, TAU);
  g.moveTo(0, 30);
  g.lineTo(-24, 66);
  g.lineTo(24, 66);
  g.closePath();
  g.fill();
  g.stroke();
  g.lineWidth = 4;
  for (const y of [-12, 6]) {
    g.beginPath();
    g.arc(0, y, 16, 0.2 * Math.PI, 0.8 * Math.PI);
    g.stroke();
  }
  g.fillStyle = '#1f2f66';
  g.beginPath();
  g.arc(8, -34, 5, 0, TAU);
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  return tex;
}

function shadowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(70,56,46,0.5)');
  grad.addColorStop(0.4, 'rgba(70,56,46,0.24)');
  grad.addColorStop(1, 'rgba(70,56,46,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(cv);
}

export function createBear({ shells = 24 } = {}) {
  const s = (k) => Math.max(4, Math.round(shells * k));
  const velvet = { color: '#ebe0d0', tip: '#f4ecdf', root: 0.9, clump: 0.12, sheen: 0.12, furLen: 0.014, shells: s(0.4) };
  const fabrics = {
    suit: furFabric({ color: '#efede8', tip: '#fbfaf7', root: 0.58, clump: 0.6, furLen: 0.075, shells, comb: [0, -1.0, 0.15], sheen: 0.22 }),
    face: furFabric({ ...velvet, comb: [0, -0.3, 0.1], blush: [0.29, -0.1, 0.34, 0.11] }),
    paw: furFabric({ ...velvet, comb: [0, -0.3, 0] }),
    feet: furFabric({ ...velvet, comb: [0, 0.2, 0.4], sole: -0.02 }),
    hood: furFabric({ color: '#5d79c6', tip: '#7c97da', inside: '#46609f', root: 0.42, clump: 0.6, furLen: 0.1, shells, comb: [0, -1.1, -0.4], sheen: 0.26, hole: HOLE }),
    sleeve: furFabric({ color: '#5d79c6', tip: '#7c97da', root: 0.42, clump: 0.6, furLen: 0.09, shells, comb: [0, -1.0, 0], sheen: 0.26, trim: [-0.03, 0.08] }),
    collar: furFabric({ color: '#efede8', tip: '#fbfaf7', root: 0.58, clump: 0.6, furLen: 0.085, shells: s(0.85), comb: [0, -0.6, 0.4], sheen: 0.2 }),
  };
  const furries = [];
  const part = (geo, fabric) => {
    const m = furry(geo, fabric);
    furries.push(m);
    return m;
  };
  // spheres standing in for the parts, so each part softly shades its neighbours
  const occluders = [];
  const occlude = (obj, r, offset = new THREE.Vector3()) => occluders.push({ obj, r, offset });
  // spheres the fur gives way round: the eyes, the nose and the felt patches
  const carves = [];
  const carve = (obj, r) => carves.push({ obj, r });

  const root = new THREE.Group();
  const pelvis = new THREE.Group();
  root.add(pelvis);

  // body, tail and the fish on the belly, half sunk in the pile
  const body = part(furBall(0.43, 0.45, 0.37, 0.62), fabrics.suit);
  body.position.set(0, 0.74, 0);
  pelvis.add(body);
  occlude(body, 0.4);
  const tail = part(furBall(0.1, 0.1, 0.1, 0.62, { w: 40, h: 30 }), fabrics.suit);
  tail.position.set(0, 0.6, -0.38);
  pelvis.add(tail);
  const fishMat = felt('#ffffff', { map: fishTexture(), sheen: 0.04 });
  for (const side of [-1, 1]) {
    const x = 0.16 * side, y = -0.08;
    const z = 0.37 * Math.sqrt(1 - (x / 0.43) ** 2 - (y / 0.45) ** 2);
    const n = new THREE.Vector3(x / 0.43 ** 2, y / 0.45 ** 2, z / 0.37 ** 2).normalize();
    const fish = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.2), fishMat);
    fish.position.set(x, 0.74 + y, z).addScaledVector(n, 0.045);
    fish.lookAt(fish.position.clone().add(n));
    fish.rotateZ(side * 0.18);
    pelvis.add(fish);
  }

  // legs: hip pivots, each with a leg and a foot in a blue shoe
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(0.19 * side, HIP_Y, 0);
    const leg = part(furCapsule(0.14, 0.1, 0.62), fabrics.suit);
    leg.position.set(0, -0.17, 0);
    hip.add(leg);
    const foot = part(furBall(0.165, 0.105, 0.245, 0.4, { poles: 'x' }), fabrics.feet);
    foot.position.set(0, -HIP_Y + 0.105, 0.07);
    hip.add(foot);
    pelvis.add(hip);
    occlude(leg, 0.13);
    occlude(foot, 0.12);
    return hip;
  });

  // arms: shaggy blue sleeves with cream paws
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(SHOULDER.x * side, SHOULDER.y, SHOULDER.z);
    shoulder.rotation.z = 0.42 * side;
    const sleeve = part(furCapsule(0.128, 0.2, 0.62), fabrics.sleeve);
    sleeve.position.set(0, -0.19, 0);
    shoulder.add(sleeve);
    const paw = part(furBall(0.112, 0.106, 0.112, 0.4, { poles: 'x', w: 64, h: 48 }), fabrics.paw);
    paw.position.set(0, -0.38, 0.03);
    shoulder.add(paw);
    pelvis.add(shoulder);
    occlude(sleeve, 0.12);
    occlude(paw, 0.1);
    return shoulder;
  });

  // head: the velvet face and muzzle, the nose, the stitched mouth, bead eyes, and the hood
  const neck = new THREE.Group();
  neck.position.set(0, NECK_Y, 0);
  pelvis.add(neck);
  const head = part(furBall(...HEAD_R, 0.4), fabrics.face);
  head.position.copy(HEAD);
  neck.add(head);
  occlude(head, 0.46);
  const muzzle = part(furBall(...MUZZLE_R, 0.4, { poles: 'x', w: 64, h: 48 }), fabrics.face);
  muzzle.position.copy(HEAD).add(MUZZLE);
  neck.add(muzzle);
  occlude(muzzle, 0.1);

  // the nose: soft brown velvet, a rounded triangle, wider at the top
  const noseGeo = ellipsoid(0.084, 0.058, 0.05, 64, 48);
  const np = noseGeo.attributes.position;
  for (let i = 0; i < np.count; i++) {
    const y = np.getY(i);
    if (y < 0) np.setX(i, np.getX(i) * (1 + 0.42 * (y / 0.058)));
  }
  noseGeo.computeVertexNormals();
  const nose = new THREE.Mesh(noseGeo, felt('#7a4a37', { gloss: 0.12, sheen: 0.1 }));
  nose.position.copy(HEAD).add(new THREE.Vector3(0, -0.07, 0.5));
  neck.add(nose);
  carve(nose, 0.07);
  const thread = felt('#4a3024', { sheen: 0 });
  const stitch = (pts) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => onMuzzle(x, y).add(HEAD)));
    neck.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.0058, 8), thread));
  };
  stitch([[0, -0.132], [0, -0.175]]);
  stitch([[-0.048, -0.2], [-0.022, -0.188], [0, -0.175]]);
  stitch([[0.048, -0.2], [0.022, -0.188], [0, -0.175]]);

  const eyes = [-1, 1].map((side) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 128, 96), safetyEye({ iris: EYE_COLOR }));
    const x = 0.2 * side, y = 0.03;
    const z = HEAD_R[2] * Math.sqrt(1 - (x / HEAD_R[0]) ** 2 - (y / HEAD_R[1]) ** 2) - 0.026;
    eye.position.copy(HEAD).add(new THREE.Vector3(x, y, z));
    // sewn-on eyes look a little outwards and down
    eye.lookAt(eye.position.clone().add(new THREE.Vector3(0.2 * side, -0.05, 1)));
    neck.add(eye);
    carve(eye, EYE_R);
    return eye;
  });

  const hood = part(furBall(HOOD_R, HOOD_R, HOOD_R, 0.62, { poles: 'z', w: 128, h: 96 }), fabrics.hood);
  hood.position.copy(HOOD);
  neck.add(hood);
  occlude(hood, 0.5);
  // the fluffy white collar round the sides of the face and under the chin, tapering at its ends
  const rimDir = (a) => {
    const x = HOLE[2] * Math.sin(a), y = HOLE[1] + HOLE[3] * Math.cos(a);
    return new THREE.Vector3(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y)));
  };
  const COLLAR_FROM = THREE.MathUtils.degToRad(52);
  const rimPath = new THREE.CatmullRomCurve3(
    Array.from({ length: 49 }, (_, k) => HOOD.clone().addScaledVector(rimDir(COLLAR_FROM + (k / 48) * (TAU - 2 * COLLAR_FROM)), HOOD_R - 0.01)),
  );
  const RINGS = 200, SIDES = 24;
  const collarGeo = new THREE.TubeGeometry(rimPath, RINGS, 0.066, SIDES, false);
  const cp = collarGeo.attributes.position;
  const centre = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= RINGS; i++) {
    rimPath.getPointAt(i / RINGS, centre);
    const t = i / RINGS;
    const taper = Math.sqrt(Math.min(1, Math.min(t, 1 - t) / 0.08));
    for (let j = 0; j <= SIDES; j++) {
      const k = i * (SIDES + 1) + j;
      v.fromBufferAttribute(cp, k).sub(centre).multiplyScalar(Math.max(0.05, taper)).add(centre);
      cp.setXYZ(k, v.x, v.y, v.z);
    }
  }
  collarGeo.computeVertexNormals();
  const collar = part(tileUv(collarGeo, rimPath.getLength(), TAU * 0.066, 0.5), fabrics.collar);
  neck.add(collar);
  // white felt teeth along the top of the opening, soft rounded triangles over the forehead
  const toothMat = felt('#fbf8f2', { sheen: 0.12 });
  const toothShape = new THREE.Shape();
  toothShape.moveTo(-0.046, 0);
  toothShape.quadraticCurveTo(0, 0.012, 0.046, 0);
  toothShape.quadraticCurveTo(0.012, -0.05, 0.004, -0.082);
  toothShape.quadraticCurveTo(0, -0.09, -0.004, -0.082);
  toothShape.quadraticCurveTo(-0.012, -0.05, -0.046, 0);
  const toothGeo = new THREE.ExtrudeGeometry(toothShape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 4, curveSegments: 16 });
  toothGeo.translate(0, 0, -0.004);
  for (let k = 0; k < 9; k++) {
    const a = THREE.MathUtils.degToRad(-58 + k * 14.5);
    const dir = rimDir(a);
    const tooth = new THREE.Mesh(toothGeo, toothMat);
    tooth.position.copy(HOOD).addScaledVector(dir, HOOD_R + 0.012);
    // facing out of the opening, pointing towards the middle of the face
    tooth.lookAt(tooth.position.clone().add(dir));
    tooth.rotateZ(-a * 0.55);
    tooth.rotateX(-0.25);
    neck.add(tooth);
  }
  // the hood creature's eyes: pink felt with dark olive middles, sewn on above the teeth with the
  // shaggy pile standing round them
  const patch = (dir, r, color, lift) => {
    const n = new THREE.Vector3(...dir).normalize();
    const m = new THREE.Mesh(ellipsoid(r[0], r[1], r[2], 48, 36), felt(color, { sheen: 0.08 }));
    m.position.copy(HOOD).addScaledVector(n, HOOD_R + lift);
    m.lookAt(m.position.clone().add(n));
    neck.add(m);
    return m;
  };
  for (const side of [-1, 1]) {
    const pink = patch([0.46 * side, 0.5, 0.74], [0.14, 0.115, 0.024], '#f2c3cd', 0.014);
    pink.rotateZ(-0.35 * side);
    const olive = patch([0.38 * side, 0.58, 0.72], [0.074, 0.066, 0.024], '#3c4130', 0.026);
    olive.rotateZ(-0.35 * side);
    carve(pink, 0.15);
  }

  // soft shadows on the white floor: one under the bear, one under each foot as it lands
  const shadowTex = shadowTexture();
  const blob = (w, h, opacity) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity }),
    );
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = -1;
    return m;
  };
  const shadow = blob(1.6, 1.15, 1);
  shadow.position.y = 0.002;
  root.add(shadow);
  const footShadows = legs.map(() => {
    const m = blob(0.5, 0.62, 0.85);
    m.position.y = 0.003;
    root.add(m);
    return m;
  });

  const allMaterials = new Set();
  root.traverse((o) => { if (o.material) allMaterials.add(o.material); });
  const tmp = new THREE.Vector3();
  const feet = legs.map((hip) => hip.children[1]);

  return {
    root, pelvis, body, legs, arms, neck, head, eyes, shadow,
    eyeMaterials: eyes.map((e) => e.material),
    fabrics,
    // the world-space lean the bear's motion gives every strand tip
    sway: shared.uSway.value,
    // after posing: the parts' shading spheres, where the fur gives way, and the feet's shadows
    update() {
      root.updateMatrixWorld(true);
      occluders.forEach((o, i) => {
        o.obj.localToWorld(tmp.copy(o.offset));
        shared.uOcc.value[i].set(tmp.x, tmp.y, tmp.z, o.r);
      });
      shared.uOccN.value = occluders.length;
      carves.forEach((c, i) => {
        c.obj.getWorldPosition(tmp);
        shared.uCarve.value[i].set(tmp.x, tmp.y, tmp.z, c.r);
      });
      feet.forEach((f, i) => {
        f.getWorldPosition(tmp);
        root.worldToLocal(tmp);
        const lift = Math.max(0, tmp.y - 0.105);
        footShadows[i].position.set(tmp.x, 0.003, tmp.z);
        footShadows[i].material.opacity = 0.85 * Math.max(0, 1 - lift * 9);
        footShadows[i].scale.setScalar(1 + lift * 2);
      });
    },
    // density: the share of shells drawn (fewer on slower GPUs; the fur keeps its length);
    // k: the share of the fur's length drawn (it shortens as the camera comes close)
    setFur(k, density = 1) {
      for (const f of Object.values(fabrics)) f.uniforms.uShells.value = Math.max(3, Math.round(f.shells * density));
      for (const m of furries) {
        const fur = m.userData.fur;
        fur.count = Math.round(fur.material.uniforms.uShells.value * k);
      }
    },
    dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const m of allMaterials) {
        if (m.map) m.map.dispose();
        if (m.uniforms?.uMap?.value) m.uniforms.uMap.value.dispose();
        m.dispose();
      }
      shadowTex.dispose();
    },
  };
}

// One moment of the walk cycle. phase advances by PI per step; amp is the leg swing in radians.
// The pelvis drops as the legs spread, so the planted foot stays on the floor, and dips a little
// more as each foot lands.
export function poseWalk(bear, phase, amp) {
  const s = Math.sin(phase), c = Math.cos(phase);
  const k = amp / 0.5;
  const swing = amp * s;
  bear.legs[0].rotation.x = -swing;
  bear.legs[1].rotation.x = swing;
  bear.legs[0].position.y = HIP_Y + 0.085 * k * Math.max(0, c) ** 1.5;
  bear.legs[1].position.y = HIP_Y + 0.085 * k * Math.max(0, -c) ** 1.5;
  const land = Math.pow(Math.abs(s), 6) * k;
  bear.pelvis.position.y = -HIP_Y * (1 - Math.cos(swing)) + 0.016 * k * Math.abs(c) - 0.01 * land;
  bear.pelvis.scale.set(1 + 0.012 * land, 1 - 0.022 * land, 1 + 0.012 * land);
  bear.arms[0].rotation.x = swing * 0.85;
  bear.arms[1].rotation.x = -swing * 0.85;
  bear.pelvis.rotation.z = 0.075 * k * s;
  bear.pelvis.rotation.y = 0.06 * k * s;
}
