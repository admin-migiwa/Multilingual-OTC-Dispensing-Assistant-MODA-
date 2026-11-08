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
  // 肩から肘、肘から手。輪郭線は使わず、袖と同じ色で太めに
  const sx = side * 98, sy = 150, l1 = 118, l2 = 108;
  const a1 = side * a;
  const ex = sx + Math.sin(a1) * l1, ey = sy + Math.cos(a1) * l1;
  const a2 = a1 + side * bend;
  const hx = ex + Math.sin(a2) * l2, hy = ey + Math.cos(a2) * l2;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = line; ctx.lineWidth = 50;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 46;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.ellipse(hx, hy, 24, 27, a2, 0, Math.PI * 2); ctx.fill();
}
/*
 * 人物（11/8 夜：依頼主の参考画像に合わせて描き直し）。輪郭線なし・やわらかい色・点の目・小さな口・頬。
 * o：body/bodyLine/skin/hair/long/coat/phase/scale、armL/armR=[腕の角度, 肘の曲がり]、
 *    mood："neutral"|"happy"|"worried"|"headache"、talk、look（目線）、nod、tilt、sweat
 */
function person(x, y, o) {
  const t = GT;
  const bob = Math.sin(t * 2.4 + (o.phase || 0)) * 4;
  ctx.save();
  ctx.translate(x, y + bob);
  if (o.scale) ctx.scale(o.scale, o.scale);
  // 胴体：なで肩で、下はカウンターに隠れる
  ctx.fillStyle = o.body;
  ctx.beginPath();
  ctx.moveTo(-112, 160); ctx.quadraticCurveTo(-118, 116, -60, 112);
  ctx.lineTo(60, 112); ctx.quadraticCurveTo(118, 116, 112, 160);
  ctx.lineTo(118, 490); ctx.lineTo(-118, 490); ctx.closePath(); ctx.fill();
  if (o.coat) {
    // 白衣：中のミントのシャツ、襟、名札、ポケット
    ctx.fillStyle = o.inner; ctx.beginPath(); ctx.moveTo(-50, 112); ctx.lineTo(0, 212); ctx.lineTo(50, 112); ctx.closePath(); ctx.fill();
    ctx.fillStyle = o.skin; rr(-22, 92, 44, 36, 12); ctx.fill();
    ctx.fillStyle = o.body;
    ctx.beginPath(); ctx.moveTo(-72, 112); ctx.lineTo(-24, 112); ctx.lineTo(-2, 228); ctx.lineTo(-30, 236); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(72, 112); ctx.lineTo(24, 112); ctx.lineTo(2, 228); ctx.lineTo(30, 236); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = o.bodyLine; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-72, 112); ctx.lineTo(-2, 230); ctx.moveTo(72, 112); ctx.lineTo(2, 230); ctx.moveTo(0, 230); ctx.lineTo(0, 490); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-96, 350); ctx.lineTo(-96, 420); ctx.lineTo(-40, 420); ctx.lineTo(-40, 350); ctx.stroke();
    ctx.fillStyle = C.teal; rr(34, 240, 54, 28, 6); ctx.fill();
  } else {
    // 患者さん：丸首のトップス。首
    ctx.fillStyle = o.skin; rr(-22, 92, 44, 36, 12); ctx.fill();
    ctx.fillStyle = o.body; ctx.beginPath(); ctx.ellipse(0, 114, 34, 14, 0, 0, Math.PI); ctx.fill();
  }
  arm(-1, o.armL[0], o.armL[1], o.body, o.bodyLine, o.skin);
  arm(1, o.armR[0], o.armR[1], o.body, o.bodyLine, o.skin);
  // 頭
  ctx.save();
  ctx.translate(0, 110);
  ctx.rotate(o.tilt || 0);
  ctx.translate(0, -110 + (o.nod || 0));
  const hw = 88, hh = 92;
  if (o.long) {
    // 後ろ髪（ボブ。毛先は内側に）
    ctx.fillStyle = o.hair; ctx.beginPath();
    ctx.moveTo(-hw - 6, 0); ctx.quadraticCurveTo(-hw - 22, 100, -hw + 8, 134); ctx.quadraticCurveTo(-hw + 30, 146, -hw + 44, 128);
    ctx.lineTo(hw - 44, 128); ctx.quadraticCurveTo(hw - 30, 146, hw - 8, 134); ctx.quadraticCurveTo(hw + 22, 100, hw + 6, 0);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = o.skin;
  ctx.beginPath(); ctx.ellipse(0, 30, hw, hh, 0, 0, Math.PI * 2); ctx.fill();
  for (const sd of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sd * (hw - 2), 44, 11, 16, 0, 0, Math.PI * 2); ctx.fill(); }
  // 前髪
  ctx.fillStyle = o.hair; ctx.beginPath();
  if (o.long) {
    ctx.ellipse(0, 8, hw + 8, hh * 0.86, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(hw + 8, 8);
    ctx.quadraticCurveTo(hw * 0.55, 44, hw * 0.1, 8); // 横に流した前髪
    ctx.quadraticCurveTo(-hw * 0.35, 40, -hw - 8, 8);
  } else {
    ctx.ellipse(0, 6, hw + 8, hh * 0.9, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(hw + 8, 6); ctx.quadraticCurveTo(hw * 0.7, 30, hw * 0.3, 10);
    ctx.quadraticCurveTo(-hw * 0.1, 34, -hw * 0.45, 8); ctx.quadraticCurveTo(-hw * 0.85, 26, -hw - 8, 6);
  }
  ctx.closePath(); ctx.fill();
  // 表情
  const blink = ((t + (o.phase || 0)) % 3.3) < 0.13;
  const look = o.look || 0;
  const mood = o.mood || "neutral";
  const closed = mood === "happy" || mood === "headache";
  const ey = 44, ex = 32;
  ctx.lineCap = "round";
  for (const sd of [-1, 1]) {
    const cx = sd * ex + look * 0.4;
    // 眉（細く、やわらかく）
    ctx.strokeStyle = o.hair; ctx.lineWidth = 3.5; ctx.globalAlpha = 0.7;
    ctx.beginPath();
    if (mood === "worried" || mood === "headache") { ctx.moveTo(cx - sd * 12, 16); ctx.lineTo(cx + sd * 12, 22); }
    else { ctx.moveTo(cx - 12, 20); ctx.quadraticCurveTo(cx, 16, cx + 12, 20); }
    ctx.stroke(); ctx.globalAlpha = 1;
    ctx.strokeStyle = C.ink; ctx.fillStyle = C.ink;
    if (closed) {
      ctx.lineWidth = 5; ctx.beginPath();
      if (mood === "happy") ctx.arc(cx, ey + 4, 10, Math.PI * 1.12, Math.PI * 1.88);
      else ctx.arc(cx, ey - 6, 10, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();
    } else if (blink) {
      ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx - 9, ey); ctx.lineTo(cx + 9, ey); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(cx, ey, 7, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx + 2.5, ey - 3, 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  const mx = look * 0.4;
  ctx.strokeStyle = "#9a5a4a"; ctx.lineWidth = 4;
  ctx.beginPath();
  if (mood === "happy") { ctx.arc(mx, 68, 16, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke(); }
  else if (o.talk) { const m = 5 + Math.abs(Math.sin(t * 14)) * 8; ctx.ellipse(mx, 80, 10, m, 0, 0, Math.PI * 2); ctx.fillStyle = "#c0574a"; ctx.fill(); }
  else if (mood === "worried" || mood === "headache") { ctx.arc(mx, 94, 12, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke(); }
  else { ctx.arc(mx, 72, 9, Math.PI * 0.2, Math.PI * 0.8); ctx.stroke(); }
  // 頬
  ctx.fillStyle = "rgba(245,140,120,.30)";
  for (const sd of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sd * 58, 70, 15, 8, 0, 0, Math.PI * 2); ctx.fill(); }
  if (o.sweat > 0) {
    ctx.globalAlpha = o.sweat; ctx.fillStyle = "#7cc4f0";
    ctx.beginPath(); ctx.moveTo(hw - 2, -24); ctx.quadraticCurveTo(hw + 16, 2, hw + 6, 12); ctx.quadraticCurveTo(hw - 12, 14, hw - 8, -4); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.restore();
}

// 患者さん・薬剤師の決まった見た目（参考画像：黄色のトップスとボブ／白衣にミントのシャツと短髪）
const PATIENT = { body: "#f3cf63", bodyLine: "#e4bc4a", skin: "#f9dcc4", hair: "#5b3f2e", long: true, phase: 0.7 };
const PHARMACIST = { body: "#ffffff", bodyLine: "#d6e1e4", skin: "#f6d6bd", hair: "#2e2a2b", coat: true, inner: "#bfe6d8", phase: 2.1 };
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
