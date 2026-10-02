// Tiny WebAudio synth: dialogue blips and UI chimes (no audio files).
let ctx: AudioContext | null = null;
let last = 0;

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

/** Typewriter blip; pitch varies by speaker line index. Rate-limited. */
export function blip(seed = 0) {
  const now = performance.now();
  if (now - last < 45) return;
  last = now;
  const a = ac();
  if (!a || a.state === 'suspended') return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'square';
  o.frequency.value = 380 + ((seed * 53) % 180);
  g.gain.value = 0.025;
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.05);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + 0.06);
}

export function chime(kind: 'ok' | 'soft' | 'bad' = 'ok') {
  const a = ac();
  if (!a) return;
  void a.resume();
  const notes = kind === 'ok' ? [660, 880] : kind === 'soft' ? [520, 660] : [300, 220];
  notes.forEach((f, i) => {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    g.gain.value = 0.05;
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.25 + i * 0.12);
    o.connect(g).connect(a.destination);
    o.start(a.currentTime + i * 0.12);
    o.stop(a.currentTime + 0.3 + i * 0.12);
  });
}

export function unlockAudio() {
  void ac()?.resume();
}

/** Quiet procedural room tone; stop every node when the room or screen changes. */
export function ambience(room: string, weather: string, music: boolean): () => void {
  const a = ac();
  if (!a) return () => {};
  const outdoor = room === 'backyard' || room.startsWith('balcony');
  const buffer = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = a.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = weather === 'rain' ? 1800 : outdoor ? 500 : 150;
  const gain = a.createGain();
  gain.gain.value = weather === 'rain' ? 0.015 : outdoor ? 0.008 : 0.003;
  noise.connect(filter).connect(gain).connect(a.destination);
  noise.start();
  const notes: OscillatorNode[] = [];
  const volumes: GainNode[] = [];
  if (music && room === 'living') for (const f of [220, 277.18, 329.63]) {
    const note = a.createOscillator();
    const volume = a.createGain();
    note.type = 'sine'; note.frequency.value = f; volume.gain.value = 0.002;
    note.connect(volume).connect(a.destination); note.start(); notes.push(note); volumes.push(volume);
  }
  return () => { noise.stop(); noise.disconnect(); filter.disconnect(); gain.disconnect(); notes.forEach((note) => { note.stop(); note.disconnect(); }); volumes.forEach((volume) => volume.disconnect()); };
}
