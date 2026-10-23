// Generative pastoral score for the hero: a slow warm pad, a soft celesta melody, birdsong and
// a breeze through the grass. Everything is synthesised with Web Audio, so nothing is downloaded
// and it never loops. Browsers only allow sound after the visitor interacts, so start() must be
// called from a click, tap or key press.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// D major, slow and open: Dmaj9 - Bm11 - Gmaj9 - A6/9sus
const CHORDS = [
  [50, 57, 61, 64, 66],
  [47, 54, 57, 62, 64],
  [43, 50, 59, 66, 69],
  [45, 52, 59, 62, 66],
];
const CHORD_LEN = 9; // seconds per chord
const SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]; // D major pentatonic, D4 to D6
const LEVEL = 1.2;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// a soft hall: stereo noise with an exponential tail that darkens as it decays
function impulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = 0.15 + 0.8 * t; // more smoothing later in the tail
      lp += (Math.random() * 2 - 1 - lp) * (1 - k);
      d[i] = lp * Math.pow(1 - t, decay) * (i < rate * 0.02 ? i / (rate * 0.02) : 1);
    }
  }
  return buf;
}

// compressor + limiter in front of the speakers
export function masterChain(ctx) {
  const input = ctx.createGain();
  input.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.02;
  comp.release.value = 0.4;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -4;
  limit.knee.value = 0;
  limit.ratio.value = 20;
  limit.attack.value = 0.003;
  limit.release.value = 0.15;
  input.connect(comp).connect(limit).connect(ctx.destination);
  return input;
}

