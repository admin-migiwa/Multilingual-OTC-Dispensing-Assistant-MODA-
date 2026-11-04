// scenes/one-flow.html（あるとき）と scenes/parts/without.js（ないとき）を合わせて、
// 1本の通しの場面 scenes/intro.html を作る。人物・背景・立ち位置を共通にして、つなぎ目を自然にする。
// 使い方：node build-intro.mjs
import { readFileSync, writeFileSync } from "node:fs";

let s = readFileSync("scenes/one-flow.html", "utf8");
const without = readFileSync("scenes/parts/without.js", "utf8");

function rep(a, b) {
  if (!s.includes(a)) throw new Error(`置き換え元が見つかりません: ${a.slice(0, 60)}`);
  s = s.replace(a, b);
}

rep("<title>MODA がひと続きで準備する</title>", "<title>MODA 導入アニメーション</title>");
rep("const DURATION = 25;", "const T0 = 11.9;        // 「あるとき」が始まる時刻\nconst WITH_LEN = 25;\nconst DURATION = T0 + WITH_LEN;\nlet GT = 0;            // 通しの時刻（まばたき・揺れを途切れさせない）");
rep("window.SOUND_EVENTS = [", "const WITH_EVENTS = [");
// 人物の揺れ・まばたきは通しの時刻で動かす
rep("function person(t, x, y, o) {", "function person(t, x, y, o) {\n  t = GT;");
// 「あるとき」の描画を関数にする
rep("window.draw = function (t) {", "function drawWith(t) {");
rep("  endCard(t);\n", "  sceneLabel(\"MODA があるとき\", C.teal, \"#ffffff\", clamp(prog(t, 0.5, 0.4)) * (1 - prog(t, 20.6, 0.4)));\n  endCard(t);\n");
rep(
  "  const fade = Math.max(1 - prog(t, 0, 0.4), prog(t, DURATION - 0.5, 0.5));\n  if (fade > 0) { ctx.fillStyle = `rgba(11,29,31,${fade})`; ctx.fillRect(0, 0, W, H); }\n};",
  "  irisOpen(t);\n}",
);
// 人の絵に汗を足す（ないとき用）
rep("  ctx.restore();\n  ctx.restore();\n}", `  if (o.sweat > 0) {
    ctx.globalAlpha = o.sweat;
    ctx.fillStyle = "#7cc4f0";
    ctx.beginPath();
    ctx.moveTo(86, -24); ctx.quadraticCurveTo(104, 2, 94, 12); ctx.quadraticCurveTo(76, 14, 80, -4); ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.restore();
}`);

const main = `
${without}

window.SOUND_EVENTS = [...WITHOUT_EVENTS, ...WITH_EVENTS.map((e) => ({ ...e, t: e.t + T0 }))];

window.draw = function (tg) {
  GT = tg;
  ctx.clearRect(0, 0, W, H);
  if (tg < T0) {
    drawWithout(tg);
    irisClose(tg);
  } else {
    drawWith(tg - T0);
  }
  bridgeText(tg);
  const fade = Math.max(1 - prog(tg, 0, 0.4), prog(tg, DURATION - 0.5, 0.5));
  if (fade > 0) { ctx.fillStyle = \`rgba(11,29,31,\${fade})\`; ctx.fillRect(0, 0, W, H); }
};
`;
rep("window.__rendering = false;", `${main}\nwindow.__rendering = false;`);

writeFileSync("scenes/intro.html", s);
process.stdout.write("scenes/intro.html を作りました\n");
