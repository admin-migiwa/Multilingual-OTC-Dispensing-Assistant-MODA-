// 場面の HTML を Edge で開き、1コマずつ撮って MP4 にする。
// 使い方：node render.mjs scenes/opening.html out/opening.mp4
//         node render.mjs scenes/opening.html out/preview --stills 3,8,12.5
//         node render.mjs scenes/opening.html out/opening.mp4 --no-voice（ナレーションなし）
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makeWav } from "./sound.mjs";
import { mixAudio } from "./narration.mjs";
import { makeMusic } from "./music.mjs";
import { findFfmpeg } from "./ffmpeg-path.mjs";

const [, , sceneArg, outArg, flag, flagValue] = process.argv;
if (!sceneArg || !outArg) {
  process.stderr.write("使い方: node render.mjs <場面.html> <出力.mp4>\n");
  process.exit(1);
}
const FPS = 30;


const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(resolve(sceneArg)).href);
await page.evaluate(async () => { window.__rendering = true; await document.fonts.ready; });
const canvas = page.locator("canvas");

if (flag === "--stills") {
  mkdirSync(outArg, { recursive: true });
  for (const s of flagValue.split(",")) {
    await page.evaluate((t) => window.draw(t), Number(s));
    await canvas.screenshot({ path: join(outArg, `t${s}.png`) });
  }
  await browser.close();
  process.stdout.write(`静止画を ${outArg} に保存しました\n`);
  process.exit(0);
}

const { duration, events, lines, voice, music, fade } = await page.evaluate(() => ({
  duration: window.DURATION, events: window.SOUND_EVENTS ?? [],
  lines: window.NARRATION ?? [], voice: window.NARRATION_VOICE, music: window.MUSIC ?? [], fade: window.MUSIC_FADE,
}));
mkdirSync(dirname(resolve(outArg)), { recursive: true });
const sfxPath = resolve(outArg).replace(/\.mp4$/, ".sfx.wav");
writeFileSync(sfxPath, makeWav(events, duration));
// BGM（window.MUSIC があるとき）。--no-voice を付けると、ナレーションなしで書き出す
let bgmPath = null;
if (music.length) {
  bgmPath = resolve(outArg).replace(/\.mp4$/, ".bgm.wav");
  writeFileSync(bgmPath, makeMusic(music, duration, fade ?? {}));
}
const withVoice = flag !== "--no-voice";
const wavPath = await mixAudio({
  ffmpeg: findFfmpeg(), sfxWav: sfxPath, bgmWav: bgmPath, lines: withVoice ? lines : [], voice,
  outWav: resolve(outArg).replace(/\.mp4$/, ".wav"),
});

const ff = spawn(findFfmpeg(), [
  "-y", "-loglevel", "error",
  "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
  "-i", wavPath,
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
  "-c:a", "aac", "-b:a", "160k", "-shortest",
  resolve(outArg),
], { stdio: ["pipe", "inherit", "inherit"] });

const total = Math.round(duration * FPS);
for (let i = 0; i < total; i++) {
  await page.evaluate((t) => window.draw(t), i / FPS);
  const png = await canvas.screenshot({ type: "png" });
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % FPS === 0) process.stdout.write(`\r${Math.round((i / total) * 100)}%`);
}
ff.stdin.end();
const code = await new Promise((r) => ff.on("close", r));
await browser.close();
if (code !== 0) {
  process.stderr.write(`\nFFmpeg が失敗しました（終了コード ${code}）\n`);
  process.exit(1);
}
process.stdout.write(`\n書き出しました: ${outArg}\n`);
