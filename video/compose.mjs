// 3分の完成版をつなぐ：冒頭アニメ（out/opening.mp4）→ 実演2本（out/demo/*.mp4）→ 締め（out/ending.mp4）。
// 実演のナレーションは、場面のまとまりごとにひと続きで読む（ぶつ切りにしない）。
// 録画の目印（out/demo/<場面>.cues.json）が、ナレーションの中のその言葉（[名前] の印）と同じ時刻に来るように、
// 録画の区間ごとに速さを変える（声のない待ち時間は早送り、声が長いところはゆっくり・少し止める）。
// 本筋の実演の間は、画面の右に「販売の前の5つ」を出し、その手順の場面で ✓ を付ける。
// 使い方：node compose.mjs → out/final.mp4
// 先に：node render.mjs scenes/opening.html out/opening.mp4、node render.mjs scenes/ending.html out/ending.mp4、
//       node record-demo.mjs main / emergency（アプリを起動しておく）
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFfmpeg } from "./ffmpeg-path.mjs";
import { makeMusic } from "./music.mjs";
import { lineTiming, mixAudio } from "./narration.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = (p) => resolve(here, "out", p);
const ff = findFfmpeg();
const ffprobe = ff.replace(/ffmpeg(\.exe)?$/, "ffprobe$1");
const FONT = "C\\:/Windows/Fonts/YuGothB.ttc";
const SYMBOL = "C\\:/Windows/Fonts/seguisym.ttf";
const voice = JSON.parse(readFileSync(resolve(here, "scenes", "voice.json"), "utf8"));

// 実演の場面とナレーション。cue の目印で読み始め、文の中の [名前] は同じ名前の目印に合わせる。
// { } は少しゆっくり・少し大きく、| は一呼吸。台本 docs/demo-video-script.md と同じ文
const CLIPS = [
  {
    name: "main", title: "実演：症状から相談（英語）", checklist: true,
    lines: [
      { cue: "start", text: "^まずは、患者さんの画面です。^言語を選び、[symptom]症状を{母国語で}書くと、[questions]質問が{1問ずつ}出てきます。" },
      { cue: "ulcer", text: "治療中の病気には、{胃潰瘍}と答えました。" },
      { cue: "review", text: "薬剤師の画面には、答えが日本語でまとまっています。症状は日本語に訳し、[translate]{訳し戻し}で、意味がずれていないかも確かめられます。" },
      { cue: "candidates", text: "候補の薬は、問診の答えから{禁忌を自動でチェック}します。[contra]~胃潰瘍で治療中のこの患者さんには、この薬は{禁忌}です。~|[pick]そこで薬剤師は、禁忌でない薬を選びます。" },
      { cue: "confirm", text: "選んだ薬は、患者さんも{母国語で確かめ}て、個数を選べます。" },
      { cue: "leaflet", text: "続いて、原文と{母国語の訳}を並べた説明書を作り、[approve]区分ごとの手順がそろったら、[pin]{薬剤師がPINで承認}します。" },
      { cue: "explain", text: "^承認のあとは、^患者さんが母国語の説明書を読んで、{わかったかどうか}を答え、[checkout]会計の案内と評価まで、母国語で進みます。" },
      { cue: "records", text: "販売記録は{上書きせず}、版を重ねて残るので、~あとから見直すときも安心です。~" },
    ],
    // 5つに ✓ を付ける時刻（目印からの秒。並べ替えたあとの時刻で数える）。✓ のときだけ右に出す
    checks: [["review", 0.2], ["pick", 1.2], ["explain", -0.6], ["checkout", 0.4], ["records", 1.0]],
  },
  {
    name: "emergency", title: "実演：緊急の場面（中国語）",
    lines: [
      { cue: "type", text: "^次は、中国語の患者さんです。^胸の痛みなど{緊急の言葉}が入ると、[stop]問診はすぐに止まります。|[guide]{119番の案内}は、薬剤師が根拠を確かめてから、母国語で出します。" },
    ],
  },
];
const CHECK_ITEMS = ["① 問診", "② 禁忌の確認", "③ 区分の手順", "④ 説明・理解", "⑤ 販売の記録"];

const IDLE_FAST = 1.25; // 声のない待ち時間だけ、この速さまで縮める（声の間は早送りしない。目が追えるように）
const MAX_SLOW = 1.5; // これよりゆっくりにはせず、残りは止めて待つ
const GAP = 0.6; // 文と文の間（一呼吸）
const LEAD = 0.15; // 画面の動きを、その言葉より少し先に見せる

