// Procedural WebAudio sound engine. Every sound is synthesized at play-time from
// oscillators + filtered white noise — no audio files, no network, no imports.
// Call sound.init() once on the first user gesture (browsers block audio until then).

let ctx = null;        // single shared AudioContext
let masterGain = null; // master volume node -> ctx.destination
let _noiseBuf = null;  // cached white-noise AudioBuffer, grown lazily

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Returns a cached white-noise buffer at least `seconds` long, growing the
// cache the first time a longer burst is requested. Created lazily (needs ctx).
function noiseBuffer(audioCtx, seconds) {
  const need = Math.ceil(seconds * audioCtx.sampleRate);
  if (_noiseBuf && _noiseBuf.length >= need) return _noiseBuf;
  const len = Math.max(need, Math.ceil(audioCtx.sampleRate * 1.5));
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  _noiseBuf = buf;
  return buf;
}

function makePanner(pan) {
  if (!pan) return null;
  const p = ctx.createStereoPanner();
  p.pan.value = clamp(pan, -1, 1);
  return p;
}

// A short oscillator note with an exponential attack/decay envelope, an
// optional frequency sweep (freqEnd) and an optional biquad filter.
function tone({
  freq = 440, type = 'sine', dur = 0.15, gain = 0.4, attack = 0.005,
  decay = null, freqEnd = null, pan = 0, delay = 0, filter = null,
} = {}) {
  if (!ctx || !masterGain) return;
  const t0 = ctx.currentTime + Math.max(delay, 0);
  const g = Math.max(gain, 0.0001);

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(freq, 1), t0);
  if (freqEnd != null && freqEnd !== freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + dur);
  }

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(g, t0 + Math.max(attack, 0.001));
  const decayEnd = t0 + Math.max(decay ?? dur, attack + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, decayEnd);

  let last = env;
  osc.connect(env);

  let filt = null;
  if (filter) {
    filt = ctx.createBiquadFilter();
    filt.type = filter.type || 'lowpass';
    filt.frequency.value = filter.freq || 1000;
    filt.Q.value = filter.q ?? 0.7;
    last.connect(filt);
    last = filt;
  }

  const panner = makePanner(pan);
  if (panner) { last.connect(panner); last = panner; }
  last.connect(masterGain);

  const stopAt = t0 + dur + 0.08;
  osc.start(t0);
  osc.stop(stopAt);
  osc.onended = () => {
    osc.disconnect(); env.disconnect();
    if (filt) filt.disconnect();
    if (panner) panner.disconnect();
  };
}

// A filtered white-noise burst with an exponential envelope. `playbackRate`
// both pitches the noise and (via pitch scaling of freq/freqEnd) is how
// `pitch` reshapes a sound's texture.
function noiseBurst({
  dur = 0.12, gain = 0.4, filterType = 'lowpass', freq = 1200, freqEnd = null,
  q = 0.7, attack = 0.003, pan = 0, delay = 0, playbackRate = 1,
} = {}) {
  if (!ctx || !masterGain) return;
  const t0 = ctx.currentTime + Math.max(delay, 0);
  const rate = clamp(playbackRate, 0.25, 4);
  const g = Math.max(gain, 0.0001);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur / rate + 0.2);
  src.playbackRate.value = rate;

  const filt = ctx.createBiquadFilter();
  filt.type = filterType;
  filt.frequency.setValueAtTime(Math.max(freq, 10), t0);
  filt.Q.value = q;
  if (freqEnd != null) filt.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 10), t0 + dur);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(g, t0 + Math.max(attack, 0.001));
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, attack + 0.02));

  src.connect(filt);
  filt.connect(env);

  let last = env;
  const panner = makePanner(pan);
  if (panner) { last.connect(panner); last = panner; }
  last.connect(masterGain);

  const stopAt = t0 + dur + 0.08;
  src.start(t0);
  src.stop(stopAt);
  src.onended = () => {
    src.disconnect(); filt.disconnect(); env.disconnect();
    if (panner) panner.disconnect();
  };
}

// --- Per-material dig/step/break "thunk" ------------------------------------

const MATERIAL = {
  stone:  { filterType: 'lowpass',  freq: 1500, q: 0.9, click: 1800 },
  wood:   { filterType: 'bandpass', freq: 500,  q: 1.1, res: 140 },
  grass:  { filterType: 'lowpass',  freq: 800,  q: 0.7 },
  dirt:   { filterType: 'lowpass',  freq: 750,  q: 0.7 },
  sand:   { filterType: 'bandpass', freq: 2000, q: 0.8 },
  gravel: { filterType: 'bandpass', freq: 1200, q: 0.5, extraNoise: true },
  glass:  { filterType: 'highpass', freq: 2500, q: 0.6, tink: 3000 },
  wool:   { filterType: 'lowpass',  freq: 400,  q: 0.5 },
};

