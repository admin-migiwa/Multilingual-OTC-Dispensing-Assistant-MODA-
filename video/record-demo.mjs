// 実演（実際のアプリの操作）を自動で録画する。
// アプリを本番用ビルドで起動しておき（例：pnpm --filter @moda/web start -p 3100）、
//   node record-demo.mjs main      → out/demo/main.mp4（ベトナム語・症状から相談・説明書と販売記録まで）
//   node record-demo.mjs contra    → out/demo/contra.mp4（英語・ぜんそくで禁忌）
//   node record-demo.mjs emergency → out/demo/emergency.mp4（中国語・胸の痛みで緊急）
// 画面は 16:9（1440x810 を 1920x1080 で撮る）。押した場所に丸い印を出す。問診などは早送りにする（speed）。
// 薬剤師の PIN は apps/web/.env.local の MODA_PHARMACIST_PINS から読む（画面やログには出さない）。
import { chromium } from "playwright-core";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFfmpeg } from "./ffmpeg-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.DEMO_URL || "http://localhost:3100";
const clip = process.argv[2] || "main";
const OUT = resolve(here, "out", "demo");

function pharmacistPin() {
  const env = readFileSync(resolve(here, "..", "apps", "web", ".env.local"), "utf8");
  const m = env.match(/^MODA_PHARMACIST_PINS=(.*)$/m);
  const p1 = m?.[1].split(",").map((s) => s.trim().split(":")).find(([id]) => id === "P1");
  if (!p1) throw new Error("apps/web/.env.local に MODA_PHARMACIST_PINS（P1）がありません");
  return p1[1];
}

// ---- 録画（ブラウザの画面の変化を受け取り、時刻つきで保存する） ----
class Recorder {
  constructor(page, dir) { this.page = page; this.dir = dir; this.frames = []; this.speeds = [[0, 1]]; this.current = 1; this.cues = {}; }
  async start() {
    mkdirSync(this.dir, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", async (f) => {
      // 時刻は早送りの区切りと同じ時計（このパソコンの時計）で測る
      const t = this.wall0 == null ? 0 : (Date.now() - this.wall0) / 1000;
      const file = join(this.dir, `f${String(this.frames.length).padStart(5, "0")}.jpg`);
      writeFileSync(file, Buffer.from(f.data, "base64"));
      this.frames.push({ file, t });
      await this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    this.wall0 = Date.now();
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  }
  now() { return (Date.now() - this.wall0) / 1000; }
  speed(x) { this.speeds.push([this.now(), x]); this.current = x; }
  cue(name) { (this.cues ??= {})[name] = this.now(); }
  async stop() { await this.cdp.send("Page.stopScreencast"); }
  // 実時間 → 動画の時間（早送りの区間は縮める）
  map(t) {
    let out = 0;
    for (let i = 0; i < this.speeds.length; i++) {
      const [s, x] = this.speeds[i];
      const e = this.speeds[i + 1]?.[0] ?? Infinity;
      if (t <= s) break;
      out += (Math.min(t, e) - s) / x;
    }
    return out;
  }
  build(outFile) {
    const fps = 30;
    const total = this.map(this.now());
    const list = [];
    for (let i = 0; i < this.frames.length; i++) {
      const a = this.map(this.frames[i].t);
      const b = i + 1 < this.frames.length ? this.map(this.frames[i + 1].t) : total;
      list.push(`file '${this.frames[i].file.replace(/\\/g, "/")}'`, `duration ${Math.max(0.001, b - a).toFixed(4)}`); // 早送りの区間はコマが詰まる（あとで fps でそろえる）
    }
    list.push(`file '${this.frames[this.frames.length - 1].file.replace(/\\/g, "/")}'`);
    const listFile = join(this.dir, "frames.txt");
    writeFileSync(listFile, list.join("\n"));
    const r = spawnSync(findFfmpeg(), [
      "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile,
      "-vf", `fps=${fps},scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf3faf7,format=yuv420p`,
      "-c:v", "libx264", "-crf", "18", "-preset", "medium", outFile,
    ], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`FFmpeg が失敗しました：${r.stderr}`);
    return total;
  }
}

// ---- 操作（押す場所に丸い印を出してから押す） ----
const TAP_CSS = `.__tap{position:fixed;z-index:2147483647;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;
  background:rgba(17,160,127,.35);border:3px solid rgba(17,160,127,.9);pointer-events:none;animation:__tap .6s ease-out forwards}
  @keyframes __tap{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.6);opacity:0}}`;
async function setupPage(page) {
  await page.addInitScript((css) => {
    window.__tap = (x, y) => {
      if (!document.getElementById("__tapcss")) { const s = document.createElement("style"); s.id = "__tapcss"; s.textContent = css; document.head.appendChild(s); }
      const d = document.createElement("div"); d.className = "__tap"; d.style.left = x + "px"; d.style.top = y + "px";
      document.body.appendChild(d); window.setTimeout(() => d.remove(), 700);
    };
  }, TAP_CSS);
}
function makeActions(page, rec) {
  const wait = (ms) => page.waitForTimeout(ms);
  async function tapLocator(loc, after = 900) {
    await loc.scrollIntoViewIfNeeded();
    await wait(250);
    const box = await loc.boundingBox();
    if (box) await page.evaluate(([x, y]) => window.__tap?.(x, y), [box.x + box.width / 2, box.y + box.height / 2]);
    await wait(280);
    await loc.click();
    await wait(after);
  }
  const btn = (name, exact = false) => page.getByRole("button", { name, exact }).first();
  return {
    wait,
    tap: (name, exact = false, after) => tapLocator(btn(name, exact), after),
    tapText: (text, exact = false, after) => tapLocator(page.getByText(text, { exact }).first(), after),
    tapLoc: (loc, after) => tapLocator(loc, after),
    // ✓ を付ける（ラベルの文字で探す）
    check: (label, after) => tapLocator(page.locator("label", { hasText: label }).locator("input[type=checkbox]").first(), after),
    // 折りたたみ（details）を開く
    async open(summaryText, after = 1200) {
      const s = page.locator("summary", { hasText: summaryText }).first();
      const isOpen = await s.evaluate((el) => el.parentElement?.open).catch(() => false);
      if (!isOpen) await tapLocator(s, after);
    },
    async type(selector, text, delay = 70) {
      const loc = page.locator(selector).first();
      await tapLocator(loc, 200);
      await loc.pressSequentially(text, { delay });
      await wait(400);
    },
    async scrollTo(text) { await page.getByText(text).first().scrollIntoViewIfNeeded(); await wait(700); },
    async scrollBy(y) { await page.mouse.wheel(0, y); await wait(700); },
    // AI の返事を待つ間は早送り（4倍）にして、終わったら元の速さに戻す
    async aiWait(fn) { const prev = rec.current; rec.speed(4); await fn(); rec.speed(prev); },
    // 問診：用意した答えの中から、画面にあるものを押す（なくなったら終わり）
    async answerAll(prefer, maxQ = 12) {
      for (let i = 0; i < maxQ; i++) {
        const names = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText.trim()));
        const pick = prefer.find((x) => names.includes(x));
        if (!pick) return;
        await tapLocator(btn(pick, true), 700);
      }
    },
  };
}