function run(args) {
  const r = spawnSync(ff, ["-y", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`FFmpeg が失敗しました：${r.stderr}`);
}
const dur = (f) => Number(spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim());

for (const f of ["opening.mp4", "ending.mp4", ...CLIPS.map((c) => `demo/${c.name}.mp4`)]) {
  if (!existsSync(out(f))) throw new Error(`${out(f)} がありません。先に作ってください（このファイルの先頭の説明）`);
}

/**
 * 録画の区間ごとの速さを決める。返すのは区間 [録画の始め, 終わり, 並べ替えたあとの長さ] と、目印の新しい時刻、ナレーションの読み始め。
 */
async function plan(clip, cues, len) {
  const timing = {};
  for (const l of clip.lines) timing[l.cue] = await lineTiming(l.text, voice, ff);
  const anchorOf = Object.fromEntries(clip.lines.map((l) => [l.cue, l]));
  const markOwner = {};
  for (const l of clip.lines) for (const m of Object.keys(timing[l.cue].marks)) markOwner[m] = l.cue;
  const points = Object.entries(cues).sort((a, b) => a[1] - b[1]);
  for (const l of clip.lines) {
    if (cues[l.cue] == null) throw new Error(`${clip.name} の目印「${l.cue}」がありません`);
    for (const m of Object.keys(timing[l.cue].marks)) if (cues[m] == null) throw new Error(`${clip.name} の目印「${m}」がありません`);
  }
  const segs = [];
  const at = {}; // 目印の新しい時刻
  const starts = {}; // ナレーションの読み始め
  let tau = 0, prevV = 0, voiceEnd = -Infinity;
  const push = (v, d) => {
    const lv = v - prevV;
    if (lv > 0.01) { segs.push([prevV, v, Math.max(d, 0.05)]); tau += Math.max(d, 0.05); }
    prevV = v;
  };
  for (const [name, v] of points) {
    const lv = v - prevV;
    let d;
    if (markOwner[name] && starts[markOwner[name]] != null) {
      // 声の途中の言葉：その言葉の少し前に画面が来るように（早送りはせず、足りなければ止めて待つ）
      d = Math.max(lv, starts[markOwner[name]] + timing[markOwner[name]].marks[name] - LEAD - tau);
    } else if (prevV === 0 && segs.length === 0) {
      d = Math.min(lv, 1.0); // 始まりの読み込みは短く
    } else {
      // 次の文の読み始め：前の文が終わって一呼吸おくまで待つ。声のない時間だけ少し縮める
      d = Math.max(voiceEnd + GAP - tau, lv / IDLE_FAST);
    }
    push(v, d);
    at[name] = tau;
    if (anchorOf[name]) {
      // 文の中の言葉が、画面（等倍）より先に読まれないよう、読み始めを遅らせる
      let start = tau + LEAD;
      for (const [m, off] of Object.entries(timing[name].marks)) start = Math.max(start, tau + (cues[m] - v) - off + LEAD + 0.1);
      starts[name] = start;
      voiceEnd = start + timing[name].dur;
    }
  }
  push(len, Math.max(voiceEnd + 1.0 - tau, (len - prevV) / IDLE_FAST));
  const lines = clip.lines.map((l) => ({ t: starts[l.cue], max: timing[l.cue].dur + 0.5, text: l.text }));
  return { segs, at, lines, total: tau };
}

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
function checklistFilters(times) {
  const x = 1580, y0 = 170, w = 310, rowH = 62;
  const show = times.map((t) => `between(t,${(t - 0.4).toFixed(2)},${(t + 2.8).toFixed(2)})`).join("+");
  const f = [
    `drawbox=x=${x}:y=${y0}:w=${w}:h=${70 + rowH * 5}:color=white@0.95:t=fill`,
    `drawtext=fontfile='${FONT}':text='${esc("販売の前の5つ")}':fontcolor=0x334155:fontsize=26:x=${x + 22}:y=${y0 + 20}`,
  ];
  CHECK_ITEMS.forEach((label, i) => {
    const y = y0 + 64 + i * rowH, on = `gte(t,${times[i].toFixed(2)})`;
    f.push(`drawbox=x=${x + 14}:y=${y}:w=${w - 28}:h=${rowH - 10}:color=0xe2f3ee:t=fill:enable='lt(t,${times[i].toFixed(2)})'`);
    f.push(`drawbox=x=${x + 14}:y=${y}:w=${w - 28}:h=${rowH - 10}:color=0x11a07f:t=fill:enable='${on}'`);
    f.push(`drawtext=fontfile='${FONT}':text='${esc(label)}':fontcolor=0x0f5f52:fontsize=26:x=${x + 30}:y=${y + 12}:enable='lt(t,${times[i].toFixed(2)})'`);
    f.push(`drawtext=fontfile='${FONT}':text='${esc(label)}':fontcolor=white:fontsize=26:x=${x + 30}:y=${y + 12}:enable='${on}'`);
    f.push(`drawtext=fontfile='${SYMBOL}':text='✓':fontcolor=white:fontsize=34:x=${x + w - 62}:y=${y + 6}:enable='${on}'`);
  });
  // 全部を「✓ のときだけ」出す
  return f.map((x0) => (x0.includes("enable='") ? x0.replace(/enable='([^']*)'/, (_m, e) => `enable='(${e})*(${show})'`) : `${x0}:enable='${show}'`));
}

// node compose.mjs --plan：動画は作らず、速さの計画（長さと目印の時刻）だけ出す
if (process.argv.includes("--plan")) {
  for (const c of CLIPS) {
    const p = await plan(c, JSON.parse(readFileSync(out(`demo/${c.name}.cues.json`), "utf8")), dur(out(`demo/${c.name}.mp4`)));
    process.stdout.write(`${c.name}：${p.total.toFixed(1)} 秒 ${Object.entries(p.at).map(([k, v]) => `${k} ${v.toFixed(1)}`).join("・")}
`);
  }
  process.exit(0);
}

// 1) 実演の録画を、ナレーションに合わせて区間ごとに速さを変え、見出しと5項目を重ねる（音はあとで付ける）
let offset = 0;
const lines = [];
const parts = [];
for (const c of CLIPS) {
  const file = out(`demo/${c.name}.mp4`);
  const cues = JSON.parse(readFileSync(out(`demo/${c.name}.cues.json`), "utf8"));
  const p = await plan(c, cues, dur(file));
  const chains = p.segs.map(([a, b, d], i) => {
    const k = Math.min(d / (b - a), MAX_SLOW);
    const pad = Math.max(0, d - (b - a) * k);
    return `[s${i}]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=(PTS-STARTPTS)*${k.toFixed(4)},fps=30${pad > 0.02 ? `,tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}` : ""}[g${i}]`;
  });
  const over = [
    `drawbox=x=40:y=36:w=iw*0.36:h=74:color=0x11a07f@0.92:t=fill:enable='lt(t,3.5)'`,
    `drawtext=fontfile='${FONT}':text='${esc(c.title)}':fontcolor=white:fontsize=38:x=66:y=54:enable='lt(t,3.5)'`,
    ...(c.checklist ? checklistFilters(c.checks.map(([cue, dt]) => p.at[cue] + dt)) : []),
  ];
  const graph = [
    `[0:v]split=${p.segs.length}${p.segs.map((_, i) => `[s${i}]`).join("")}`,
    ...chains,
    `${p.segs.map((_, i) => `[g${i}]`).join("")}concat=n=${p.segs.length}:v=1:a=0,${over.join(",")},format=yuv420p[v]`,
  ].join(";");
  const f = out(`demo/_timed-${c.name}.mp4`);
  run(["-i", file, "-filter_complex", graph, "-map", "[v]", "-an", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-r", "30", f]);
  for (const l of p.lines) lines.push({ ...l, t: l.t + offset });
  const len = dur(f);
  parts.push(f);
  process.stdout.write(`${c.name}：録画 ${dur(file).toFixed(1)} 秒 → ${len.toFixed(1)} 秒\n`);
  offset += len;
}
const demoLen = offset;
const demoVideo = out("demo/_demo-video.mp4");
writeFileSync(out("demo/_list.txt"), parts.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
run(["-f", "concat", "-safe", "0", "-i", out("demo/_list.txt"), "-c", "copy", demoVideo]);

// 2) 実演の音：BGM（実演用）＋ナレーション
const silence = out("demo/_silence.wav");
run(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(demoLen), silence]);
const bgm = out("demo/_bgm.wav");
writeFileSync(bgm, makeMusic([{ t: 0, len: demoLen, part: "demo" }], demoLen));
const demoAudio = await mixAudio({ ffmpeg: ff, sfxWav: silence, bgmWav: bgm, lines, voice, outWav: out("demo/_demo-audio.wav") });
const demoFull = out("demo/_demo.mp4");
run(["-i", demoVideo, "-i", demoAudio, "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", demoFull]);

// 3) 冒頭 → 実演 → 締め（つなぎ目は重ねて切り替える：冒頭→実演 0.6秒、実演→締め 1.2秒）
const final = out("final.mp4");
const openLen = dur(out("opening.mp4"));
const X1 = 0.6, X2 = 1.2;
run([
  "-i", out("opening.mp4"), "-i", demoFull, "-i", out("ending.mp4"),
  "-filter_complex",
  "[0:v]fps=30,format=yuv420p,setsar=1[v0];[1:v]fps=30,format=yuv420p,setsar=1[v1];[2:v]fps=30,format=yuv420p,setsar=1[v2];" +
  `[v0][v1]xfade=transition=fade:duration=${X1}:offset=${(openLen - X1).toFixed(3)}[v01];` +
  `[v01][v2]xfade=transition=fade:duration=${X2}:offset=${(openLen - X1 + demoLen - X2).toFixed(3)}[v];` +
  "[0:a]aresample=44100[a0];[1:a]aresample=44100[a1];[2:a]aresample=44100[a2];" +
  `[a0][a1]acrossfade=d=${X1}[a01];[a01][a2]acrossfade=d=${X2}[a]`,
  "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "160k", final,
]);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
process.stdout.write(`完成版を作りました：${final}（${dur(final).toFixed(1)} 秒。冒頭 ${openLen.toFixed(1)}・実演 ${demoLen.toFixed(1)} 秒）\n`);
for (const l of lines) process.stdout.write(`  ${mmss(openLen - X1 + l.t)} ${l.text.replace(/[{}|^~]|\[[a-z0-9_]+\]/g, "").slice(0, 30)}…\n`);