// Builds the score into `out`. Times passed to scheduleUntil are seconds after `start`.
export function buildScore(ctx, out, { start = ctx.currentTime, seed = 1 } = {}) {
  const rand = mulberry32(seed);
  const r = (a, b) => a + (b - a) * rand();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const at = (t) => start + t;

  /* buses */
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 3.8, 2.4);
  const reverbOut = ctx.createGain();
  reverbOut.gain.value = 0.8;
  reverb.connect(reverbOut).connect(out);

  const echo = ctx.createDelay(2);
  echo.delayTime.value = 0.43;
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = 'lowpass';
  echoTone.frequency.value = 2800;
  const echoFb = ctx.createGain();
  echoFb.gain.value = 0.34;
  echo.connect(echoTone).connect(echoFb).connect(echo);
  const echoOut = ctx.createGain();
  echoOut.gain.value = 0.45;
  echoTone.connect(echoOut);
  echoOut.connect(out);
  echoOut.connect(reverb);

  const bus = (dry, wet, echoSend = 0) => {
    const g = ctx.createGain();
    g.gain.value = dry;
    g.connect(out);
    const s = ctx.createGain();
    s.gain.value = wet;
    g.connect(s).connect(reverb);
    if (echoSend) {
      const e = ctx.createGain();
      e.gain.value = echoSend;
      g.connect(e).connect(echo);
    }
    return g;
  };
  const padBus = bus(0.55, 0.5);
  const keysBus = bus(0.6, 0.45, 0.35);
  const birdIn = ctx.createBiquadFilter();
  birdIn.type = 'highpass';
  birdIn.frequency.value = 1400;
  birdIn.connect(bus(0.5, 0.6));
  const cooBus = bus(0.28, 0.9);

  /* breeze: looping noise through slowly drifting filters */
  const noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const lfo = (freq, depth, target, phase = 0) => {
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start(at(phase));
    return o;
  };
  {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 650;
    band.Q.value = 0.6;
    lfo(0.043, 260, band.frequency);
    const gust = ctx.createGain();
    gust.gain.value = 0.05;
    lfo(0.067, 0.03, gust.gain);
    lfo(0.019, 0.015, gust.gain);
    const pan = ctx.createStereoPanner();
    lfo(0.031, 0.5, pan.pan);
    src.connect(band).connect(gust).connect(pan).connect(out);
    // grass: a quieter, airy band on top
    const hi = ctx.createBiquadFilter();
    hi.type = 'highpass';
    hi.frequency.value = 4200;
    const rustle = ctx.createGain();
    rustle.gain.value = 0.008;
    lfo(0.11, 0.006, rustle.gain);
    src.connect(hi).connect(rustle).connect(out);
    src.start(at(0));
  }

  /* pad: two detuned saws per note through a soft low-pass, swelling in and out */
  function pad(t, notes) {
    const dur = CHORD_LEN + 4;
    const level = 0.03;
    notes.forEach((n, i) => {
      const lv = level * (1 - i * 0.1); // upper voices a little softer
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at(t));
      g.gain.linearRampToValueAtTime(lv, at(t + 3.2));
      g.gain.setValueAtTime(lv, at(t + CHORD_LEN - 0.5));
      g.gain.linearRampToValueAtTime(0, at(t + dur));
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(700, at(t));
      lp.frequency.linearRampToValueAtTime(1300 + 300 * rand(), at(t + 4.5));
      lp.frequency.linearRampToValueAtTime(800, at(t + dur));
      lp.Q.value = 0.5;
      const pan = ctx.createStereoPanner();
      pan.pan.value = (i / (notes.length - 1) - 0.5) * 0.8;
      for (const det of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det + r(-3, 3);
        o.connect(lp);
        o.start(at(t));
        o.stop(at(t + dur + 0.1));
      }
      lp.connect(g).connect(pan).connect(padBus);
    });
    // warm sine root an octave down
    const root = ctx.createOscillator();
    root.frequency.value = midi(notes[0] - 12);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0, at(t));
    rg.gain.linearRampToValueAtTime(0.07, at(t + 3));
    rg.gain.setValueAtTime(0.07, at(t + CHORD_LEN - 0.5));
    rg.gain.linearRampToValueAtTime(0, at(t + dur));
    root.connect(rg).connect(padBus);
    root.start(at(t));
    root.stop(at(t + dur + 0.1));
  }

  /* celesta: a few sine partials, the higher ones dying first */
  function bell(t, n, vel) {
    const f = midi(n);
    const pan = ctx.createStereoPanner();
    pan.pan.value = r(-0.45, 0.45);
    pan.connect(keysBus);
    [[1, 1, 2.6], [2, 0.32, 1.1], [3.01, 0.12, 0.5], [4.2, 0.05, 0.3]].forEach(([mult, amp, decay]) => {
      const o = ctx.createOscillator();
      o.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at(t));
      g.gain.linearRampToValueAtTime(vel * amp, at(t + 0.006));
      g.gain.exponentialRampToValueAtTime(0.0001, at(t + decay));
      o.connect(g).connect(pan);
      o.start(at(t));
      o.stop(at(t + decay + 0.05));
    });
  }

  // a short melodic phrase that wanders the pentatonic scale around the current chord
  function phrase(t, chord) {
    let idx = SCALE.findIndex((n) => n >= chord[2] + 12);
    if (idx < 0) idx = 3;
    idx = Math.max(0, Math.min(SCALE.length - 1, idx + Math.floor(r(-2, 3))));
    const count = 3 + Math.floor(r(0, 4));
    let tt = t;
    for (let k = 0; k < count; k++) {
      bell(tt, SCALE[idx], r(0.07, 0.13) * (k === count - 1 ? 0.8 : 1));
      if (rand() < 0.18) bell(tt + 0.02, SCALE[Math.max(0, idx - 2)], 0.05);
      idx = Math.max(0, Math.min(SCALE.length - 1, idx + pick([-2, -1, -1, 1, 1, 2])));
      tt += pick([0.36, 0.48, 0.48, 0.72, 0.96]);
    }
    return tt;
  }

  /* birds */
  const birdVoice = (t, panVal) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at(t));
    const pan = ctx.createStereoPanner();
    pan.pan.value = panVal;
    o.connect(g).connect(pan).connect(birdIn);
    return { o, g };
  };

  // quick rising chirps, two to five in a row
  function chirps(t) {
    const { o, g } = birdVoice(t, r(-0.9, 0.9));
    const amp = r(0.05, 0.13);
    const base = r(2600, 4300);
    let tt = t;
    const n = 2 + Math.floor(r(0, 4));
    for (let k = 0; k < n; k++) {
      const dur = r(0.045, 0.09);
      const f0 = base * r(0.92, 1.06);
      o.frequency.setValueAtTime(f0, at(tt));
      o.frequency.exponentialRampToValueAtTime(f0 * r(1.3, 1.8), at(tt + dur));
      g.gain.setValueAtTime(0, at(tt));
      g.gain.linearRampToValueAtTime(amp, at(tt + dur * 0.3));
      g.gain.linearRampToValueAtTime(0, at(tt + dur));
      tt += dur + r(0.06, 0.15);
    }
    o.start(at(t));
    o.stop(at(tt + 0.05));
  }

  // a warbling song: quick notes of varying pitch with a fast flutter
  function song(t) {
    const { o, g } = birdVoice(t, r(-0.8, 0.8));
    const amp = r(0.04, 0.1);
    const flutter = ctx.createOscillator();
    flutter.frequency.value = r(28, 55);
    const fd = ctx.createGain();
    fd.gain.value = r(60, 260);
    flutter.connect(fd).connect(o.frequency);
    let tt = t;
    const n = 6 + Math.floor(r(0, 7));
    for (let k = 0; k < n; k++) {
      const dur = r(0.04, 0.16);
      const f0 = r(2300, 5200);
      o.frequency.setValueAtTime(f0, at(tt));
      o.frequency.exponentialRampToValueAtTime(f0 * r(0.7, 1.4), at(tt + dur));
      const a = amp * r(0.6, 1);
      g.gain.setValueAtTime(0, at(tt));
      g.gain.linearRampToValueAtTime(a, at(tt + Math.min(0.012, dur * 0.3)));
      g.gain.setValueAtTime(a, at(tt + dur * 0.7));
      g.gain.linearRampToValueAtTime(0, at(tt + dur));
      tt += dur + r(0.015, 0.07);
    }
    o.start(at(t));
    flutter.start(at(t));
    o.stop(at(tt + 0.05));
    flutter.stop(at(tt + 0.05));
  }

  // a fast trill with a slight downward glide
  function trill(t) {
    const { o, g } = birdVoice(t, r(-0.85, 0.85));
    const dur = r(0.5, 1.2);
    const f0 = r(3800, 5000);
    o.frequency.setValueAtTime(f0, at(t));
    o.frequency.linearRampToValueAtTime(f0 * r(0.82, 0.95), at(t + dur));
    const mod = ctx.createOscillator();
    mod.type = 'square';
    mod.frequency.value = r(18, 28);
    const md = ctx.createGain();
    md.gain.value = r(350, 800);
    mod.connect(md).connect(o.frequency);
    const amp = r(0.03, 0.07);
    g.gain.linearRampToValueAtTime(amp, at(t + 0.08));
    g.gain.setValueAtTime(amp, at(t + dur - 0.12));
    g.gain.linearRampToValueAtTime(0, at(t + dur));
    o.start(at(t));
    mod.start(at(t));
    o.stop(at(t + dur + 0.05));
    mod.stop(at(t + dur + 0.05));
  }

  // a distant wood pigeon: soft low "coo-COO-coo"
  function coo(t) {
    const f = r(500, 600);
    const pan = ctx.createStereoPanner();
    pan.pan.value = pick([-0.7, 0.7]) * r(0.6, 1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(pan).connect(cooBus);
    const notes = [[0, 0.32, 0.9, 1], [0.42, 0.5, 1, 1.06], [1.05, 0.3, 0.7, 0.96], [1.5, 0.3, 0.6, 0.94]];
    for (const [dt, dur, a, mult] of notes) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f * mult, at(t + dt));
      o.frequency.linearRampToValueAtTime(f * mult * 0.93, at(t + dt + dur));
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at(t + dt));
      g.gain.linearRampToValueAtTime(0.1 * a, at(t + dt + dur * 0.35));
      g.gain.linearRampToValueAtTime(0, at(t + dt + dur));
      o.connect(g).connect(lp);
      o.start(at(t + dt));
      o.stop(at(t + dt + dur + 0.05));
    }
  }

  /* scheduler: each part keeps its own next-event time */
  const next = { chord: 0, phrase: 3.5, chirp: 1.2, song: 5, trill: 11, coo: 16 };
  let chordIdx = 0;
  function scheduleUntil(t) {
    while (next.chord < t) {
      pad(next.chord, CHORDS[chordIdx % CHORDS.length]);
      chordIdx++;
      next.chord += CHORD_LEN;
    }
    while (next.phrase < t) {
      const chord = CHORDS[Math.max(0, Math.floor(next.phrase / CHORD_LEN)) % CHORDS.length];
      next.phrase = phrase(next.phrase, chord) + r(3.5, 9);
    }
    while (next.chirp < t) { chirps(next.chirp); next.chirp += r(1.6, 5.5); }
    while (next.song < t) { song(next.song); next.song += r(6, 14); }
    while (next.trill < t) { trill(next.trill); next.trill += r(10, 22); }
    while (next.coo < t) { coo(next.coo); next.coo += r(24, 45); }
  }
  return { scheduleUntil };
}

