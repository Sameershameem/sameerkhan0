import * as THREE from 'three';

// Plush fur for the loader's teddy. Each furry part is drawn as its skin plus shells of strands
// (one instanced draw). The strands come from two tileable textures: a dense field of fine strands,
// and the tufts they gather into towards their tips, which gives the plush its soft, clumpy,
// hand-drawn look. Lighting is done in linear light; colours are given as sRGB, like the page's CSS.

export const GLSL_COMMON = /* glsl */`
  uniform float uExposure;
  uniform vec3 uKey;
  uniform vec3 uFill;
  uniform vec3 uRim;
  vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
  vec3 toSRGB(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }
  // exposure, then a soft shoulder on the brightest channel only: colours keep their hue and
  // saturation, and highlights roll off instead of clipping
  vec3 film(vec3 x) {
    x *= uExposure;
    float m = max(max(x.r, x.g), x.b);
    if (m > 0.75) x *= (0.75 + 0.25 * (1.0 - exp((0.75 - m) * 4.0))) / m;
    return x;
  }
  // a soft studio: a warm key wrapping round the form, a cool fill, the sky, and the white floor's
  // bounce from below
  float keyLight(vec3 N) { return clamp((dot(N, uKey) + 0.35) / 1.35, 0.0, 1.0); }
  vec3 irradiance(vec3 N) {
    float fill = clamp((dot(N, uFill) + 0.5) / 1.5, 0.0, 1.0);
    return vec3(1.0, 0.99, 0.97) * keyLight(N) * 0.78
      + vec3(0.97, 0.99, 1.0) * fill * 0.32
      + vec3(0.24) * (0.5 + 0.5 * N.y)
      + vec3(0.2) * clamp(-N.y, 0.0, 1.0);
  }
`;

// the studio's lights: a warm key from the upper left, a cool fill from the right, light from behind
export const STUDIO = {
  key: new THREE.Vector3(-0.55, 0.78, 0.62).normalize(),
  fill: new THREE.Vector3(0.78, 0.18, 0.5).normalize(),
  rim: new THREE.Vector3(0.35, 0.55, -0.85).normalize(),
};

// shared by every material: the lights, exposure, the spheres that shade each other, the spheres the
// fur gives way round (eyes and nose), and the sway the bear's motion gives its fur
const MAX_OCC = 16;
const MAX_CARVE = 8;
export const shared = {
  uKey: { value: STUDIO.key },
  uFill: { value: STUDIO.fill },
  uRim: { value: STUDIO.rim },
  uExposure: { value: 1.22 },
  uOcc: { value: Array.from({ length: MAX_OCC }, () => new THREE.Vector4(0, -100, 0, 0)) },
  uOccN: { value: 0 },
  uCarve: { value: Array.from({ length: MAX_CARVE }, () => new THREE.Vector4(0, -100, 0, 1e-4)) },
  uSway: { value: new THREE.Vector3() },
};

function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Jittered points on a wrapping grid, and for every texel the nearest one (a tileable Voronoi)
function voronoi(size, cells, seed, fill) {
  const rnd = mulberry(seed);
  const n = cells * cells;
  const cx = new Float32Array(n), cy = new Float32Array(n), a = new Float32Array(n), b = new Float32Array(n);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const k = j * cells + i;
      cx[k] = i + 0.15 + 0.7 * rnd();
      cy[k] = j + 0.15 + 0.7 * rnd();
      a[k] = rnd();
      b[k] = rnd();
    }
  }
  const data = new Uint8Array(size * size * 4);
  const scale = cells / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x + 0.5) * scale, gy = (y + 0.5) * scale;
      const ci = Math.floor(gx), cj = Math.floor(gy);
      let best = 9, bk = 0, bx = 0, by = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          let i = ci + di, j = cj + dj, ox = 0, oy = 0;
          if (i < 0) { i += cells; ox = -cells; } else if (i >= cells) { i -= cells; ox = cells; }
          if (j < 0) { j += cells; oy = -cells; } else if (j >= cells) { j -= cells; oy = cells; }
          const k = j * cells + i;
          const dx = cx[k] + ox - gx, dy = cy[k] + oy - gy;
          const d = dx * dx + dy * dy;
          if (d < best) { best = d; bk = k; bx = dx; by = dy; }
        }
      }
      fill(data, (y * size + x) * 4, Math.sqrt(best), bx, by, a[bk], b[bk]);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const STRAND_CELLS = 64;
