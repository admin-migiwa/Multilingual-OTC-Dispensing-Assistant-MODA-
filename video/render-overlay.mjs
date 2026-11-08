// 透明な背景の重ね絵（デモの患者さんのカード）を、PNG の連番にする。compose.mjs が実演の録画に重ねる。
// 使い方：node render-overlay.mjs scenes/card-main.html out/demo/card-main <動き始めの秒 T0>
//   0 秒〜T0 はまん中の大きいカード、T0 から 0.6 秒かけて左の小さいカードへ動き、そのあと 0.3 秒ぶんを書き出す
//   （compose.mjs は最後のコマを繰り返して、実演の終わりまで小さいカードを出し続ける）
import { chromium } from "playwright-core";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [, , sceneArg, outDir, t0Arg] = process.argv;
if (!sceneArg || !outDir || !t0Arg) {
  process.stderr.write("使い方: node render-overlay.mjs <card.html> <出力フォルダ> <動き始めの秒>\n");
  process.exit(1);
}
const T0 = Number(t0Arg), FPS = 30, MOVE = 0.6, TAIL = 0.3;
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(resolve(sceneArg)).href);
await page.evaluate(async () => { await document.fonts.ready; await window.CARD_IMG_READY; });
const canvas = page.locator("#c");
const frames = Math.ceil((T0 + MOVE + TAIL) * FPS);
for (let i = 0; i < frames; i++) {
  const t = i / FPS;
  const k = Math.min(1, Math.max(0, (t - T0) / MOVE));
  // eslint-disable-next-line no-undef -- GT は lib/common.js がページの中で定義する
  await page.evaluate((kk) => { GT = 0; window.drawCard(kk); }, k);
  await canvas.screenshot({ path: join(outDir, `f${String(i).padStart(4, "0")}.png`), omitBackground: true });
}
await browser.close();
process.stdout.write(`${frames} コマを ${outDir} に書き出しました\n`);