// Live player with a fade in/out; schedules a few seconds ahead while playing.
export function createMusic() {
  let ctx = null;
  let master = null;
  let score = null;
  let start = 0;
  let timer = 0;
  let on = false;
  let pausedByHidden = false;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    // play through the iPhone's silent switch, like a video would
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
    ctx = new AC({ latencyHint: 'playback' });
    master = masterChain(ctx);
    start = ctx.currentTime + 0.1;
    score = buildScore(ctx, master, { start, seed: (Math.random() * 2 ** 31) | 0 });
    return true;
  }
  const pump = () => score.scheduleUntil(ctx.currentTime - start + 3);
  const fade = (to, seconds) => {
    const g = master.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(to, now + seconds);
  };

  function play() {
    if (!ensure()) return false;
    on = true;
    const resumed = ctx.resume(); // must be called inside the click/tap handler
    pump();
    clearInterval(timer);
    timer = setInterval(pump, 500);
    fade(LEVEL, 3.5);
    return resumed;
  }
  function pause() {
    if (!ctx || !on) return;
    on = false;
    fade(0, 0.9);
    setTimeout(() => {
      if (on) return;
      clearInterval(timer);
      ctx.suspend();
    }, 1000);
  }

  // stop in the background, pick up again on return
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden && on) {
      pausedByHidden = true;
      clearInterval(timer);
      ctx.suspend();
    } else if (!document.hidden && pausedByHidden) {
      pausedByHidden = false;
      if (on) {
        ctx.resume();
        pump();
        timer = setInterval(pump, 500);
      }
    }
  });

  return {
    play,
    pause,
    get on() { return on; },
  };
}
