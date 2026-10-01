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