const CLUMP_CELLS = 8;

// The strands: R = distance to the nearest strand's centre (in strand spacings), G = its length,
// B = its shade
function strandTexture() {
  const tex = voronoi(512, STRAND_CELLS, 11, (d, o, dist, _x, _y, a, b) => {
    d[o] = Math.min(255, Math.round((dist / 0.75) * 255));
    d[o + 1] = Math.round((0.62 + 0.38 * a) * 255);
    d[o + 2] = Math.round(b * 255);
    d[o + 3] = 255;
  });
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return tex;
}

// The tufts the strands gather into: RG = the way to the tuft's centre (in tuft spacings),
// B = the tuft's height, A = its shade. Read without filtering, so the way never blurs across the
// border between two tufts (which would put a false centre there).
function clumpTexture() {
  const tex = voronoi(512, CLUMP_CELLS, 23, (d, o, _dist, x, y, a, b) => {
    d[o] = Math.round(Math.min(1, Math.max(0, 0.5 + 0.5 * x)) * 255);
    d[o + 1] = Math.round(Math.min(1, Math.max(0, 0.5 + 0.5 * y)) * 255);
    d[o + 2] = Math.round(a * 255);
    d[o + 3] = Math.round(b * 255);
  });
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

let textures = null;
function furTextures() {
  if (!textures) textures = { strands: strandTexture(), clumps: clumpTexture() };
  return textures;
}

const AO_GLSL = /* glsl */`
  uniform vec4 uOcc[${MAX_OCC}];
  uniform float uOccN;
  // soft shadowing from the other parts (each stood in for by a sphere) and from the floor
  float occlusion(vec3 p, vec3 n) {
    float ao = 1.0;
    for (int i = 0; i < ${MAX_OCC}; i++) {
      if (float(i) >= uOccN) break;
      vec4 s = uOcc[i];
      vec3 d = s.xyz - p;
      float l2 = max(dot(d, d), 1e-4);
      float nl = dot(n, d) * inversesqrt(l2);
      ao *= 1.0 - clamp(nl * s.w * s.w / l2, 0.0, 1.0) * 0.82;
    }
    float floorOcc = exp(-max(p.y, 0.0) * 4.5) * clamp(0.55 - n.y * 0.6, 0.0, 1.0);
    return ao * (1.0 - 0.6 * floorOcc);
  }
`;

const furVertex = /* glsl */`
  uniform float uFurLen;
  uniform float uShells;
  uniform vec3 uComb; // object-space lean of the strand tips: gravity and combing
  uniform vec3 uSway; // world-space lean from the bear's motion
  ${AO_GLSL}
  varying vec3 vWN;
  varying vec3 vWP;
  varying vec3 vWT;
  varying vec3 vObj;
  varying vec2 vUv;
  varying float vShell;
  varying float vAO;
  void main() {
    float h = 0.0;
    #ifdef SHELLS
      h = (float(gl_InstanceID) + 1.0) / uShells;
    #endif
    vec3 wn = normalize(mat3(modelMatrix) * normal);
    vec3 lean = mat3(modelMatrix) * uComb + uSway;
    vec4 wp = modelMatrix * vec4(position + normal * (uFurLen * h), 1.0);
    wp.xyz += lean * (uFurLen * h * h);
    vAO = occlusion((modelMatrix * vec4(position, 1.0)).xyz, wn);
    vWP = wp.xyz;
    vWN = wn;
    vWT = wn + lean * (2.0 * h);
    vObj = position;
    vUv = uv;
    vShell = h;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const furFragment = /* glsl */`
  #define STRAND_CELLS ${STRAND_CELLS}.0
  #define CLUMP_R ${(1 / CLUMP_CELLS).toFixed(6)}
  uniform sampler2D uStrands;
  uniform sampler2D uClumps;
  uniform vec3 uColor;    // at the root
  uniform vec3 uTip;
  uniform vec3 uInside;
  uniform float uRoot;    // how dark the pile is deep down (1: not at all)
  uniform float uClump;   // how far strands gather into tufts towards their tips
  uniform float uSheen;
  uniform vec4 uHole;     // hood: face opening (centre x, y and radii, in direction space); off when z = 0
  uniform float uSole;    // feet: below this height the fabric is the blue shoe, with a navy pattern
  uniform vec3 uSoleColor;
  uniform vec3 uSoleInk;
  uniform vec4 uBlush;    // face: cheek centre (x, y, z mirrored in x) and radius
  uniform vec2 uTrim;     // sleeves: below this height the pile shortens, over this distance
  uniform vec4 uCarve[${MAX_CARVE}];
  ${GLSL_COMMON}
  varying vec3 vWN;
  varying vec3 vWP;
  varying vec3 vWT;
  varying vec3 vObj;
  varying vec2 vUv;
  varying float vShell;
  varying float vAO;
  void main() {
    float alpha = 1.0;
    if (uHole.z > 0.0) {
      vec3 d = normalize(vObj);
      vec2 q = (d.xy - uHole.xy) / uHole.zw;
      if (d.z > 0.0) alpha = smoothstep(1.0, 1.05, dot(q, q));
    }
    float h = vShell;
    // the tuft this point belongs to; higher up, strands lean in towards its centre
    vec4 cl = texture2D(uClumps, vUv);
    vec2 toC = (cl.rg * 2.0 - 1.0) * CLUMP_R;
    float edge = length(toC) / CLUMP_R;
    float spread = 1.0 / (1.0 - uClump * h);
    vec2 suv = vUv + toC - toC * spread;
    vec2 dx = dFdx(vUv) * spread, dy = dFdy(vUv) * spread;
    vec4 st = textureGrad(uStrands, suv, dx, dy);
    #ifdef SHELLS
      // a strand tapers from root to tip; tufts are shorter at their edges, so they round off
      float len = st.g * mix(1.0, 1.0 - 0.45 * uClump, smoothstep(0.3, 0.95, edge)) * (1.0 - 0.35 * uClump * cl.b);
      if (uTrim.y > 0.0) len *= mix(1.0, 0.25, smoothstep(uTrim.x, uTrim.x - uTrim.y, vObj.y));
      float dist = st.r * 0.75;
      float rad = 0.46 * pow(max(0.0, 1.0 - h / max(len, 0.05)), 0.6);
      // a strand thinner than a pixel is drawn a pixel wide and fainter, so it keeps its share of
      // the pixel and fine fur doesn't turn into haze
      float w = max(length(abs(dx) + abs(dy)) * STRAND_CELLS * 0.5, 0.02);
      float R = max(rad, w);
      alpha *= smoothstep(R + 0.5 * w, R - 0.5 * w, dist) * (rad * rad) / (R * R);
      // the fur gives way round the eyes, the nose and the felt patches, so it meets them cleanly
      for (int i = 0; i < ${MAX_CARVE}; i++) {
        float r = uCarve[i].w;
        alpha *= smoothstep(r, r * 1.12, length(vWP - uCarve[i].xyz));
      }
    #endif
    if (alpha < 0.02) discard;

    // strands and tufts vary a little in shade: plenty in shaggy fur, barely at all in velvet
    vec3 base = mix(uColor, uTip, smoothstep(0.15, 1.0, h));
    base *= (1.0 + (st.b - 0.5) * 0.2 * (0.3 + uClump)) * (1.0 + (cl.a - 0.5) * 0.24 * uClump);
    if (vObj.y < uSole) {
      float a = atan(vObj.z, vObj.x);
      float wave = abs(vObj.y - (uSole - 0.03 + 0.008 * sin(a * 9.0)));
      vec2 bq = vec2(fract(a * 2.2) - 0.5, (vObj.y - uSole + 0.058) * 9.0);
      float ink = max(1.0 - smoothstep(0.0025, 0.005, wave), 1.0 - smoothstep(0.03, 0.065, abs(length(bq) - 0.18)));
      base = mix(uSoleColor, uSoleInk, ink);
    }
    if (uBlush.w > 0.0) {
      vec3 c = vec3(sign(vObj.x) * uBlush.x, uBlush.y, uBlush.z);
      float b = 1.0 - smoothstep(0.0, uBlush.w, length(vObj - c));
      base = mix(base, vec3(0.97, 0.7, 0.72), 0.45 * b * b);
    }
    vec3 albedo = toLinear(gl_FrontFacing ? base : uInside);

    vec3 N = normalize(vWN);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWP);
    // deep in the pile is darker, and darker again between the tufts
    float deep = mix(uRoot, 1.0, pow(h, 1.3)) * mix(1.0, 1.0 - 0.25 * uClump, smoothstep(0.45, 0.95, edge) * (1.0 - h * h));
    float ao = vAO * deep;
    vec3 col = albedo * irradiance(N) * ao;
    // the sheen that runs along plush as light grazes its strands
    vec3 T = normalize(vWT);
    float th = dot(T, normalize(uKey + V));
    col += vec3(1.0, 0.98, 0.95) * pow(sqrt(max(0.0, 1.0 - th * th)), 40.0) * uSheen * keyLight(N) * ao * h * h;
    // fine fibres glow at the edges, lit from behind
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.5);
    col += albedo * rim * (0.16 + 0.34 * clamp(dot(N, uRim) * 0.5 + 0.5, 0.0, 1.0)) * mix(0.5, 1.0, h) * vAO;
    gl_FragColor = vec4(toSRGB(film(col)), alpha);
  }