// ---- 場面ごとの操作 ----
// rec.cue("名前")：ナレーションを合わせる目印（動画の中の時刻を out/demo/<場面>.cues.json に残す）
// rec.speed(x)：ここから x 倍の早送り。AI の返事を待つ間（aiWait）は自動で早送りにする
const CLIPS = {
  // 本筋：ベトナム語・30歳女性・熱と頭痛を症状で相談 → 薬剤師がモダペインS錠（第1類）を選ぶ → 説明書・承認・理解の確認・会計・記録
  async main(page, rec, a) {
    const pin = pharmacistPin();
    await page.goto(BASE + "/"); await a.wait(1000);
    rec.cue("start");
    await a.tapText("Tiếng Việt", true, 600);
    rec.speed(3);
    await a.type("input", "30"); await a.tap("Tiếp theo", true);
    await a.tap("Nữ", true);
    rec.speed(1);
    await a.tap("Tìm thuốc theo triệu chứng", false, 500);
    rec.cue("symptom");
    rec.speed(1.5);
    await a.type("textarea >> nth=0", "Tôi bị sốt và đau đầu từ hôm qua.", 40);
    await a.tap("Tiếp theo", true, 600);
    rec.speed(1);
    rec.cue("questions");
    await a.wait(1200);
    rec.speed(3);
    await a.answerAll(["Không mang thai", "Không", "Không có"]);
    rec.speed(1);
    await a.wait(900);
    await a.tapText("薬剤師用：確認の画面を開く", false, 800);
    // 薬剤師：症状の原文を日本語に訳す（翻訳のチャット・訳し戻し）
    rec.cue("review");
    await a.scrollTo("患者さんの答えのまとめ");
    await a.tap("日本語に訳す", false, 400);
    await a.tap("訳す", true, 300);
    await a.aiWait(() => page.getByText("日本語の参考訳").first().waitFor({ timeout: 90000 }));
    await a.wait(2200);
    // 候補を「熱・痛み」で絞り込み、モダペインS錠を選ぶ
    rec.cue("candidates");
    await a.tapText("熱・痛み（頭痛", false, 1500);
    await a.tapLoc(page.locator("input[type=checkbox]").first(), 600);
    await a.tap("選んだ薬の項目を聞く問診に戻る（患者さんの画面へ）", false, 800);
    // 患者さん：追加の質問（お酒）
    rec.speed(3);
    await a.answerAll(["Không"]);
    await a.wait(600);
    await a.tapText("薬剤師用：確認の画面を開く", false, 800);
    rec.speed(1);
    await a.scrollTo("選んだ薬と禁忌の判定");
    await a.wait(1200);
    await a.check("販売する薬として選ぶ", 600);
    // 説明書を作る（原文・参考訳・訳し戻し）
    rec.cue("leaflet");
    await a.tap("説明書を作る", false, 300);
    await a.aiWait(() => btnWait(page, "説明書を作り直す"));
    await a.wait(1000);
    await a.open("確認用：日本語に訳し戻した文", 1800);
    // 手順 → PIN で承認
    rec.cue("approve");
    rec.speed(2);
    await a.check("書面の準備", 500);
    await a.scrollTo("承認して販売記録を作る");
    await page.locator("select").first().selectOption({ index: 1 }).catch(() => {});
    await a.type("input[type=password]", pin, 50);
    rec.speed(1);
    await a.tap("承認して販売記録を作る", false, 1500);
    rec.speed(2);
    await a.tap("説明書を印刷する", false, 800).catch(() => {});
    rec.speed(1);
    await a.tap("患者さんの画面で説明を始める", false, 1200);
    // 患者さん：説明と理解の確認
    rec.cue("explain");
    await a.wait(1200);
    await a.scrollBy(500);
    await a.tap("Tôi đã hiểu", false, 1000);
    // 会計の前の手順 → 会計案内と評価
    rec.cue("checkout");
    rec.speed(3);
    await a.open("薬剤師用：会計の前の手順と会計案内");
    await a.check("書面を渡す");
    await a.check("法定項目の記録");
    await a.tap("会計案内に進む", false, 1000);
    rec.speed(1);
    await a.tap("Dễ hiểu", false, 1500);
    // 販売記録の一覧（版の履歴）
    await page.goto(BASE + "/pharmacist/records"); await a.wait(800);
    rec.cue("records");
    await a.open("版の履歴"); await a.wait(3200);
  },
  // 禁忌：英語・ぜんそく「ある」・モダペインS錠を名前で希望（ここまでの操作は早送り）
  async contra(page, rec, a) {
    await page.goto(BASE + "/"); await a.wait(600);
    rec.speed(5);
    await a.tapText("English", true);
    await a.type("input", "30"); await a.tap("Next", true);
    await a.tap("Female", true);
    await a.tap("I know which medicine");
    await a.type("input", "モダペイン", 40);
    await a.tap("Choose this medicine");
    rec.speed(2);
    rec.cue("asthma");
    await a.answerAll(["I am not pregnant", "Yes", "None", "No"]);
    rec.speed(5);
    await a.tapText("薬剤師用：確認の画面を開く");
    rec.speed(1);
    await a.scrollTo("選んだ薬と禁忌の判定");
    rec.cue("contra");
    await a.wait(3500);
    rec.cue("alt");
    await a.tapText("代わりの薬を選ぶ", false, 800);
    await a.scrollBy(400); await a.wait(2600);
  },
  // 緊急：中国語・症状の欄に「我胸口痛」
  async emergency(page, rec, a) {
    await page.goto(BASE + "/"); await a.wait(600);
    rec.speed(5);
    await a.tapText("简体中文", true);
    await a.type("input", "40"); await a.tap("下一步", true);
    await a.tap("男性", true);
    await a.tap("根据症状找药");
    rec.speed(1.2);
    rec.cue("type");
    await a.type("textarea >> nth=0", "我胸口痛", 110);
    await a.tap("下一步", true, 2200);
    rec.cue("check");
    await a.scrollTo("薬剤師の確認：119番の案内を出しますか");
    await a.wait(1800);
    rec.cue("guide");
    await a.tap("119番の案内を出す", false, 3200);
  },
};

