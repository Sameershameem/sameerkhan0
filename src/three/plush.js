import * as THREE from 'three';

// Plush fabric: a soft-lit "skin" plus shells of strands (drawn as one instanced mesh per part),
// so the toy's silhouette is fuzzy and its surface catches light like fur. Colours are sRGB values
// used as-is (the loader renders without colour management, so they match the page's CSS).

const HASH = /* glsl */`
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  float vnoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y),
      u.z);
  }
`;

const plushVertex = /* glsl */`
  uniform float uFurLen;
  uniform float uShells;
  uniform vec3 uDroop; // object-space pull on the strand tips (gravity, inertia)
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vObj;
  varying float vShell;
  void main() {
    float shell = 0.0;
    #ifdef SHELLS
      shell = (float(gl_InstanceID) + 1.0) / uShells;
    #endif
    vec3 p = position + normal * (uFurLen * shell) + uDroop * (shell * shell * uFurLen);
    vObj = position;
    vShell = shell;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const plushFragment = /* glsl */`
  uniform vec3 uColor;
  uniform vec3 uTip;
  uniform vec3 uSheen;
  uniform vec3 uInside;
  uniform float uSheenAmt;
  uniform float uDensity;
  uniform vec3 uKey;   // view-space light directions
  uniform vec3 uFill;
  uniform vec4 uHole;  // opening in a hood: centre (x, y) and radii in direction space; off when z = 0
  uniform float uSole; // feet: below this local height the fabric is the blue sole, with a navy pattern
  uniform vec3 uSoleColor;
  uniform vec3 uSoleInk;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vObj;
  varying float vShell;
  ${HASH}
  void main() {
    float alpha = 1.0;
    // the hood's face opening, with a soft edge so multisampling smooths it
    if (uHole.z > 0.0) {
      vec3 d = normalize(vObj);
      vec2 q = (d.xy - uHole.xy) / uHole.zw;
      float r = dot(q, q);
      if (d.z > 0.0) alpha = smoothstep(1.0, 1.06, r);
    }
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(-vView);
    float shell = vShell;
    float strand = 0.5;
    // fur grows in soft clumps: neighbouring strands share a length
    float clump = vnoise3(vObj * uDensity * 0.16);
    #ifdef SHELLS
      vec3 g = vObj * uDensity;
      vec3 cell = floor(g);
      vec3 c = hash33(cell) * 0.5 + 0.25;
      float h = hash13(cell + 7.13);
      float len = mix(0.4, 1.0, h) * mix(0.7, 1.12, clump);
      float r = length(fract(g) - c);
      float thick = 0.56 * (1.0 - shell / len);
      alpha *= smoothstep(-0.07, 0.07, thick - r);
      // strands show where the surface turns away, as a soft fluffy outline; facing the camera the
      // plush reads as smooth velvet
      alpha *= 1.0 - smoothstep(0.22, 0.5, abs(dot(N, V)));
      strand = h;
    #endif
    if (alpha < 0.02) discard;
    vec3 col = mix(uColor, uTip, 0.35 * shell);
    if (vObj.y < uSole) {
      // the sole: blue fabric with a navy wave and bubbles stitched round it
      float a = atan(vObj.z, vObj.x);
      float wave = abs(vObj.y - (uSole - 0.032 + 0.009 * sin(a * 9.0)));
      vec2 bq = vec2(fract(a * 2.2) - 0.5, (vObj.y - uSole + 0.06) * 9.0);
      float bubble = abs(length(bq) - 0.18);
      float ink = 1.0 - smoothstep(0.0025, 0.0055, wave);
      ink = max(ink, 1.0 - smoothstep(0.035, 0.07, bubble));
      col = mix(uSoleColor, uSoleInk, ink);
    }
    if (!gl_FrontFacing) col = uInside;
    // a bright, soft room: wrap lighting from the key, a little fill, light glancing off the strands
    float key = clamp((dot(N, uKey) + 0.6) / 1.6, 0.0, 1.0);
    float fill = clamp(dot(N, uFill) * 0.5 + 0.5, 0.0, 1.0);
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4);
    // the skin between strands is only a shade deeper, so the fur reads soft rather than speckled
    #ifdef SHELLS
      float occ = mix(0.95, 1.0, shell);
    #else
      float occ = 0.93;
    #endif
    vec3 lit = col * (0.72 + 0.3 * key + 0.06 * fill) * occ;
    lit *= 0.985 + 0.03 * strand + 0.05 * (clump - 0.5);
    lit += uSheen * rim * uSheenAmt;
    gl_FragColor = vec4(lit, alpha);
  }
