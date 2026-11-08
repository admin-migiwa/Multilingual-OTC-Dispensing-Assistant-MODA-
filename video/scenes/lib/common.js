/*
 * 場面に共通の部品：画面の大きさ・色・動きの補助・人の絵・吹き出し・字幕・札。
 * 各場面の HTML から <script src="lib/common.js"> で読み込む。
 * 時刻は2種類ある：GT＝動画全体の時刻（まばたき・揺れ用）、各場面の関数に渡す t＝その場面の中の時刻。
 */
const W = 1920, H = 1080;
const ctx = document.getElementById("c").getContext("2d");
const FONT = '"Segoe UI", "Yu Gothic UI", "Yu Gothic", "Meiryo", sans-serif';
let GT = 0;
// ナレーションの声（実演の部分は scenes/voice.json を使う。変えるときは両方そろえる）。engine で使う方を選ぶ（環境変数 VOICE_ENGINE で一時的に切り替えられる）
//   azure：Azure AI Speech のニューラル音声。rate・pitch は「+5%」のような書き方
//   windows：Windows に入っている声。pitch：0〜2、rate：0.5〜6（どちらも1が標準）
window.NARRATION_VOICE = {
  engine: "azure",
  // 声は Mayu（Naoki 高めにするなら name を "ja-JP-NaokiNeural"、pitch を "+4%" に）。
  // pause：文の間（ミリ秒）／ {…} の言葉は少しゆっくり・高め・emphasisGainDb だけ大きく／
  // wobble：句ごとの速さ・高さの小さなずれ（%）／ drift：声の大きさのゆっくりした波
  azure: {
    name: "ja-JP-MayuNeural", rate: "+8%", pitch: "+0%", pause: 180,
    emphasisPitch: "+5%", emphasisGainDb: 4, wobble: { rate: 4, pitch: 3 }, drift: true,
  },
  windows: { voice: "Ayumi", pitch: 0.85, rate: 1.4 },
};

// 配色：薬局・ドラッグストアらしい清潔感（白＋ミントグリーン、文字は濃い紺）。11/6 の依頼で暗い色をやめた
const C = {
  wall: "#f3faf7", wallGray: "#f2f4f6", counter: "#ffffff", counterTop: "#bfe6d8",
  ink: "#1f3a4d", muted: "#6b7f8c", line: "#dde6ea",
  teal: "#11a07f", tealLight: "#7fd8bf", tealSoft: "#e2f6ef",
  warn: "#d97706", warnSoft: "#fdf0dc",
  violet: "#6d4fc2", violetLight: "#b9a4f2", violetSoft: "#efeafb",
  skin: "#f2c9a5", skin2: "#d9a77f",
  coat: "#ffffff", coatLine: "#cfdcdd", shirt: "#f59e0b", shirtLine: "#d48806",
  hair: "#3b2a20", hair2: "#1e1e24", night: "#ffffff", fade: "255,255,255",
};

// ---- 動きの補助 ----
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const prog = (t, s, len) => clamp((t - s) / len);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const backOut = (x) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const pop = (t, s, len = 0.35) => (t < s ? 0 : backOut(prog(t, s, len)));
const lerp = (a, b, k) => a + (b - a) * k;
const fadeWindow = (t, s, e, f = 0.4) => clamp(prog(t, s, f)) * (1 - prog(t, e - f, f));
function arcPos(x0, y0, x1, y1, k, lift) {
  return [lerp(x0, x1, k), lerp(y0, y1, k) - Math.sin(k * Math.PI) * lift];
}

// 時間の伸び縮み：[実際の時刻, 場面の中の時刻] の点を直線でつなぐ
function makeWarp(points) {
  const f = (x, a, b) => {
    for (let i = 0; i < points.length - 1; i++) {
      const p = points[i], q = points[i + 1];
      if (x <= q[a] || i === points.length - 2) return lerp(p[b], q[b], clamp((x - p[a]) / (q[a] - p[a])));
    }
    return points[points.length - 1][b];
  };
  return { toScene: (real) => f(real, 0, 1), toReal: (scene) => f(scene, 1, 0) };
}

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function text(s, x, y, size, color, weight = 700, align = "center") {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(s, x, y);
}
function shadowed(fn) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.14)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
  fn();
  ctx.restore();
}
function alpha(a, fn) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha *= a; fn(); ctx.restore();
}