function digSound(material, { volume = 1, pitch = 1, pan = 0, dur = 0.12, scale = 1 } = {}) {
  const m = MATERIAL[material] || MATERIAL.stone;
  noiseBurst({
    dur, gain: 0.45 * volume * scale, filterType: m.filterType,
    freq: m.freq * pitch, q: m.q, pan, playbackRate: pitch,
  });
  if (m.res) {
    tone({ freq: m.res * pitch, type: 'triangle', dur: dur * 0.9, gain: 0.3 * volume * scale, attack: 0.004, pan });
  }
  if (m.click) {
    tone({ freq: m.click * pitch, type: 'square', dur: 0.02, gain: 0.22 * volume * scale, attack: 0.001, pan });
  }
  if (m.tink) {
    tone({ freq: m.tink * pitch, type: 'sine', dur: 0.08, gain: 0.28 * volume * scale, attack: 0.002, decay: 0.07, pan });
  }
  if (m.extraNoise) {
    noiseBurst({ dur: dur * 0.7, gain: 0.28 * volume * scale, filterType: 'highpass', freq: 1000 * pitch, q: 0.4, pan, playbackRate: pitch });
  }
}

function stepSound(material, opts = {}) {
  digSound(material, { ...opts, volume: (opts.volume ?? 1) * 0.28, dur: 0.08, scale: 0.9 });
}

// --- Dispatch table: name -> builder(opts) ----------------------------------

