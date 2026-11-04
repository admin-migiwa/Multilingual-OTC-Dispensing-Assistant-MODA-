// 効果音を数式で作り、WAV（音声ファイル）にする。外部の音素材は使わない（権利の心配がない）。
const RATE = 44100;

function addTone(buf, start, { freq, freq2 = freq, len, vol = 0.3, attack = 0.005, type = "sine" }) {
  const s0 = Math.floor(start * RATE);
  const n = Math.floor(len * RATE);
  let phase = 0;
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const x = i / n;
    const f = freq + (freq2 - freq) * x;
    phase += (2 * Math.PI * f) / RATE;
    const env = Math.min(1, i / (attack * RATE)) * Math.pow(1 - x, 2);
    const w = type === "tri" ? (2 / Math.PI) * Math.asin(Math.sin(phase)) : Math.sin(phase);
    buf[s0 + i] += w * env * vol;
  }
}
function addNoise(buf, start, len, vol) {
  const s0 = Math.floor(start * RATE);
  const n = Math.floor(len * RATE);
  let seed = 7, lp = 0;
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    seed = (seed * 16807) % 2147483647;
    const r = seed / 2147483647 * 2 - 1;
    const x = i / n;
    const cut = 0.02 + 0.25 * Math.sin(x * Math.PI); // 風の音のように明るさを変える
    lp += (r - lp) * cut;
    buf[s0 + i] += lp * Math.sin(x * Math.PI) * vol;
  }
}

const SOUNDS = {
  pop: (b, t) => addTone(b, t, { freq: 520, freq2: 880, len: 0.12, vol: 0.25 }),
  tap: (b, t) => addTone(b, t, { freq: 1200, freq2: 900, len: 0.05, vol: 0.18 }),
  huh: (b, t) => { addTone(b, t, { freq: 330, freq2: 260, len: 0.25, vol: 0.22, type: "tri" }); addTone(b, t + 0.22, { freq: 260, freq2: 390, len: 0.3, vol: 0.22, type: "tri" }); },
  check: (b, t) => { addTone(b, t, { freq: 880, len: 0.25, vol: 0.18 }); addTone(b, t + 0.08, { freq: 1320, len: 0.35, vol: 0.15 }); },
  swoosh: (b, t) => addNoise(b, t, 0.7, 0.5),
  stamp: (b, t) => { addTone(b, t, { freq: 660, len: 0.5, vol: 0.16 }); addTone(b, t + 0.1, { freq: 880, len: 0.5, vol: 0.14 }); addTone(b, t + 0.2, { freq: 1320, len: 0.7, vol: 0.12 }); },
};

export function makeWav(events, duration) {
  const buf = new Float32Array(Math.ceil(duration * RATE));
  for (const e of events) SOUNDS[e.kind]?.(buf, e.t);
  const out = Buffer.alloc(44 + buf.length * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + buf.length * 2, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(RATE, 24); out.writeUInt32LE(RATE * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
  return out;
}
