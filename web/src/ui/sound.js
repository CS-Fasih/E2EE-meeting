// Short, quiet cues made on the fly (no audio files, nothing downloaded).

let ctx = null;

const CUES = {
  join: [
    [523.25, 0, 0.12],
    [659.25, 0.1, 0.16],
  ],
  leave: [
    [659.25, 0, 0.12],
    [493.88, 0.1, 0.18],
  ],
  knock: [
    [440, 0, 0.09],
    [440, 0.16, 0.09],
    [587.33, 0.32, 0.2],
  ],
  message: [[880, 0, 0.08]],
};

export function chime(name) {
  const notes = CUES[name];
  if (!notes) return;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.02;
    for (const [freq, at, dur] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + at);
      gain.gain.linearRampToValueAtTime(0.07, t0 + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.05);
    }
  } catch {}
}