`;

export const LIGHTS = {
  key: new THREE.Vector3(-0.45, 0.85, 0.55).normalize(),
  fill: new THREE.Vector3(0.75, 0.05, 0.45).normalize(),
};

// one set of uniforms per fabric; the key and fill directions are shared and updated per frame
const viewKey = new THREE.Vector3();
const viewFill = new THREE.Vector3();
export const lightUniforms = { uKey: { value: viewKey }, uFill: { value: viewFill } };
export function updateLights(camera) {
  viewKey.copy(LIGHTS.key).transformDirection(camera.matrixWorldInverse);
  viewFill.copy(LIGHTS.fill).transformDirection(camera.matrixWorldInverse);
}

export function plushFabric({
  color, tip, sheen = '#ffffff', sheenAmt = 0.35, inside, furLen = 0.03, density = 70,
  shells = 10, droop = [0, -0.4, 0], hole = null, sole = -99, soleColor = '#a9bde6', soleInk = '#1f2f66',
}) {
  const uniforms = {
    uColor: { value: new THREE.Color(color) },
    uTip: { value: new THREE.Color(tip || color) },
    uSheen: { value: new THREE.Color(sheen) },
    uInside: { value: new THREE.Color(inside || color) },
    uSheenAmt: { value: sheenAmt },
    uDensity: { value: density },
    uFurLen: { value: furLen },
    uShells: { value: shells },
    uDroop: { value: new THREE.Vector3(...droop) },
    uHole: { value: hole ? new THREE.Vector4(...hole) : new THREE.Vector4(0, 0, 0, 0) },
    uSole: { value: sole },
    uSoleColor: { value: new THREE.Color(soleColor) },
    uSoleInk: { value: new THREE.Color(soleInk) },
    ...lightUniforms,
  };
  const common = {
    uniforms,
    vertexShader: plushVertex,
    fragmentShader: plushFragment,
    side: hole ? THREE.DoubleSide : THREE.FrontSide,
    alphaToCoverage: true,
  };
  return {
    uniforms,
    shells,
    skin: new THREE.ShaderMaterial(common),
    fur: new THREE.ShaderMaterial({ ...common, defines: { SHELLS: '' } }),
  };
}

// A furry part: the skin mesh with its shells as an instanced child
export function furry(geometry, fabric, { shells = fabric.shells } = {}) {
  const mesh = new THREE.Mesh(geometry, fabric.skin);
  if (shells > 0) {
    const fur = new THREE.InstancedMesh(geometry, fabric.fur, shells);
    fur.frustumCulled = false;
    fur.userData.maxShells = shells;
    mesh.add(fur);
    mesh.userData.fur = fur;
  }
  return mesh;
}

// Felt, plastic and thread: no fur, the same soft light
export function felt(color, { sheenAmt = 0.15, gloss = 0 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uGloss: { value: gloss },
      uSheenAmt: { value: sheenAmt },
      ...lightUniforms,
    },
    vertexShader: /* glsl */`
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uGloss;
      uniform float uSheenAmt;
      uniform vec3 uKey;
      uniform vec3 uFill;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(-vView);
        float key = clamp((dot(N, uKey) + 0.5) / 1.5, 0.0, 1.0);
        float fill = clamp(dot(N, uFill) * 0.5 + 0.5, 0.0, 1.0);
        float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
        vec3 col = uColor * (0.42 + 0.6 * key + 0.08 * fill) + vec3(1.0) * rim * uSheenAmt;
        vec3 R = reflect(-V, N);
        col += vec3(1.0) * pow(max(dot(R, uKey), 0.0), 60.0) * uGloss;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// The bead eye: a glossy mocha iris whose fibres stay detailed however close the camera comes.
// It looks down its local +z; uPupil is the pupil's angular radius (it narrows as the camera nears).
export function beadEye({ iris = '#6F4E37' } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uIris: { value: new THREE.Color(iris) },
      uPupil: { value: 0.36 },
      uIrisR: { value: 1.05 },
      ...lightUniforms,
    },
    vertexShader: /* glsl */`
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vObj;
      void main() {
        vObj = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uIris;
      uniform float uPupil;
      uniform float uIrisR;
      uniform vec3 uKey;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vObj;
      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      // value noise that wraps round the eye (x repeats every 'period' cells), so no seam
      float vnoise(vec2 p, float period) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float x0 = mod(i.x, period), x1 = mod(i.x + 1.0, period);
        return mix(mix(hash12(vec2(x0, i.y)), hash12(vec2(x1, i.y)), u.x), mix(hash12(vec2(x0, i.y + 1.0)), hash12(vec2(x1, i.y + 1.0)), u.x), u.y);
      }
      void main() {
        vec3 d = normalize(vObj);
        float theta = acos(clamp(d.z, -1.0, 1.0));
        float phi = atan(d.y, d.x);
        // fibres run outwards from the pupil; each finer octave fades in once it is big enough
        // on screen to see, so the eye neither shimmers from afar nor goes flat up close
        float fib = 0.0, amp = 0.5, tot = 0.0;
        for (int k = 0; k < 5; k++) {
          float fq = pow(2.0, float(k));
          float period = 96.0 * fq;
          vec2 q = vec2((phi / 6.28318 + 0.5) * period, theta * 7.0 * fq);
          vec2 fw = fwidth(q);
          float vis = 1.0 - smoothstep(0.3, 0.7, min(max(fw.x, fw.y), 2.0));
          fib += amp * vis * (vnoise(q, period) - 0.5);
          tot += amp;
          amp *= 0.6;
        }
        fib /= tot;
        float t = theta / uIrisR;
        vec3 col = uIris * (1.0 + 0.9 * fib);
        col = mix(col, uIris * 1.18, 0.35 * exp(-pow((theta - uPupil * 1.7) / (uPupil * 0.6 + 0.02), 2.0)));
        col *= mix(1.0, 0.62, smoothstep(0.78, 1.0, t));
        col = mix(vec3(0.11, 0.07, 0.05), col, smoothstep(uPupil, uPupil * 1.12 + 0.004, theta));
        if (t > 1.0) col = uIris * 0.42;
        // a glossy bead: a sharp highlight and a soft reflection of the room
        vec3 N = normalize(vN);
        vec3 V = normalize(-vView);
        vec3 R = reflect(-V, N);
        float spec = pow(max(dot(R, uKey), 0.0), 220.0);
        float soft = pow(max(dot(R, uKey), 0.0), 18.0);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        col += vec3(1.0) * spec * 1.2 + vec3(1.0, 0.98, 0.96) * soft * 0.08 + vec3(0.92, 0.94, 1.0) * fres * 0.18;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