// ---- 人の絵：腕・まばたき・体の揺れ・汗 ----
// arm: [肩からの角度（0=真下、正=体の外側）, ひじの曲げ]
function arm(side, a, bend, color, line, skin) {
  const sx = side * 92, sy = 175, l1 = 120, l2 = 110;
  const a1 = side * a;
  const ex = sx + Math.sin(a1) * l1, ey = sy + Math.cos(a1) * l1;
  const a2 = a1 + side * bend;
  const hx = ex + Math.sin(a2) * l2, hy = ey + Math.cos(a2) * l2;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = line; ctx.lineWidth = 54;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 46;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(hx, hy, 24, 0, Math.PI * 2); ctx.fill();
}
function person(x, y, o) {
  const t = GT;
  const bob = Math.sin(t * 2.4 + (o.phase || 0)) * 5;
  ctx.save();
  ctx.translate(x, y + bob);
  if (o.scale) ctx.scale(o.scale, o.scale);
  ctx.fillStyle = o.body; ctx.strokeStyle = o.bodyLine; ctx.lineWidth = 3;
  rr(-120, 120, 240, 360, 110); ctx.fill(); ctx.stroke();
  if (o.coat) {
    ctx.fillStyle = C.tealSoft;
    ctx.beginPath(); ctx.moveTo(-45, 125); ctx.lineTo(0, 200); ctx.lineTo(45, 125); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.teal; rr(30, 230, 54, 30, 6); ctx.fill();
  }
  arm(-1, o.armL[0], o.armL[1], o.body, o.bodyLine, o.skin);
  arm(1, o.armR[0], o.armR[1], o.body, o.bodyLine, o.skin);
  ctx.save();
  ctx.translate(0, 110);
  ctx.rotate(o.tilt || 0);
  ctx.translate(0, -110 + (o.nod || 0));
  ctx.fillStyle = o.skin; rr(-24, 90, 48, 40, 14); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 30, 92, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = o.hair;
  ctx.beginPath();
  if (o.long) {
    ctx.arc(0, 18, 98, Math.PI * 0.95, Math.PI * 2.05);
    ctx.lineTo(98, 90); ctx.lineTo(70, 90); ctx.lineTo(70, 10);
    ctx.lineTo(-70, 10); ctx.lineTo(-70, 90); ctx.lineTo(-98, 90);
  } else {
    ctx.arc(0, 22, 96, Math.PI * 1.02, Math.PI * 1.98);
    ctx.quadraticCurveTo(40, -10, -90, 5);
  }
  ctx.closePath(); ctx.fill();
  const blink = ((t + (o.phase || 0)) % 3.3) < 0.13;
  const look = o.look || 0;
  ctx.strokeStyle = C.ink; ctx.fillStyle = C.ink; ctx.lineCap = "round";
  if (o.mood === "happy") {
    ctx.lineWidth = 7;
    for (const ex of [-32, 32]) { ctx.beginPath(); ctx.arc(ex + look, 44, 12, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
  } else if (blink) {
    ctx.lineWidth = 6;
    for (const ex of [-32, 32]) { ctx.beginPath(); ctx.moveTo(ex - 10 + look, 38); ctx.lineTo(ex + 10 + look, 38); ctx.stroke(); }
  } else {
    for (const ex of [-32, 32]) { ctx.beginPath(); ctx.arc(ex + look, 38, 9, 0, Math.PI * 2); ctx.fill(); }
  }
  if (o.mood === "worried") {
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-48 + look, 6); ctx.lineTo(-18 + look, 14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(48 + look, 6); ctx.lineTo(18 + look, 14); ctx.stroke();
  }
  ctx.lineWidth = 7;
  ctx.beginPath();
  if (o.mood === "happy") ctx.arc(look * 0.5, 62, 22, Math.PI * 0.15, Math.PI * 0.85);
  else if (o.talk) { const m = 6 + Math.abs(Math.sin(t * 14)) * 10; ctx.ellipse(look * 0.5, 76, 13, m, 0, 0, Math.PI * 2); ctx.fillStyle = "#7a3b2e"; ctx.fill(); }
  else if (o.mood === "worried") ctx.arc(look * 0.5, 92, 20, Math.PI * 1.2, Math.PI * 1.8);
  else { ctx.moveTo(-16 + look * 0.5, 75); ctx.lineTo(16 + look * 0.5, 75); }
  ctx.stroke();
  if (o.mood === "happy") {
    ctx.fillStyle = "rgba(244,114,94,.35)";
    for (const ex of [-56, 56]) { ctx.beginPath(); ctx.ellipse(ex, 66, 16, 10, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  if (o.sweat > 0) {
    ctx.globalAlpha = o.sweat;
    ctx.fillStyle = "#7cc4f0";
    ctx.beginPath();
    ctx.moveTo(86, -24); ctx.quadraticCurveTo(104, 2, 94, 12); ctx.quadraticCurveTo(76, 14, 80, -4); ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.restore();
}

// 患者さん・薬剤師の決まった見た目
const PATIENT = { body: C.shirt, bodyLine: C.shirtLine, skin: C.skin, hair: C.hair, long: true, phase: 0.7 };
const PHARMACIST = { body: C.coat, bodyLine: C.coatLine, skin: C.skin2, hair: C.hair2, coat: true, phase: 2.1 };
const PX = 300, PY = 420;   // 患者さん
const RX = 1700, RY = 420;  // 薬剤師
const HX = 900, HY = 400;   // 中央（MODA の位置）

function bubble(cx, cy, w, h, s, msg, sub, tailLeft = true) {
  if (s <= 0) return;
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(s, s);
  shadowed(() => { ctx.fillStyle = "#fff"; rr(-w / 2, -h / 2, w, h, 32); ctx.fill(); });
  ctx.fillStyle = "#fff";
  const tx = tailLeft ? -w / 2 + 60 : w / 2 - 60;
  ctx.beginPath(); ctx.moveTo(tx - 18, h / 2 - 2); ctx.lineTo(tx + (tailLeft ? -24 : 24), h / 2 + 36); ctx.lineTo(tx + 18, h / 2 - 2); ctx.fill();
  if (sub) { text(msg, 0, -15, 34, C.ink); text(sub, 0, 24, 24, C.muted, 500); }
  else text(msg, 0, 0, 34, C.ink);
  ctx.restore();
}

function room(gray) {
  ctx.fillStyle = gray ? C.wallGray : C.wall; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = gray ? "rgba(90,110,125,.035)" : "rgba(17,160,127,.05)";
    ctx.beginPath(); ctx.arc(300 + i * 480 + Math.sin(GT * 0.4 + i) * 40, 160 + Math.cos(GT * 0.3 + i) * 30, 180 + i * 20, 0, Math.PI * 2); ctx.fill();
  }
}
function counter() {
  ctx.fillStyle = C.counterTop; ctx.fillRect(0, 790, W, 26);
  ctx.fillStyle = C.counter; ctx.fillRect(0, 816, W, H - 816);
  ctx.fillStyle = C.line; ctx.fillRect(0, 816, W, 3);
}
function caption(s, a, color = C.ink) {
  alpha(a, () => text(s, W / 2, 985, 48, color, 700));
}
// 右上の札「MODA がないとき／あるとき」
function sceneLabel(s, bg, fg, a) {
  alpha(a, () => {
    ctx.font = `800 40px ${FONT}`;
    const w = ctx.measureText(s).width + 64;
    const x0 = W - 60 - w;
    ctx.fillStyle = bg; rr(x0, 50, w, 76, 38); ctx.fill();
    text(s, x0 + w / 2, 89, 40, fg, 800);
  });
}

// ①〜⑤の札（販売の前に薬剤師が確かめること）。state: "" | "q"（？）| "ok"（✓）
const STEP_CHIPS = [
  { n: "①", label: "問診" },
  { n: "②", label: "禁忌" },
  { n: "③", label: "区分の手順" },
  { n: "④", label: "説明・理解" },
  { n: "⑤", label: "記録" },
];
function stepChips(states, a, y = 88) {
  alpha(a, () => {
    const widths = [170, 170, 230, 230, 170];
    const gap = 12;
    let x = 400;
    STEP_CHIPS.forEach((c, i) => {
      const w = widths[i];
      const st = states[i] || {};
      const s = st.pop ?? 1;
      ctx.save();
      ctx.translate(x + w / 2, y); ctx.scale(s, s);
      const ok = st.mark === "ok", q = st.mark === "q";
      shadowed(() => { ctx.fillStyle = ok ? C.teal : "#fff"; rr(-w / 2, -32, w, 64, 32); ctx.fill(); });
      const fg = ok ? "#fff" : C.ink;
      text(`${c.n} ${c.label}`, -w / 2 + 20, c.note ? -6 : 0, 24, fg, 800, "left");
      if (c.note) text(c.note, -w / 2 + 62, 20, 16, ok ? C.tealSoft : C.muted, 700, "left");
      if (q) {
        ctx.fillStyle = C.warnSoft; ctx.beginPath(); ctx.arc(w / 2 - 28, 0, 20, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.translate(w / 2 - 28, 1); ctx.rotate(Math.sin(GT * 6 + i) * 0.12);
        text("？", 0, 0, 30, C.warn, 900); ctx.restore();
      } else if (ok) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.beginPath(); ctx.moveTo(w / 2 - 40, 0); ctx.lineTo(w / 2 - 31, 10); ctx.lineTo(w / 2 - 16, -10); ctx.stroke();
      }
      ctx.restore();
      x += w + gap;
    });
  });
}
// 場面の中の時刻から札の状態を作る：marks = [[時刻, "q"|"ok"], ...]
function chipStates(t, marks) {
  return marks.map(([mt, mark]) => (t >= mt ? { mark, pop: pop(t, mt, 0.4) } : {}));
}