const SOUNDS = {
  dig_stone:  (o) => digSound('stone', o),
  dig_wood:   (o) => digSound('wood', o),
  dig_grass:  (o) => digSound('grass', o),
  dig_sand:   (o) => digSound('sand', o),
  dig_gravel: (o) => digSound('gravel', o),
  dig_glass:  (o) => digSound('glass', o),
  dig_wool:   (o) => digSound('wool', o),
  dig_dirt:   (o) => digSound('dirt', o),

  step_stone: (o) => stepSound('stone', o),
  step_wood:  (o) => stepSound('wood', o),
  step_grass: (o) => stepSound('grass', o),
  step_sand:  (o) => stepSound('sand', o),

  break: ({ volume = 1, pitch = 1, pan = 0 } = {}) => {
    digSound('stone', { volume, pitch: pitch * 0.9, pan, dur: 0.18, scale: 1.3 });
    noiseBurst({ dur: 0.1, gain: 0.3 * volume, filterType: 'highpass', freq: 900 * pitch, q: 0.5, pan, delay: 0.03, playbackRate: pitch });
  },

  place: ({ volume = 1, pitch = 1, pan = 0 } = {}) => {
    tone({ freq: 200 * pitch, type: 'sine', dur: 0.09, gain: 0.5 * volume, attack: 0.003, decay: 0.09, pan });
    noiseBurst({ dur: 0.05, gain: 0.15 * volume, filterType: 'lowpass', freq: 900 * pitch, q: 0.6, pan, playbackRate: pitch });
  },

  hurt: ({ volume = 1, pitch = 1, pan = 0 } = {}) => {
    tone({ freq: 300 * pitch, freqEnd: 180 * pitch, type: 'sawtooth', dur: 0.2, gain: 0.35 * volume, attack: 0.004, filter: { type: 'lowpass', freq: 2200, q: 0.5 }, pan });
    noiseBurst({ dur: 0.15, gain: 0.2 * volume, filterType: 'bandpass', freq: 800 * pitch, q: 1, pan, playbackRate: pitch });
  },

  death: ({ volume = 1, pitch = 1, pan = 0 } = {}) => {
    tone({ freq: 260 * pitch, freqEnd: 70 * pitch, type: 'sawtooth', dur: 0.9, gain: 0.4 * volume, attack: 0.01, decay: 0.85, filter: { type: 'lowpass', freq: 1400, q: 0.5 }, pan });
    tone({ freq: 130 * pitch, freqEnd: 45 * pitch, type: 'sine', dur: 0.9, gain: 0.25 * volume, attack: 0.02, decay: 0.85, delay: 0.05, pan });
  },

  splash: ({ volume = 1, pitch = 1, pan = 0 } = {}) => {
    noiseBurst({ dur: 0.35, gain: 0.5 * volume, filterType: 'bandpass', freq: 1400 * pitch, freqEnd: 300 * pitch, q: 1.4, pan, playbackRate: pitch });
    noiseBurst({ dur: 0.15, gain: 0.2 * volume, filterType: 'highpass', freq: 2000 * pitch, pan, delay: 0.01, playbackRate: pitch });
  },

  swim: ({ volume = 1, pitch = 1, pan = 0 } = {}) => {
    noiseBurst({ dur: 0.15, gain: 0.25 * volume, filterType: 'bandpass', freq: 900 * pitch, freqEnd: 500 * pitch, q: 2, pan, playbackRate: pitch });
    tone({ freq: 500 * pitch, freqEnd: 350 * pitch, type: 'sine', dur: 0.15, gain: 0.12 * volume, attack: 0.01, pan });
  },

  pop: ({ volume = 1, pitch = 1, pan = 0 } = {}) => {
    tone({ freq: 400 * pitch, freqEnd: 900 * pitch, type: 'sine', dur: 0.08, gain: 0.4 * volume, attack: 0.003, pan });
  },

  click: ({ volume = 1, pitch = 1, pan = 0 } = {}) => {
    tone({ freq: 1000 * pitch, type: 'square', dur: 0.03, gain: 0.2 * volume, attack: 0.001, decay: 0.03, pan });
  },

  eat: ({ volume = 1, pitch = 1, pan = 0 } = {}) => {
    const bites = 3;
    for (let i = 0; i < bites; i++) {
      noiseBurst({
        dur: 0.07, gain: 0.32 * volume, filterType: 'lowpass', freq: (550 + i * 30) * pitch,
        q: 0.6, pan, delay: i * 0.085, playbackRate: pitch,
      });
      tone({ freq: 220 * pitch, type: 'triangle', dur: 0.05, gain: 0.08 * volume, attack: 0.002, delay: i * 0.085, pan });
    }
  },

  burp: ({ volume = 1, pitch = 1, pan = 0 } = {}) => {
    tone({ freq: 220 * pitch, freqEnd: 100 * pitch, type: 'sawtooth', dur: 0.25, gain: 0.28 * volume, attack: 0.01, filter: { type: 'lowpass', freq: 900, q: 0.6 }, pan });
    noiseBurst({ dur: 0.2, gain: 0.15 * volume, filterType: 'lowpass', freq: 400 * pitch, pan, delay: 0.02, playbackRate: pitch });
  },

  level: ({ volume = 1, pitch = 1, pan = 0 } = {}) => {
    [523.25, 659.25, 784.0].forEach((f, i) => {
      tone({ freq: f * pitch, type: 'sine', dur: 0.3, gain: 0.18 * volume, attack: 0.006, decay: 0.28, delay: i * 0.02, pan });
    });
  },

  fall_big: ({ volume = 1, pitch = 1, pan = 0 } = {}) => {
    noiseBurst({ dur: 0.25, gain: 0.5 * volume, filterType: 'lowpass', freq: 400 * pitch, q: 0.6, pan, playbackRate: pitch });
    tone({ freq: 90 * pitch, type: 'sine', dur: 0.25, gain: 0.4 * volume, attack: 0.005, pan });
  },

  fall_small: ({ volume = 1, pitch = 1, pan = 0 } = {}) => {
    noiseBurst({ dur: 0.15, gain: 0.3 * volume, filterType: 'lowpass', freq: 500 * pitch, q: 0.6, pan, playbackRate: pitch });
    tone({ freq: 120 * pitch, type: 'sine', dur: 0.15, gain: 0.25 * volume, attack: 0.004, pan });
  },
};

export const sound = {
  init() {
    if (ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(ctx.destination);
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch (e) {
      ctx = null;
      masterGain = null;
    }
  },

  play(name, opts = {}) {
    if (!ctx || !masterGain) return;
    const builder = SOUNDS[name];
    if (!builder) return;
    const volume = clamp(opts.volume ?? 1, 0, 4);
    const pitch = Math.max(opts.pitch ?? 1, 0.05);
    const pan = clamp(opts.pan ?? 0, -1, 1);
    try {
      builder({ volume, pitch, pan });
    } catch (e) {
      // never let a synth glitch break gameplay
    }
  },

  setMasterVolume(v) {
    if (!masterGain) return;
    masterGain.gain.value = clamp(v, 0, 1);
  },

  get ready() {
    return !!ctx && !!masterGain;
  },
};
