// 実演（実際のアプリの操作）を自動で録画する。
// アプリを本番用ビルドで起動しておき（例：pnpm --filter @moda/web start -p 3100）、
//   node record-demo.mjs main      → out/demo/main.mp4（英語・症状から相談・胃潰瘍で禁忌 → 別の薬・説明書と販売記録まで）
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
// カメラ（body を拡大・移動）、操作の吹き出し、クローズアップ（まわりを暗くして枠で囲む）。
// 吹き出しと枠は html の直下に置く（body の拡大の影響を受けないように）
const OVERLAY_CSS = `.__note{position:fixed;z-index:2147483646;max-width:520px;padding:12px 20px 12px 18px;border-radius:14px;background:#fff;
  color:#12332d;font:800 22px/1.35 "Yu Gothic UI","Hiragino Sans",sans-serif;box-shadow:0 10px 30px rgba(15,60,50,.22);border-left:8px solid #11a07f;
  opacity:0;transform:translateY(8px);transition:opacity .3s,transform .3s;pointer-events:none}
  .__note.on{opacity:1;transform:none}
  .__note.still{transition:none}
  .__note small{display:block;font-weight:700;font-size:15px;color:#4b6b64;margin-top:2px}
  .__spot{position:fixed;z-index:2147483645;border:4px solid #11a07f;border-radius:16px;box-shadow:0 0 0 4000px rgba(18,40,36,.38);
  opacity:0;transition:opacity .45s;pointer-events:none}
  .__spot.on{opacity:1}`;
