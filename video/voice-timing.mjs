// 冒頭のナレーションの文（scenes/opening.lines.js）を読み上げて長さと [名前] の言葉の位置を測り、scenes/opening.voice.js に書き出す。
// opening.html はこの長さから、場面の長さと動きのタイミングを決める（隙間とずれをなくすため）。
// 使い方：node voice-timing.mjs（文を変えたら、書き出しの前に毎回実行する）
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { findFfmpeg } from "./ffmpeg-path.mjs";
import { lineTiming } from "./narration.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(resolve(here, "scenes", "opening.lines.js"), "utf8"), ctx);
const lines = ctx.window.OPENING_LINES;
const voice = JSON.parse(readFileSync(resolve(here, "scenes", "voice.json"), "utf8"));
const ff = findFfmpeg();
const dur = {};
const marks = {};
for (const [key, text] of Object.entries(lines)) {
  const r = await lineTiming(text, voice, ff);
  dur[key] = Number(r.dur.toFixed(2));
  marks[key] = r.marks;
  process.stdout.write(`${key} ${dur[key]} 秒 ${JSON.stringify(r.marks)}：${text}\n`);
}
writeFileSync(
  resolve(here, "scenes", "opening.voice.js"),
  `// node voice-timing.mjs が書き出す（手で直さない）。冒頭のナレーションの場面ごとの長さ（秒）と、[名前] の言葉の位置（読み始めからの秒）\n` +
    `window.VOICE_DUR = ${JSON.stringify(dur, null, 2)};\nwindow.VOICE_MARK = ${JSON.stringify(marks, null, 2)};\n`,
);
process.stdout.write("scenes/opening.voice.js に書き出しました\n");
