// BGM をコードで作る（オリジナルの曲。外部の音源は使わないので権利の心配がない：決まったこと No.21）。
// 方針：清潔感とわかりやすさ。ヘ長調・1分あたり92拍、やわらかいピアノ・はじく音・ふんわりした伴奏・鈴。重い低音やドラムは使わない。
// 使い方：
//   場面の HTML に window.MUSIC = [{ t: 開始秒, len: 長さ秒, part: "intro" | "steps" | "problem" | "solution" | "outro" }] を書くと、
//   render.mjs が makeMusic() で曲を作ってナレーションの下に敷く。
//   実演の録画の下に敷く繰り返し用の曲：node music.mjs demo 104 out/bgm-demo.m4a
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFfmpeg } from "./ffmpeg-path.mjs";

const RATE = 44100;
const BPM = 92;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// 和音（MIDI の音の番号）。F=ヘ長調の主和音
const CH = {
  F: [53, 57, 60], Fadd9: [53, 57, 60, 67], C: [48, 52, 55], Dm: [50, 53, 57], Bb: [46, 50, 53],
  Gm: [43, 46, 50], Asus: [45, 50, 52], A: [45, 49, 52], Csus: [48, 53, 55],
};

// ---- 楽器 ----
function addNote(buf, start, dur, freq, { vol, attack = 0.005, decay = 1.0, release = 0.08, partials = [[1, 1]], detune = 0 }) {
  const s0 = Math.max(0, Math.floor(start * RATE));
  const n = Math.floor((dur + release) * RATE);
  const ph = partials.map(() => Math.random() * 0); // 位相はそろえる（毎回同じ音にする）
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / RATE;
    let env = Math.min(1, t / attack) * Math.exp(-t / decay);
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / release);
    let v = 0;
    partials.forEach(([mul, amp], k) => {
      v += Math.sin(2 * Math.PI * freq * mul * (1 + detune) * t + ph[k]) * amp;
    });
    buf[s0 + i] += v * env * vol;
  }
}
const piano = (b, t, m, vol = 0.16, dur = 1.6) =>
  addNote(b, t, dur, hz(m), { vol, decay: 1.1, release: 0.3, partials: [[1, 1], [2, 0.35], [3, 0.12], [4, 0.05]] });
const pluck = (b, t, m, vol = 0.09) =>
  addNote(b, t, 0.35, hz(m), { vol, decay: 0.22, release: 0.1, partials: [[1, 1], [2, 0.25], [4, 0.06]] });
const bell = (b, t, m, vol = 0.07) =>
  addNote(b, t, 1.8, hz(m), { vol, decay: 1.3, release: 0.4, partials: [[1, 1], [2.76, 0.18], [5.4, 0.06]] });
const bass = (b, t, m, vol = 0.07, dur = BEAT * 1.6) =>
  addNote(b, t, dur, hz(m), { vol, attack: 0.02, decay: 1.5, release: 0.2, partials: [[1, 1], [2, 0.2]] });
function pad(b, t, notes, dur, vol = 0.035) {
  for (const m of notes) {
    for (const d of [-0.003, 0.003]) {
      addNote(b, t, dur, hz(m + 12), { vol, attack: 0.9, decay: 60, release: 0.9, partials: [[1, 1], [2, 0.15]], detune: d });
    }
  }
}
// 和音を8分音符で上下にはじく（ド・ソ・ミ・ソ…の形）
function arpeggio(b, t, notes, bars, vol) {
  const [r, th, fi] = notes;
  const pattern = [r + 12, fi + 12, th + 24, fi + 12, r + 24, fi + 12, th + 24, fi + 12];
  for (let k = 0; k < 8 * bars; k++) pluck(b, t + k * (BEAT / 2), pattern[k % 8], vol * (k % 2 ? 0.75 : 1));
}

