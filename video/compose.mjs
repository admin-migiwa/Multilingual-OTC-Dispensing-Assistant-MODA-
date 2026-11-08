// 3分の完成版をつなぐ：冒頭アニメ（out/opening.mp4）→ 実演3本（out/demo/*.mp4）→ 締め（out/ending.mp4）。
// 実演には、録画の目印（out/demo/<場面>.cues.json）に合わせたナレーションと、実演用の BGM を重ねる。
// 実演の始めには、何の場面かの小さな見出しを出す。
// 使い方：node compose.mjs → out/final.mp4
// 先に：node render.mjs scenes/opening.html out/opening.mp4、node render.mjs scenes/ending.html out/ending.mp4、
//       node record-demo.mjs main / contra / emergency（アプリを起動しておく）
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFfmpeg } from "./ffmpeg-path.mjs";
import { makeMusic } from "./music.mjs";
import { mixAudio } from "./narration.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = (p) => resolve(here, "out", p);
const ff = findFfmpeg();
const ffprobe = ff.replace(/ffmpeg(\.exe)?$/, "ffprobe$1");
const FONT = "C\\:/Windows/Fonts/YuGothB.ttc";

// 実演の場面と、目印に合わせるナレーション（{ } は少しゆっくり・少し大きく読む）。台本 docs/demo-video-script.md と同じ文
const CLIPS = [
  {
    name: "main", title: "実演：症状から相談（ベトナム語）",
    lines: [
      { cue: "start", until: "symptom", text: "患者さんは、お使いの言語を選びます。" },
      { cue: "symptom", until: "review", text: "症状は母国語で書き、質問には{1問ずつ}答えます。" },
      { cue: "review", until: "candidates", text: "薬剤師の画面で、症状を日本語に訳し、{訳し戻し}で確かめます。" },
      { cue: "candidates", until: "leaflet", text: "候補の薬は{禁忌のチェック}つき。選ぶのは薬剤師です。" },
      { cue: "leaflet", until: "approve", text: "説明書は、原文と{母国語の訳}を並べます。" },
      { cue: "approve", until: "explain", text: "手順がそろってから、{薬剤師がPINで承認}します。" },
      { cue: "explain", until: "checkout", text: "患者さんは、{わかったかどうか}を答えます。" },
      { cue: "checkout", until: "records", text: "会計の案内と評価まで、母国語で。" },
      { cue: "records", until: null, text: "販売記録は{上書きせず}、版を重ねて残します。" },
    ],
  },
  {
    name: "contra", title: "実演：禁忌を自動でチェック（英語）",
    lines: [
      { cue: "asthma", until: "contra", text: "ぜんそくがあると答えると、" },
      { cue: "contra", until: null, text: "この薬は{禁忌}と自動でチェックされ、薬剤師に知らせます。代わりの候補も、{提案}として出ます。" },
    ],
  },
  {
    name: "emergency", title: "実演：緊急の場面（中国語）",
    lines: [
      { cue: "type", until: "guide", text: "胸の痛みなど{緊急の言葉}が入ると、問診はすぐに止まります。" },
      { cue: "guide", until: null, text: "{119番の案内}は、薬剤師が確かめてから、母国語で出します。" },
    ],
  },
];

function run(args) {
  const r = spawnSync(ff, ["-y", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`FFmpeg が失敗しました：${r.stderr}`);
}
const dur = (f) => Number(spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim());

for (const f of ["opening.mp4", "ending.mp4", ...CLIPS.map((c) => `demo/${c.name}.mp4`)]) {
  if (!existsSync(out(f))) throw new Error(`${out(f)} がありません。先に作ってください（このファイルの先頭の説明）`);
}

// 1) 実演3本を1本につなぎ、見出しを入れる（音はあとで付ける）
let offset = 0;
const lines = [];
const parts = [];
for (const c of CLIPS) {
  const file = out(`demo/${c.name}.mp4`);
  const len = dur(file);
  const cues = JSON.parse(readFileSync(out(`demo/${c.name}.cues.json`), "utf8"));
  for (const l of c.lines) {
    const t = cues[l.cue];
    const end = l.until ? cues[l.until] : len;
    if (t == null || end == null) throw new Error(`${c.name} の目印「${l.cue}」がありません`);
    lines.push({ t: offset + t + 0.2, max: Math.max(1, end - t - 0.4), text: l.text });
  }
  parts.push({ file, len, title: c.title, offset });
  offset += len;
}
const demoLen = offset;
const titled = parts.map((p, i) => {
  const f = out(`demo/_titled${i}.mp4`);
  const box = `drawbox=x=40:y=36:w=iw*0.42:h=74:color=0x11a07f@0.92:t=fill:enable='lt(t,3.5)'`;
  const txt = `drawtext=fontfile='${FONT}':text='${p.title}':fontcolor=white:fontsize=38:x=66:y=54:enable='lt(t,3.5)'`;
  run(["-i", p.file, "-vf", `${box},${txt}`, "-an", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-r", "30", f]);
  return f;
});
const demoVideo = out("demo/_demo-video.mp4");
writeFileSync(out("demo/_list.txt"), titled.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
run(["-f", "concat", "-safe", "0", "-i", out("demo/_list.txt"), "-c", "copy", demoVideo]);

// 2) 実演の音：BGM（実演用）＋ナレーション
const silence = out("demo/_silence.wav");
run(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(demoLen), silence]);
const bgm = out("demo/_bgm.wav");
writeFileSync(bgm, makeMusic([{ t: 0, len: demoLen, part: "demo" }], demoLen));
const voice = JSON.parse(readFileSync(resolve(here, "scenes", "voice.json"), "utf8"));
const demoAudio = await mixAudio({ ffmpeg: ff, sfxWav: silence, bgmWav: bgm, lines, voice, outWav: out("demo/_demo-audio.wav") });
const demoFull = out("demo/_demo.mp4");
run(["-i", demoVideo, "-i", demoAudio, "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", demoFull]);

// 3) 冒頭 → 実演 → 締め
const final = out("final.mp4");
run([
  "-i", out("opening.mp4"), "-i", demoFull, "-i", out("ending.mp4"),
  "-filter_complex",
  "[0:v]fps=30,format=yuv420p,setsar=1[v0];[1:v]fps=30,format=yuv420p,setsar=1[v1];[2:v]fps=30,format=yuv420p,setsar=1[v2];" +
  "[0:a]aresample=44100[a0];[1:a]aresample=44100[a1];[2:a]aresample=44100[a2];" +
  "[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]",
  "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "160k", final,
]);
process.stdout.write(`完成版を作りました：${final}（${dur(final).toFixed(1)} 秒。実演 ${demoLen.toFixed(1)} 秒）\n`);