`;

export function furFabric({
  color, tip, inside, root = 0.45, clump = 0.4, sheen = 0.2, furLen = 0.04, shells = 24, comb = [0, -0.7, 0],
  hole = null, sole = -99, soleColor = '#7f9be0', soleInk = '#1f2f66', blush = null, trim = null,
}) {
  const { strands, clumps } = furTextures();
  const uniforms = {
    ...shared,
    uStrands: { value: strands },
    uClumps: { value: clumps },
    uColor: { value: new THREE.Color(color) },
    uTip: { value: new THREE.Color(tip || color) },
    uInside: { value: new THREE.Color(inside || color) },
    uRoot: { value: root },
    uClump: { value: clump },
    uSheen: { value: sheen },
    uFurLen: { value: furLen },
    uShells: { value: shells },
    uComb: { value: new THREE.Vector3(...comb) },
    uHole: { value: new THREE.Vector4(...(hole || [0, 0, 0, 0])) },
    uSole: { value: sole },
    uSoleColor: { value: new THREE.Color(soleColor) },
    uSoleInk: { value: new THREE.Color(soleInk) },
    uBlush: { value: new THREE.Vector4(...(blush || [0, 0, 0, 0])) },
    uTrim: { value: new THREE.Vector2(...(trim || [0, 0])) },
  };
  const common = {
    uniforms,
    vertexShader: furVertex,
    fragmentShader: furFragment,
    side: hole ? THREE.DoubleSide : THREE.FrontSide,
  };
  // the skin is solid; the shells blend over it from the inside out
  return {
    uniforms,
    shells,
    furLen,
    skin: new THREE.ShaderMaterial({ ...common, alphaToCoverage: true }),
    fur: new THREE.ShaderMaterial({ ...common, defines: { SHELLS: '' }, transparent: true, depthWrite: false, forceSinglePass: true }),
  };
}

// Repeat the fur textures so strands and tufts keep one size on every part: u wraps round (a whole
// number of times, so the seam disappears), v runs along.
export function tileUv(geometry, lengthU, lengthV, tile) {
  const ru = Math.max(1, Math.round(lengthU / tile));
  const rv = Math.max(1, Math.round(lengthV / tile));
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
  uv.needsUpdate = true;
  return geometry;
}

// A furry part: the skin, with its shells as an instanced child
export function furry(geometry, fabric) {
  const mesh = new THREE.Mesh(geometry, fabric.skin);
  const fur = new THREE.InstancedMesh(geometry, fabric.fur, fabric.shells);
  fur.frustumCulled = false;
  mesh.add(fur);
  mesh.userData.fur = fur;
  return mesh;
}

const solidVertex = /* glsl */`
  ${AO_GLSL}
  varying vec3 vWN;
  varying vec3 vWP;
  varying vec3 vObj;
  varying vec2 vUv;
  varying float vAO;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWN = normalize(mat3(modelMatrix) * normal);
    vWP = wp.xyz;
    vObj = position;
    vUv = uv;
    vAO = occlusion(wp.xyz, vWN);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// Felt, thread and the nose's velvet: the same studio light, no strands
