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
    name: "main", title: "実演：症状から相談（英語）", progress: true,
    // デモの患者さん（架空）：最初にまん中のカードで紹介し、そのあとは左の「いまの場面」の上に小さく残す
    patient: { big: ["30歳・女性・英語", "昨日から熱と頭痛", "胃潰瘍で治療中"], small: ["30歳・女性", "英語を話す", "昨日から熱と頭痛", "胃潰瘍で治療中"] },
    lines: [
      { cue: "intro", text: "ここからは実演です。患者さんは、熱と頭痛があり、{胃潰瘍で治療中}の、英語を話す30歳の女性です。" },
      { cue: "start", text: "^モダがあると、^患者さんが言語を選び、{母国語の案内}にそって答えるだけで、薬剤師は必要なことをもれなく聞き取れます。" },
      { cue: "ulcer", text: "治療中の病気には、デモの設定にそって{胃潰瘍}を選びます。" },
      { cue: "review", text: "答えは、薬剤師の画面に{日本語で}まとまります。" },
      { cue: "candidates", text: "薬剤師は、このまとめをもとに、お店の薬の中から{この患者さんに合う薬}を考えます。[contra]候補には、問診の答えから{禁忌}が自動で示されるので、~この患者さんに合わないおそれのある薬も、薬剤師がすぐに確かめられます。~|[pick]症状や持病をふまえて、薬剤師が選んだのは、{モダねつさまし錠}です。" },
      { cue: "confirm", text: "選んだ薬は、患者さんも{母国語で確かめ}て、個数を選べます。" },
      { cue: "leaflet", text: "説明書はAIが{母国語に訳し}、原文と並べて確かめられます。[approve]区分ごとの手順がそろったら、[pin]{薬剤師がPINで承認}し、同時に{販売記録}も残ります。" },
      { cue: "explain", text: "最後に、患者さんは母国語の説明書を見ながら説明を聞き、[understood]{わかったかどうか}を答えます。" },
    ],
  },
  {
    name: "emergency", title: "実演：緊急の場面（中国語）",
    patient: { big: ["40歳・男性・中国語", "胸が痛い"], small: ["40歳・男性", "中国語を話す", "胸が痛い"] },
    lines: [
      { cue: "intro", text: "次は、{胸の痛み}を訴える、中国語を話す40歳の男性です。" },
      { cue: "type", text: "胸の痛みなど{緊急の言葉}が入ると、[stop]問診はすぐに止まり、患者さんには母国語で「スタッフがすぐにお手伝いします」と出ます。|[guide]{119番の案内}は、薬剤師が根拠を確かめてから出します。" },
    ],
  },
];
// 横の「いまの場面」：販売の前の5つ。いまの場面は緑、すんだ場面は ✓。[ラベル, だれが, 始まりの目印, 終わりの目印（このあと ✓）, ずらす秒]
const PROGRESS = [
  ["① 問診", "患者さん（母国語）", null, "candidates"],
  ["② 禁忌の確認", "MODA が示す → 薬剤師が判断", "candidates", "leaflet"],
  ["③ 区分の手順・承認", "薬剤師（PIN）", "leaflet", "approved"],
  ["④ 説明・理解の確認", "患者さん（母国語）", "explain", null],
  ["⑤ 販売記録", "承認と同時に残る", "approved", "explain"],
];

const IDLE_FAST = 1.9; // 声のない待ち時間だけ、この速さまで縮める（声の間は早送りしない。目が追えるように）
const MAX_SLOW = 1.5; // これよりゆっくりにはせず、残りは止めて待つ
const GAP = 0.4; // 文と文の間（一呼吸）
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
function progressFilters(at, end) {
  const x = 1920 - 22 - 352, y0 = 160, w = 352, rowH = 112; // 右の余白に出す（左はデモの患者さん）
  const T = (k) => (k === null ? null : k === "approved" ? at.pin + 3.0 : at[k]);
  const f = [
    `drawbox=x=${x}:y=${y0}:w=${w}:h=${74 + rowH * 5}:color=white@0.96:t=fill`,
    `drawtext=fontfile='${FONT}':text='${esc("販売の前の5つ ・ いまの場面")}':fontcolor=0x334155:fontsize=24:x=${x + 20}:y=${y0 + 22}`,
  ];
  PROGRESS.forEach(([label, who, from, to], i) => {
    const y = y0 + 66 + i * rowH, a = T(from) ?? 0, b = T(to) ?? end + 1;
    const cur = `between(t,${a.toFixed(2)},${b.toFixed(2)})`, done = `gt(t,${b.toFixed(2)})`, before = `lt(t,${a.toFixed(2)})`;
    const box = (color, en) => f.push(`drawbox=x=${x + 14}:y=${y}:w=${w - 28}:h=${rowH - 14}:color=${color}:t=fill:enable='${en}'`);
    const txt = (t, size, color, dy, en, font = FONT) => f.push(`drawtext=fontfile='${font}':text='${esc(t)}':fontcolor=${color}:fontsize=${size}:x=${x + 32}:y=${y + dy}:enable='${en}'`);
    box("0xf1f5f4", before); box("0x11a07f", cur); box("0xdff2ec", done);
    for (const [en, c1, c2] of [[before, "0x94a3b8", "0xa8b5bf"], [cur, "white", "0xd9f5ec"], [done, "0x0f5f52", "0x3d7a6e"]]) {
      txt(label, 28, c1, 16, en);
      txt(who, 19, c2, 58, en);
    }
    f.push(`drawtext=fontfile='${SYMBOL}':text='✓':fontcolor=0x11a07f:fontsize=40:x=${x + w - 64}:y=${y + 22}:enable='${done}'`);
  });
  return f;
}