// ボタンが出るまで待つ（AI の返事を待つとき）
const btnWait = (page, name) => page.getByRole("button", { name }).first().waitFor({ timeout: 90000 });

const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3 });
const page = await context.newPage();
await setupPage(page);
const frameDir = join(OUT, `${clip}-frames`);
rmSync(frameDir, { recursive: true, force: true });
const rec = new Recorder(page, frameDir);
const actions = makeActions(page, rec);
await rec.start();
let failed = null;
try {
  await CLIPS[clip](page, rec, actions);
} catch (e) {
  failed = e;
  await page.screenshot({ path: join(OUT, `${clip}-stopped.png`) }).catch(() => {});
}
await page.waitForTimeout(800);
await rec.stop();
await browser.close();
mkdirSync(OUT, { recursive: true });
const outFile = join(OUT, `${clip}.mp4`);
const secs = rec.frames.length ? rec.build(outFile) : 0;
// ナレーションの目印（動画の中の時刻）
writeFileSync(join(OUT, `${clip}.cues.json`), JSON.stringify(Object.fromEntries(Object.entries(rec.cues).map(([k, t]) => [k, Number(rec.map(t).toFixed(2))])), null, 2));
if (failed) {
  process.stderr.write(`途中で止まりました（${clip}）：${failed.message.split("\n")[0]}\n止まった画面：${join(OUT, `${clip}-stopped.png`)}\n`);
  process.exit(1);
}
process.stdout.write(`録画しました：${outFile}（${secs.toFixed(1)} 秒）\n`);
