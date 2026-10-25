import * as THREE from 'three';

// A painted chrome sphere in the hero's palette: a pale lavender sky, a bright window, the mocha
// floor reflected in a dark band, and platinum in between. Used as a matcap, it makes any surface
// look like the liquid chrome in the reference, with no lights to compute.
export function chromeMatcap(size = 512) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const s = size;
  const c = s / 2;
  g.fillStyle = '#2e1f15';
  g.fillRect(0, 0, s, s);
  g.save();
  g.beginPath();
  g.arc(c, c, c, 0, Math.PI * 2);
  g.clip();

  // body: platinum, cooler and lavender towards the rim
  let grad = g.createRadialGradient(c * 0.85, c * 0.75, s * 0.05, c, c, c);
  grad.addColorStop(0, '#f4f2f7');
  grad.addColorStop(0.45, '#d9d4e2');
  grad.addColorStop(0.8, '#a99cbc');
  grad.addColorStop(1, '#6e5f80');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);

  // the floor: a dark mocha band below the horizon, lighter again towards the bottom
  grad = g.createLinearGradient(0, s * 0.5, 0, s);
  grad.addColorStop(0, 'rgba(75,51,36,0)');
  grad.addColorStop(0.12, 'rgba(75,51,36,0.92)');
  grad.addColorStop(0.32, 'rgba(46,31,21,0.95)');
  grad.addColorStop(0.62, 'rgba(111,78,55,0.85)');
  grad.addColorStop(1, 'rgba(196,176,160,0.9)');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(c, s * 0.86, s * 0.62, s * 0.38, 0, 0, Math.PI * 2);
  g.fill();

  // a soft horizon glow
  grad = g.createLinearGradient(0, s * 0.42, 0, s * 0.58);
  grad.addColorStop(0, 'rgba(230,224,240,0)');
  grad.addColorStop(0.5, 'rgba(236,231,246,0.75)');
  grad.addColorStop(1, 'rgba(230,224,240,0)');
  g.fillStyle = grad;
  g.fillRect(0, s * 0.42, s, s * 0.16);

  // the window: a broad soft highlight at the top left and a hard spot inside it
  grad = g.createRadialGradient(s * 0.34, s * 0.27, 0, s * 0.34, s * 0.27, s * 0.26);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  g.fillStyle = 'rgba(255,255,255,0.98)';
  g.beginPath();
  g.ellipse(s * 0.3, s * 0.24, s * 0.06, s * 0.035, -0.6, 0, Math.PI * 2);
  g.fill();

  // a second, cooler light on the right
  grad = g.createRadialGradient(s * 0.8, s * 0.42, 0, s * 0.8, s * 0.42, s * 0.16);
  grad.addColorStop(0, 'rgba(236,228,252,0.85)');
  grad.addColorStop(1, 'rgba(236,228,252,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);

  // a dark rim, as chrome picks up the room behind the viewer
  grad = g.createRadialGradient(c, c, c * 0.82, c, c, c);
  grad.addColorStop(0, 'rgba(46,31,21,0)');
  grad.addColorStop(1, 'rgba(46,31,21,0.55)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