// デモの患者さん（架空）のカード：紹介のナレーションのあいだはまん中に大きく、そのあとは左上に小さく
function patientFilters(pt, at, end) {
  const f = [];
  const on = `between(t,${(at.intro + 0.2).toFixed(2)},${(at.start ?? at.type) - 0.25})`;
  const cx = 560, cy = 300, cw = 800, ch = 130 + pt.big.length * 74;
  f.push(`drawbox=x=0:y=0:w=iw:h=ih:color=0x0f2a25@0.35:t=fill:enable='${on}'`);
  f.push(`drawbox=x=${cx}:y=${cy}:w=${cw}:h=${ch}:color=white@0.98:t=fill:enable='${on}'`);
  f.push(`drawbox=x=${cx}:y=${cy}:w=${cw}:h=12:color=0x11a07f:t=fill:enable='${on}'`);
  f.push(`drawtext=fontfile='${FONT}':text='${esc("デモの患者さん（架空）")}':fontcolor=0x11a07f:fontsize=32:x=${cx + 50}:y=${cy + 46}:enable='${on}'`);
  pt.big.forEach((line, i) => f.push(`drawtext=fontfile='${FONT}':text='${esc(line)}':fontcolor=0x12332d:fontsize=${i === 0 ? 52 : 44}:x=${cx + 50}:y=${cy + 110 + i * 74}:enable='${on}'`));
  if (pt.small) {
    const so = `between(t,${((at.start ?? at.type) - 0.1).toFixed(2)},${(end + 1).toFixed(2)})`;
    // 左の余白に、デモの患者さん（架空）をずっと出しておく
    const x = 22, y = 160, w = 352, h = 86 + pt.small.length * 56;
    f.push(`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=0xfff7e6@0.97:t=fill:enable='${so}'`);
    f.push(`drawbox=x=${x}:y=${y}:w=10:h=${h}:color=0xf0a020:t=fill:enable='${so}'`);
    f.push(`drawtext=fontfile='${FONT}':text='${esc("デモの患者さん（架空）")}':fontcolor=0x9a6400:fontsize=24:x=${x + 30}:y=${y + 24}:enable='${so}'`);
    pt.small.forEach((line, i) => f.push(`drawtext=fontfile='${FONT}':text='${esc(line)}':fontcolor=0x3b2a00:fontsize=32:x=${x + 30}:y=${y + 76 + i * 56}:enable='${so}'`));
  }
  return f;
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
    `drawbox=x=40:y=36:w=iw*0.36:h=74:color=0x11a07f@0.92:t=fill:enable='lt(t,${((p.at.start ?? p.at.type) - 0.25).toFixed(2)})'`,
    `drawtext=fontfile='${FONT}':text='${esc(c.title)}':fontcolor=white:fontsize=38:x=66:y=54:enable='lt(t,${((p.at.start ?? p.at.type) - 0.25).toFixed(2)})'`,
    ...(c.progress ? progressFilters(p.at, p.total) : []),
    ...(c.patient ? patientFilters(c.patient, p.at, p.total) : []),
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
writeFileSync(bgm, makeMusic([{ t: 0, len: demoLen, part: "demo" }], demoLen, { fadeIn: 1.0, fadeOut: 3.0 }));
const demoAudio = await mixAudio({ ffmpeg: ff, sfxWav: silence, bgmWav: bgm, lines, voice, outWav: out("demo/_demo-audio.wav") });
const demoFull = out("demo/_demo.mp4");
run(["-i", demoVideo, "-i", demoAudio, "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", demoFull]);

// 3) 冒頭 → 実演 → 締め（つなぎ目は重ねて切り替える：冒頭→実演 0.4秒、実演→締めは白を通して 1.6秒。音楽もゆっくり入れ替える）
const final = out("final.mp4");
const openLen = dur(out("opening.mp4"));
const X1 = 0.4, X2 = 1.6; // 冒頭の最後の「MODA があると」が読めるよう、冒頭→実演は短く重ねる
run([
  "-i", out("opening.mp4"), "-i", demoFull, "-i", out("ending.mp4"),
  "-filter_complex",
  "[0:v]fps=30,format=yuv420p,setsar=1[v0];[1:v]fps=30,format=yuv420p,setsar=1[v1];[2:v]fps=30,format=yuv420p,setsar=1[v2];" +
  `[v0][v1]xfade=transition=fade:duration=${X1}:offset=${(openLen - X1).toFixed(3)}[v01];` +
  `[v01][v2]xfade=transition=fadewhite:duration=${X2}:offset=${(openLen - X1 + demoLen - X2).toFixed(3)}[v];` +
  "[0:a]aresample=44100[a0];[1:a]aresample=44100[a1];[2:a]aresample=44100[a2];" +
  `[a0][a1]acrossfade=d=${X1}[a01];[a01][a2]acrossfade=d=${X2}[a]`,
  "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "160k", final,
]);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
process.stdout.write(`完成版を作りました：${final}（${dur(final).toFixed(1)} 秒。冒頭 ${openLen.toFixed(1)}・実演 ${demoLen.toFixed(1)} 秒）\n`);
for (const l of lines) process.stdout.write(`  ${mmss(openLen - X1 + l.t)} ${l.text.replace(/[{}|^~]|\[[a-z0-9_]+\]/g, "").slice(0, 30)}…\n`);
