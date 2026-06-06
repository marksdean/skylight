/** Procedural jet-pass sound for overhead alerts (no audio file needed). */

let audioCtx: AudioContext | null = null;

export function unlockOverheadAudio(): void {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") void audioCtx.resume();
}

export function playOverheadPass(): void {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") return;

  const ctx = audioCtx;
  const t0 = ctx.currentTime;
  const dur = 2.6;

  // Filtered noise whoosh.
  const samples = Math.ceil(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) {
    const p = i / samples;
    const env = Math.sin(Math.PI * p) ** 1.4;
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.setValueAtTime(920, t0);
  band.frequency.exponentialRampToValueAtTime(140, t0 + dur);
  band.Q.value = 0.65;

  const rumble = ctx.createOscillator();
  rumble.type = "sawtooth";
  rumble.frequency.setValueAtTime(95, t0);
  rumble.frequency.exponentialRampToValueAtTime(42, t0 + dur);

  const rumbleGain = ctx.createGain();
  rumbleGain.gain.setValueAtTime(0.0001, t0);
  rumbleGain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.2);
  rumbleGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(0.42, t0 + 0.12);
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  noise.connect(band);
  band.connect(master);
  rumble.connect(rumbleGain);
  rumbleGain.connect(master);
  master.connect(ctx.destination);

  noise.start(t0);
  noise.stop(t0 + dur);
  rumble.start(t0);
  rumble.stop(t0 + dur);
}