// ---- 場面ごとの曲 ----
const PARTS = {
  // 始まり：伴奏がふくらみ、ピアノの短い旋律（4音）。最後は落ち着いた主和音
  intro(b, t0, len) {
    const prog = ["Fadd9", "Bb", "Csus", "F"];
    prog.forEach((c, i) => pad(b, t0 + i * BAR, CH[c], BAR + 0.2, 0.03 + i * 0.004));
    [72, 77, 81, 79].forEach((m, i) => piano(b, t0 + 1.0 + i * BEAT, m, 0.13));
    [77, 81, 84].forEach((m) => piano(b, t0 + BAR * 3, m, 0.09, 2.6));
    bell(b, t0 + BAR * 3, 89, 0.04);
    return len;
  },
  // 背景（来店）：軽やかに歩くような、はじく音とピアノ。最後は少し「？」の残る和音（Dm）
  arrival(b, t0, len) {
    const prog = ["F", "C", "Dm"];
    const bars = Math.ceil(len / BAR);
    for (let i = 0; i < bars; i++) {
      const c = CH[prog[Math.min(i, prog.length - 1)]];
      pad(b, t0 + i * BAR, c, BAR + 0.1, 0.026);
      for (let k = 0; k < 4; k++) pluck(b, t0 + i * BAR + k * BEAT, (k % 2 ? c[2] : c[0]) + 24, 0.06);
      bass(b, t0 + i * BAR, c[0] - 12, 0.05);
    }
    [[0.5, 77], [1.5, 79], [2.5, 81], [4.5, 79]].forEach(([beat, m]) => piano(b, t0 + beat * BEAT, m, 0.09));
    return len;
  },
  // 業務の手順：規則正しくはじく音と明るい和音（F→C→Dm→B♭）
  steps(b, t0, len) {
    const prog = ["F", "C", "Dm", "Bb"];
    const bars = Math.ceil(len / BAR);
    for (let i = 0; i < bars; i++) {
      const c = CH[prog[i % 4]];
      pad(b, t0 + i * BAR, c, BAR + 0.1, 0.026);
      arpeggio(b, t0 + i * BAR, c, 1, 0.075);
      bass(b, t0 + i * BAR, c[0] - 12);
      bass(b, t0 + i * BAR + BEAT * 2, c[0] - 12, 0.05);
    }
    return len;
  },
  // 課題：少し曇った和音（Dm→B♭→Gm→A）。はじく音を抜いて音数を減らす。最後に「MODA があると」へ向けて音がふくらむ
  problem(b, t0, len) {
    const prog = ["Dm", "Bb", "Gm", "Asus"];
    const bars = Math.ceil(len / BAR);
    for (let i = 0; i < bars; i++) {
      const c = CH[prog[i % 4]];
      pad(b, t0 + i * BAR, c, BAR + 0.1, 0.03);
      piano(b, t0 + i * BAR, c[1] + 12, 0.08, 1.8);
      piano(b, t0 + i * BAR + BEAT * 2, c[2] + 12, 0.06, 1.6);
      bass(b, t0 + i * BAR, c[0] - 12, 0.05, BAR * 0.8);
    }
    // ふくらみ（最後の約1.2秒で上がっていく音）
    const rs = t0 + len - 1.3;
    for (let k = 0; k < 10; k++) pluck(b, rs + k * 0.12, 57 + k * 2, 0.04 + k * 0.006);
    pad(b, rs, CH.A, 1.4, 0.05);
    return len;
  },
  // 解決：明るい和音に戻り（B♭→C→F）、はじく音と鈴の旋律
  solution(b, t0, len) {
    const prog = ["Bb", "C", "F", "F"];
    prog.forEach((name, i) => {
      const c = CH[name];
      pad(b, t0 + i * BAR, c, BAR + 0.1, 0.03);
      arpeggio(b, t0 + i * BAR, c, 1, 0.08);
      bass(b, t0 + i * BAR, c[0] - 12);
    });
    [[0, 81], [1, 84], [2, 89], [3, 88], [4, 84], [6, 86], [8, 89]].forEach(([beat, m]) => bell(b, t0 + beat * BEAT, m, 0.05));
    return len;
  },
  // 締め：始まりの旋律をもう一度、主和音で静かに終わる
  outro(b, t0, len) {
    pad(b, t0, CH.Bb, BAR, 0.03);
    pad(b, t0 + BAR, CH.C, BAR, 0.03);
    pad(b, t0 + BAR * 2, CH.Fadd9, len - BAR * 2, 0.034);
    [72, 77, 81, 79].forEach((m, i) => piano(b, t0 + 0.8 + i * BEAT, m, 0.12));
    [65, 72, 77, 81].forEach((m) => piano(b, t0 + BAR * 2, m, 0.08, 3.5));
    bell(b, t0 + BAR * 2, 89, 0.045);
    return len;
  },
  // 実演の下に敷く：場面2の曲を小さめに（旋律なし）。小節の切れ目で終わるので繰り返しても自然
  demo(b, t0, len) {
    const prog = ["F", "C", "Dm", "Bb"];
    const bars = Math.ceil(len / BAR); // 最後まで鳴らす（途中で切れて無音にならないように。はみ出しは消える）
    for (let i = 0; i < bars; i++) {
      const c = CH[prog[i % 4]];
      pad(b, t0 + i * BAR, c, BAR + 0.1, 0.024);
      arpeggio(b, t0 + i * BAR, c, 1, 0.06);
      bass(b, t0 + i * BAR, c[0] - 12, 0.05);
    }
    return len;
  },
};

/** cues から曲を作り、WAV（モノラル）の中身を返す。場面の切れ目は0.4秒で重ねてつなぐ */
export function makeMusic(cues, duration, { fadeIn = 0.6, fadeOut = 1.2 } = {}) {
  const out = new Float32Array(Math.ceil(duration * RATE));
  for (const cue of cues) {
    const part = PARTS[cue.part];
    if (!part) throw new Error(`曲の部分「${cue.part}」はありません`);
    const tmp = new Float32Array(out.length);
    part(tmp, cue.t, cue.len);
    // 自分の区間の外は0.4秒でなめらかに消す（次の場面と重ねる）
    const a = cue.t, b = cue.t + cue.len, f = 0.4;
    for (let i = 0; i < tmp.length; i++) {
      const t = i / RATE;
      const g = t < a ? 0 : t < a + 0.05 ? (t - a) / 0.05 : t > b + f ? 0 : t > b ? 1 - (t - b) / f : 1;
      out[i] += tmp[i] * g;
    }
  }
  // 最初と最後をなめらかに
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    out[i] *= Math.min(1, t / fadeIn, Math.max(0, duration - t) / fadeOut);
  }
  // 大きさをそろえる（いちばん大きいところを 0.5 に）
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.5 / peak;
  return toWav(out);
}

function toWav(buf) {
  const b = Buffer.alloc(44 + buf.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + buf.length * 2, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
  return b;
}

// 単独で動かしたとき：node music.mjs demo 104 out/bgm-demo.m4a
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [part = "demo", secs = "104", out = "out/bgm-demo.m4a"] = process.argv.slice(2);
  const len = part === "demo" ? Math.floor(Number(secs) / BAR) * BAR : Number(secs);
  const wav = resolve(out.replace(/\.\w+$/, ".wav"));
  writeFileSync(wav, makeMusic([{ t: 0, len, part }], len));
  const r = spawnSync(findFfmpeg(), ["-y", "-loglevel", "error", "-i", wav, "-b:a", "160k", resolve(out)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  process.stdout.write(`BGM を作りました：${resolve(out)}（${len.toFixed(1)} 秒）\n`);
}
