// 場面の HTML を Edge で開き、1コマずつ撮って MP4 にする。
// 使い方：node render.mjs scenes/before-after.html out/before-after.mp4
//         node render.mjs scenes/before-after.html out/preview --stills 3,8,12.5,16,20
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makeWav } from "./sound.mjs";

const [, , sceneArg, outArg, flag, flagValue] = process.argv;
if (!sceneArg || !outArg) {
  process.stderr.write("使い方: node render.mjs <場面.html> <出力.mp4>\n");
  process.exit(1);
}
const FPS = 30;

function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  // winget で入れた FFmpeg は、PATH に入る前でも見つけられるようにする
  const winget = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet");
  const link = join(winget, "Links", "ffmpeg.exe");
  if (existsSync(link)) return link;
  const pkgs = join(winget, "Packages");
  if (existsSync(pkgs)) {
    for (const p of readdirSync(pkgs).filter((d) => d.startsWith("Gyan.FFmpeg"))) {
      for (const b of readdirSync(join(pkgs, p))) {
        const exe = join(pkgs, p, b, "bin", "ffmpeg.exe");
        if (existsSync(exe)) return exe;
      }
    }
  }
  return "ffmpeg";
}

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

const { duration, events } = await page.evaluate(() => ({ duration: window.DURATION, events: window.SOUND_EVENTS ?? [] }));
mkdirSync(dirname(resolve(outArg)), { recursive: true });
const wavPath = resolve(outArg).replace(/\.mp4$/, ".wav");
writeFileSync(wavPath, makeWav(events, duration));

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