async function setupPage(page) {
  await page.addInitScript((css) => {
    const cam = { z: 1, tx: 0, ty: 0 };
    const apply = (ms) => {
      const b = document.body;
      b.style.transformOrigin = "0 0";
      b.style.transition = `transform ${ms}ms cubic-bezier(.45,0,.2,1)`;
      b.style.transform = cam.z === 1 && !cam.tx && !cam.ty ? "" : `translate(${cam.tx}px,${cam.ty}px) scale(${cam.z})`;
    };
    // r：いま画面に見えている位置（拡大されたまま）。その要素が画面のまん中あたりに来るように寄る
    window.__camFocus = (r, z, ms = 900) => {
      const s = window.scrollY, W = window.innerWidth, H = window.innerHeight;
      const bx = (r.x - cam.tx) / cam.z, by = (r.y + s - cam.ty) / cam.z;
      const cx = bx + r.width / cam.z / 2, cy = by + r.height / cam.z / 2;
      const bh = Math.max(document.body.offsetHeight, H + s);
      let tx = W / 2 - z * cx, ty = H * 0.5 + s - z * cy;
      tx = Math.min(0, Math.max(W - z * W, tx));
      ty = Math.min(s, Math.max(H + s - z * bh, ty));
      Object.assign(cam, { z, tx, ty });
      apply(ms);
    };
    window.__camReset = (ms = 700) => { Object.assign(cam, { z: 1, tx: 0, ty: 0 }); apply(ms); };
    const layer = () => {
      if (!document.getElementById("__ovcss")) { const st = document.createElement("style"); st.id = "__ovcss"; st.textContent = css; document.head.appendChild(st); }
      return document.documentElement;
    };
    window.__note = (text, sub, r, still = false, below = false) => {
      window.__noteOff();
      const d = document.createElement("div"); d.className = "__note" + (still ? " still" : ""); d.id = "__note";
      d.textContent = text;
      if (sub) { const sm = document.createElement("small"); sm.textContent = sub; d.appendChild(sm); }
      layer().appendChild(d);
      const W = window.innerWidth, H = window.innerHeight, w = d.offsetWidth, h = d.offsetHeight;
      // 左の 0〜約280px は、あとから重ねる「いまの場面」に隠れるので、吹き出しはそれより右に出す
      let x = Math.min(Math.max(300, r.x + r.width / 2 - w / 2), W - w - 16);
      let y = below ? r.y + r.height + 22 : r.y - h - 22;
      if (y < 12) y = Math.min(r.y + r.height + 22, H - h - 12);
      d.style.left = x + "px"; d.style.top = y + "px";
      window.requestAnimationFrame(() => d.classList.add("on"));
    };
    window.__noteOff = () => { const d = document.getElementById("__note"); if (d) { d.id = ""; d.classList.remove("on"); window.setTimeout(() => d.remove(), 350); } };
    window.__spot = (r) => {
      window.__spotOff();
      const d = document.createElement("div"); d.className = "__spot"; d.id = "__spot";
      const p = 10;
      Object.assign(d.style, { left: r.x - p + "px", top: r.y - p + "px", width: r.width + p * 2 + "px", height: r.height + p * 2 + "px" });
      layer().appendChild(d);
      window.requestAnimationFrame(() => d.classList.add("on"));
    };
    window.__spotOff = () => { const d = document.getElementById("__spot"); if (d) { d.id = ""; d.classList.remove("on"); window.setTimeout(() => d.remove(), 500); } };
  }, OVERLAY_CSS);
  await page.addInitScript((css) => {
    window.__tap = (x, y) => {
      if (!document.getElementById("__tapcss")) { const s = document.createElement("style"); s.id = "__tapcss"; s.textContent = css; document.head.appendChild(s); }
      const d = document.createElement("div"); d.className = "__tap"; d.style.left = x + "px"; d.style.top = y + "px";
      document.documentElement.appendChild(d); window.setTimeout(() => d.remove(), 700);
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
  const rectOf = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  // その要素に寄る（画面の外なら、いったん引いてからスクロールして寄る）
  // 11/8 夜：依頼主の判断で、カーソル追従ズームはやめた（毎回寄ると、かえって見にくい）。画面全体を映し、クローズアップと吹き出しで補う
  async function focus(loc) {
    const r = await rectOf(loc);
    const H = await page.evaluate(() => window.innerHeight);
    if (r.y < 60 || r.y + r.height > H - 60) {
      await loc.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" })); await wait(800);
    }
  }
  // 操作の手本：寄る → 何をするかの吹き出し → 押す → 結果を見せる
  async function op(loc, note, { sub = null, pre = 900, after = 1500 } = {}) {
    await focus(loc);
    if (note) await page.evaluate(([t, sb, rr]) => window.__note(t, sb, rr), [note, sub, await rectOf(loc)]);
    await wait(pre);
    const box = await loc.boundingBox();
    if (box) await page.evaluate(([x, y]) => window.__tap?.(x, y), [box.x + box.width / 2, box.y + box.height / 2]);
    await wait(280);
    await loc.click();
    await wait(after);
    await page.evaluate(() => window.__noteOff());
  }
  return {
    op,
    focus,
    btn,
    // 引いて全体を見せる
    async wide(ms = 900) { await page.evaluate(() => { window.__noteOff(); window.__spotOff(); }); await wait(ms); },
    // クローズアップ：寄って、まわりを暗くして枠で囲み、説明の吹き出しを出す
    async closeup(loc, note, { sub = null, hold = 3200 } = {}) {
      await focus(loc);
      const r = await rectOf(loc);
      await page.evaluate(([rr, t, sb]) => { window.__spot(rr); if (t) window.__note(t, sb, rr); }, [r, note, sub]);
      await wait(hold);
      await page.evaluate(() => { window.__spotOff(); window.__noteOff(); });
      await wait(400);
    },
    // 吹き出しだけ出す（押さない）
    async note(loc, text, { sub = null, hold = 1800 } = {}) {
      await focus(loc);
      await page.evaluate(([t, sb, rr]) => window.__note(t, sb, rr), [text, sub, await rectOf(loc)]);
      await wait(hold);
      await page.evaluate(() => window.__noteOff());
    },
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
    // その文字が画面のまん中に来るように動かす
    async scrollCenter(text) { await page.getByText(text).first().evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" })); await wait(900); },
    async scrollTo(text) { await page.getByText(text).first().scrollIntoViewIfNeeded(); await wait(700); },
    async scrollBy(y) { await page.mouse.wheel(0, y); await wait(700); },
    // AI の返事を待つ間は早送り（4倍）にして、終わったら元の速さに戻す
    async aiWait(fn) { const prev = rec.current; rec.speed(4); await fn(); rec.speed(prev); },
    // 問診：質問の文に合う答え（rules：[正規表現, 答え, 押す前に待つミリ秒]）、なければ prefer の中から画面にあるものを押す。
    // 薬と個数の確かめの画面（✓ で始まるボタン）では、個数「1」→ ✓ を押す。押すものがなくなったら終わり
    async answerSmart(rules, prefer, gap = 900, speedForRest = null) {
      const LABELS = [
        [/pregnant/i, "妊娠しているか"], [/due date/i, "出産予定日"], [/breastfeeding/i, "授乳中か"], [/weight/i, "体重"],
        [/asthma/i, "ぜんそくがあるか"], [/treated for any illness/i, "治療中の病気"], [/allergic/i, "薬のアレルギー"],
        [/taking any medicines/i, "いま飲んでいる薬"], [/drive|driving/i, "運転の予定"], [/alcohol|drink/i, "お酒を飲む予定"],
      ];
      for (let i = 0; i < 15; i++) {
        const qh = page.locator("h1,h2,h3,legend").filter({ hasText: /[?？]/ }).last();
        const qt = (await qh.count()) ? await qh.innerText().catch(() => "") : "";
        const lab = LABELS.find(([re]) => re.test(qt));
        if (lab) { await page.evaluate(([t, rr]) => window.__note("質問：" + t, null, rr, true), [lab[1], await rectOf(qh)]).catch(() => {}); await wait(500); }
        else await page.evaluate(() => window.__noteOff()).catch(() => {});
        const names = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText.trim()));
        const ok = names.find((n) => n.startsWith("✓"));
        const off = () => page.evaluate(() => window.__noteOff()).catch(() => {});
        if (ok) { if (names.includes("1")) await tapLocator(btn("1", true), 500); await tapLocator(btn(ok, true), 250); await off(); await wait(Math.max(0, gap - 250)); continue; }
        const q = await page.evaluate(() => [...document.querySelectorAll("h1,h2,h3,legend,p")].map((e) => e.innerText.trim()).filter((t) => /[?？](\s*[(（][^)）]*[)）])?$/.test(t)).pop() || "");
        const rule = rules.find(([re, ans]) => re.test(q) && names.includes(ans));
        if (rule) {
          // rule：[質問の文, 答え, 押す前に待つミリ秒, 続けて押すボタン（複数選びの「Next」など）, 目印の名前]
          if (speedForRest) rec.speed(1);
          await wait(rule[2] ?? 0);
          if (rule[4]) rec.cue(rule[4]);
          if (rule[5]) await op(btn(rule[1], true), rule[5], { sub: rule[6] ?? null, after: 900 });
          else await tapLocator(btn(rule[1], true), rule[3] ? 900 : gap);
          await off();
          if (rule[3]) await (rule[5] ? op(btn(rule[3], true), null, { after: gap }) : tapLocator(btn(rule[3], true), gap));
          if (speedForRest) rec.speed(speedForRest);
          rules = rules.filter((r) => r !== rule);
          continue;
        }
        const pick = prefer.find((x) => names.includes(x));
        if (!pick) return;
        // 押した直後に吹き出しを消す（次の質問が出てから付け直すので、1問ずつ遅れない）
        await tapLocator(btn(pick, true), 250);
        await off();
        await wait(Math.max(0, gap - 250));
      }
    },
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
// まだ ✓ が付いていない（押せる）ものに、上から順に ✓ を付ける（区分によって手順の数が変わるため）
async function checkAll(a, scope, note = null, sub = null) {
  for (let i = 0; i < 8; i++) {
    const box = scope.locator("input[type=checkbox]:not(:checked):not(:disabled)").first();
    if (!(await box.count())) return;
    if (note) await a.op(box, note, { sub, after: 1100 });
    else await a.tapLoc(box, 700);
  }
}
// その要素の位置に、吹き出しをすぐ出す（動きなし）
async function stillNote(page, loc, text, sub = null, below = false) {
  const r = await loc.evaluate((el) => el.getBoundingClientRect().toJSON());
  await page.evaluate(([t, sb, rr, bl]) => window.__note(t, sb, rr, true, bl), [text, sub, r, below]);
}

const CLIPS = {
  // 本筋（11/8 夜版3）：英語・30歳女性・熱と頭痛を症状で相談。胃潰瘍で治療中と答える
  // → 薬剤師が日本語のまとめを見て、候補の中から患者さんに合う薬を選ぶ（モダペインS錠には禁忌が自動で示される）
  // → 患者さんが薬と個数を確かめる → 説明書・手順・PIN で承認（販売記録も同時に）→ 説明と理解の確認まで。
  // 画面全体を映し、操作は「吹き出し → 押す」、大事なところはクローズアップ。会計・評価・販売記録の一覧は見せない（11/8 依頼主の判断）。
  // 目印（cue）は compose.mjs のナレーションの言葉の位置に合わせる点
  async main(page, rec, a) {
    const pin = pharmacistPin();
    await page.goto(BASE + "/"); await a.wait(1500);
    rec.cue("intro"); // デモの患者さんの紹介（compose.mjs がカードを重ね、ナレーションのあいだ止めて待つ）
    await a.wait(800);
    rec.cue("start");
    await a.op(page.getByText("English", { exact: true }).first(), "言語を選ぶ", { sub: "9つの言語から", after: 1000 });
    rec.speed(1.6);
    await stillNote(page, page.locator("h1,h2").filter({ hasText: /old/i }).first(), "質問：年齢・性別");
    await a.type("input", "30"); await a.tap("Next", true, 500);
    await a.tap("Female", true, 600);
    await page.evaluate(() => window.__noteOff());
    rec.speed(1);
    rec.cue("symptom");
    await a.op(a.btn("Find a medicine by symptoms"), "症状から相談する", { after: 900 });
    const ta = page.locator("textarea").first();
    await stillNote(page, ta, "症状を英語で書く", "「昨日から熱と頭痛があります」");
    await ta.click();
    await ta.pressSequentially("I have had a fever and a headache since yesterday.", { delay: 45 });
    await a.wait(900);
    rec.cue("questions");
    await a.op(a.btn("Next", true), null, { pre: 300, after: 1000 });
    rec.speed(1.8);
    await a.answerSmart(
      [[/treated for any illness/i, "Stomach ulcer", 700, "Next", "ulcer", "治療中の病気：胃潰瘍を選ぶ", "選べる答えも、母国語で出る"], [/asthma/i, "No", 300]],
      ["I am not pregnant", "No", "None"], 1000, 1.8,
    );
    rec.speed(1);
    await a.wide(1000);
    await a.op(page.getByText("薬剤師用：確認の画面を開く").first(), "薬剤師の画面を開く", { after: 1300 });
    // 薬剤師：答えのまとめ（日本語）→ 症状を日本語に訳す（訳し戻し）
    await a.scrollTo("患者さんの答えのまとめ");
    rec.cue("review");
    const summary = page.locator("section").filter({ has: page.getByRole("heading", { name: "患者さんの答えのまとめ" }) }).first();
    await a.closeup(summary.getByRole("heading").first(), "答えが日本語でまとまる", { sub: "治療中の病気：胃潰瘍", hold: 2600 });
    // 症状の訳し戻しは見せない（11/8 夜 依頼主の判断：そこまで説明しなくてよい）
    await a.wide(500);
    rec.cue("candidates");
    await a.op(page.getByText("熱・痛み（頭痛").first(), "症状の分類で、お店の薬を絞り込む", { after: 1300 });
    const contraCard = page.locator("li").filter({ hasText: "モダペインS錠" }).filter({ hasText: "禁忌：胃潰瘍" }).first();
    await contraCard.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" })); await a.wait(900);
    rec.cue("contra");
    await a.closeup(contraCard, "禁忌：胃潰瘍で治療中", { sub: "問診の答えから、自動で示す", hold: 4200 });
    rec.cue("pick");
    await a.op(page.locator("label", { hasText: "モダねつさまし錠" }).locator("input[type=checkbox]").first(), "薬剤師が、この患者さんに合う薬を選ぶ", { sub: "モダねつさまし錠（第2類）", pre: 1300, after: 1300 });
    await a.op(a.btn("選んだ薬の項目を聞く問診に戻る（患者さんの画面へ）"), "患者さんの画面に戻す", { after: 1200 });
    // 患者さん：薬と個数を確かめる → 追加の質問
    rec.cue("confirm");
    await a.wait(1000);
    await a.op(a.btn("1", true), "個数を選ぶ", { after: 700 });
    await a.op(a.btn("✓ Yes, this medicine"), "患者さんが、母国語で薬を確かめる", { after: 1100 });
    rec.speed(1.8);
    await a.answerSmart([], ["No", "None"], 1000);
    await a.wide(600);
    rec.speed(1);
    await a.op(page.getByText("薬剤師用：確認の画面を開く").first(), "薬剤師の画面へ", { after: 1200 });
    // 説明書を作る（英語の参考訳・日本語の原文・訳し戻し）
    await a.scrollTo("選んだ薬と禁忌の判定");
    rec.cue("leaflet");
    await a.op(page.locator("label", { hasText: "販売する薬として選ぶ" }).locator("input[type=checkbox]").first(), "販売する薬として選ぶ", { after: 900 });
    await a.op(a.btn("説明書を作る"), "説明書を作る", { sub: "AI が原文を英語に訳す", after: 300 });
    await a.aiWait(() => btnWait(page, "説明書を作り直す"));
    await a.wait(800);
    const guide = page.locator("section").filter({ has: page.getByRole("button", { name: "説明書を作り直す" }) }).first();
    await a.closeup(guide.getByRole("heading").first(), "英語の説明書ができた", { sub: "日本語の原文と、訳し戻しも並ぶ", hold: 2600 });
    // 手順 → PIN で承認（販売記録も同時にできる）
    await a.wide(400);
    await a.scrollTo("販売手順のチェックリスト");
    rec.cue("approve");
    await checkAll(a, page.locator("section").filter({ has: page.getByRole("heading", { name: "販売手順のチェックリスト" }) }), "区分ごとの手順に ✓", "第2類：禁忌の確認");
    await a.wide(400);
    await a.scrollTo("承認して販売記録を作る");
    await page.locator("select").first().selectOption({ index: 1 }).catch(() => {});
    rec.cue("pin");
    const pw = page.locator("input[type=password]").first();
    await stillNote(page, pw, "薬剤師が PIN を入れる", "PIN は画面に出ない");
    await pw.click(); await pw.pressSequentially(pin, { delay: 90 });
    await a.wait(500);
    await a.op(a.btn("承認して販売記録を作る"), "承認する", { sub: "販売記録も、同時にできる", after: 1800 });
    await a.tap("説明書を印刷する", false, 600).catch(() => {});
    await a.op(a.btn("患者さんの画面で説明を始める"), "患者さんの画面で説明を始める", { after: 1200 });
    // 患者さん：説明と理解の確認
    rec.cue("explain");
    await a.wait(1200);
    await a.closeup(page.getByText("About your medicine").first(), "母国語の説明書", { sub: "薬剤師が説明しながら見せる", hold: 2400 });
    await a.scrollBy(500); await a.wait(800);
    rec.cue("understood");
    await a.op(a.btn("Yes, I understood"), "説明がわかったと答える", { after: 2600 });
  },
  // 緊急：中国語・症状の欄に「我胸口痛」→ 問診が止まる → 薬剤師の確認 → 119番の案内
  async emergency(page, rec, a) {
    await page.goto(BASE + "/"); await a.wait(800);
    rec.cue("intro"); // デモの患者さんの紹介（本筋と同じ）
    await a.wait(600);
    rec.speed(3);
    await a.tapText("简体中文", true);
    await a.type("input", "40"); await a.tap("下一步", true);
    await a.tap("男性", true);
    await a.tap("根据症状找药");
    rec.speed(1);
    rec.cue("type");
    const ta = page.locator("textarea").first();
    await stillNote(page, ta, "症状の欄に「我胸口痛」", "胸が痛い");
    await ta.click(); await ta.pressSequentially("我胸口痛", { delay: 220 });
    await a.wait(600);
    await a.op(a.btn("下一步", true), null, { pre: 300, after: 300 });
    rec.cue("stop");
    await a.wait(1000);
    await a.closeup(page.getByText("工作人员会马上为您提供帮助").first(), "問診がすぐに止まる", { sub: "母国語で「スタッフがすぐにお手伝いします」", hold: 3000 });
    await a.wide(400);
    await a.scrollTo("薬剤師の確認：119番の案内を出しますか");
    rec.cue("guide");
    await a.closeup(page.getByText("当てはまった緊急症状").first(), "薬剤師が根拠を確かめる", { hold: 2400 });
    await a.op(a.btn("119番の案内を出す"), "119番の案内を出す", { after: 400 });
    await a.wait(600);
    await stillNote(page, page.getByText("工作人员会马上为您提供帮助").first(), "119番の案内が、母国語で出る", null, true); // 赤い帯（119の文）に重ならないよう、下に出す
    await a.wait(5000);
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