export function felt(color, { gloss = 0, sheen = 0.12, map = null } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uColor: { value: new THREE.Color(color) },
      uGloss: { value: gloss },
      uSheen: { value: sheen },
      uMap: { value: map },
      uHasMap: { value: map ? 1 : 0 },
    },
    vertexShader: solidVertex,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uGloss;
      uniform float uSheen;
      uniform sampler2D uMap;
      uniform float uHasMap;
      ${GLSL_COMMON}
      varying vec3 vWN;
      varying vec3 vWP;
      varying vec3 vObj;
      varying vec2 vUv;
      varying float vAO;
      void main() {
        vec3 base = uColor;
        if (uHasMap > 0.5) {
          vec4 t = texture2D(uMap, vUv);
          if (t.a < 0.5) discard;
          base = t.rgb;
        }
        vec3 N = normalize(vWN);
        vec3 V = normalize(cameraPosition - vWP);
        vec3 col = toLinear(base) * irradiance(N) * vAO;
        float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
        col += vec3(1.0) * rim * uSheen * vAO;
        vec3 R = reflect(-V, N);
        float s = max(dot(R, uKey), 0.0);
        col += vec3(1.0, 0.98, 0.95) * (pow(s, 90.0) * 1.6 + pow(s, 12.0) * 0.1) * uGloss;
        gl_FragColor = vec4(toSRGB(film(col)), 1.0);
      }
    `,
  });
}

// A safety eye, as sewn into real teddies: a glossy bead of mocha plastic, deeper in the middle,
// with light gathering at its lower edge and the studio's window and strip light reflected crisply
// in its dome. It looks down its local +z.
export function safetyEye({ iris = '#6f4e37' } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uIris: { value: new THREE.Color(iris) },
    },
    vertexShader: solidVertex,
    fragmentShader: /* glsl */`
      uniform vec3 uIris;
      ${GLSL_COMMON}
      varying vec3 vWN;
      varying vec3 vWP;
      varying vec3 vObj;
      varying float vAO;
      float roundBox(vec2 q, vec2 hs, float r) {
        vec2 b = abs(q) - hs + r;
        return length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - r;
      }
      // a light in the room: a rounded rectangle facing direction c, seen in direction r
      float panel(vec3 r, vec3 c, vec2 hs, float corner) {
        float f = dot(r, c);
        if (f <= 0.0) return 0.0;
        vec3 u = normalize(cross(vec3(0.0, 1.0, 0.0), c));
        vec3 v = cross(c, u);
        vec2 q = vec2(dot(r, u), dot(r, v)) / f;
        return 1.0 - smoothstep(-0.006, 0.006, roundBox(q, hs, corner));
      }
      // what the bead sees: a dim room, a window up to the left with its frame, a strip of light
      // on the right, and the white floor below
      vec3 studio(vec3 r) {
        vec3 c = vec3(0.025, 0.024, 0.022) + vec3(0.05) * smoothstep(-0.2, 0.7, r.y);
        vec3 wd = normalize(vec3(-0.5, 0.55, 0.67));
        float win = panel(r, wd, vec2(0.28, 0.21), 0.05);
        vec3 wu = normalize(cross(vec3(0.0, 1.0, 0.0), wd));
        vec3 wv = cross(wd, wu);
        vec2 q = vec2(dot(r, wu), dot(r, wv)) / max(dot(r, wd), 0.05);
        float bars = max(1.0 - smoothstep(0.007, 0.013, abs(q.x)), 1.0 - smoothstep(0.007, 0.013, abs(q.y)));
        c += vec3(1.0, 0.98, 0.95) * 7.0 * win * (1.0 - 0.9 * bars);
        c += vec3(0.9, 0.94, 1.0) * 3.5 * panel(r, normalize(vec3(0.85, 0.12, 0.5)), vec2(0.035, 0.3), 0.03);
        c += vec3(1.0, 0.99, 0.97) * 0.35 * smoothstep(-0.05, -0.4, r.y);
        return c;
      }
      void main() {
        vec3 d = normalize(vObj);
        vec3 N = normalize(vWN);
        vec3 V = normalize(cameraPosition - vWP);
        // the colour under the clear dome: deeper in the middle, glowing where the light that comes
        // through the dome gathers, at the lower edge opposite the key light
        float r = length(d.xy);
        vec3 body = toLinear(uIris) * mix(0.34, 0.85, smoothstep(0.05, 0.95, r));
        vec2 g = d.xy - vec2(0.2, -0.45);
        body *= 1.0 + 1.8 * exp(-dot(g, g) * 5.0);
        body *= mix(0.7, 1.0, vAO);
        float F = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 col = body * (1.0 - F) + studio(reflect(-V, N)) * F;
        gl_FragColor = vec4(toSRGB(film(col)), 1.0);
      }
    `,
  });
}
