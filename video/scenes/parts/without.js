/*
 * 「MODA がないとき」（0〜T0 秒）。人物・立ち位置・背景は「あるとき」と同じ。
 * スマホの翻訳アプリ（特定の製品ではない、一般的なもの）を行き来させて会話する。
 * 伝えること：①ことばは少し伝わる ②まとめて聞くと答えがもれる ③説明書は日本語のまま。
 */
const WITHOUT_EVENTS = [
  { t: 0.9, kind: "tap" },
  { t: 2.3, kind: "swoosh" }, { t: 2.9, kind: "pop" },
  { t: 4.1, kind: "tap" },
  { t: 5.1, kind: "swoosh" }, { t: 5.8, kind: "pop" },
  { t: 6.6, kind: "pop" }, { t: 7.0, kind: "check" }, { t: 7.5, kind: "huh" },
  { t: 8.4, kind: "swoosh" }, { t: 9.4, kind: "huh" },
  { t: 11.0, kind: "swoosh" }, { t: 11.9, kind: "stamp" },
];

// スマホの位置（時刻で決まる）
const PHONE_KEYS = [
  [0.0, 490, 430, 0.15], [2.2, 490, 430, 0.15],
  [2.9, 1420, 600, -0.1], [5.0, 1420, 600, -0.1],
  [5.7, 580, 610, 0.08], [99, 580, 610, 0.08],
];
function phonePos(t) {
  for (let i = 0; i < PHONE_KEYS.length - 1; i++) {
    const [t0, x0, y0, r0] = PHONE_KEYS[i], [t1, x1, y1, r1] = PHONE_KEYS[i + 1];
    if (t <= t1) {
      const k = easeInOut(prog(t, t0, t1 - t0));
      const [x, y] = arcPos(x0, y0, x1, y1, k, 120);
      return [x, y, lerp(r0, r1, k)];
    }
  }
  return [580, 610, 0.08];
}

function phone(t, alpha) {
  const s = easeOut(prog(t, 0.5, 0.4)) * alpha;
  if (s <= 0) return;
  const [x, y, r] = phonePos(t);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(r); ctx.scale(s, s);
  shadowed(() => { ctx.fillStyle = "#1c2628"; rr(-95, -170, 190, 340, 26); ctx.fill(); });
  ctx.fillStyle = "#f7f9fa"; rr(-82, -154, 164, 308, 16); ctx.fill();
  text("翻訳アプリ", 0, -128, 16, C.muted, 700);
  ctx.fillStyle = C.line; ctx.fillRect(-70, -110, 140, 2);
  const mic = (t > 0.9 && t < 2.1) || (t > 4.1 && t < 4.9);
  if (t < 2.6) {
    msgBlock("Tôi bị sốt và ho từ 2 ngày trước", "vi");
  } else if (t < 4.1) {
    msgBlock("熱とせきが2日前からです", "ja");
  } else if (t < 5.5) {
    msgBlock("持病やアレルギー、ほかに飲んでいる薬はありますか？", "ja");
  } else {
    msgBlock("Bạn có bệnh nền, dị ứng, hoặc đang dùng thuốc nào khác không?", "vi");
  }
  if (mic) {
    for (let i = 0; i < 5; i++) {
      const h = 10 + Math.abs(Math.sin(t * 12 + i * 1.3)) * 30;
      ctx.fillStyle = C.teal; rr(-44 + i * 20, 118 - h / 2, 10, h, 5); ctx.fill();
    }
  } else {
    ctx.fillStyle = "#e3e9ea"; ctx.beginPath(); ctx.arc(0, 118, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.muted; rr(-6, 104, 12, 22, 6); ctx.fill();
  }
  ctx.restore();
}
// スマホの画面の文（狭いので折り返す）
function msgBlock(s, lang) {
  ctx.font = `700 19px ${FONT}`;
  const lines = [];
  if (lang === "vi") {
    let line = "";
    for (const w of s.split(" ")) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > 140 && line) { lines.push(line); line = w; } else line = test;
    }
    lines.push(line);
  } else {
    let line = "";
    for (const ch of s) {
      if (ctx.measureText(line + ch).width > 140) { lines.push(line); line = ch; } else line += ch;
    }
    lines.push(line);
  }
  const top = -10 - ((lines.length - 1) * 26) / 2;
  lines.forEach((l, i) => text(l, 0, top + i * 26, 19, C.ink, 700));
}

// 薬剤師の手書きメモ（確かめたいこと）
function clipboard(t, alpha) {
  const s = pop(t, 6.6) * alpha;
  if (s <= 0) return;
  ctx.save();
  ctx.translate(1290, 300); ctx.rotate(0.04); ctx.scale(s, s);
  shadowed(() => { ctx.fillStyle = "#b08a5a"; rr(-170, -150, 340, 300, 18); ctx.fill(); });
  ctx.fillStyle = "#fffdf7"; rr(-150, -120, 300, 255, 8); ctx.fill();
  ctx.fillStyle = "#8a8f91"; rr(-50, -165, 100, 34, 8); ctx.fill();
  text("確かめたいこと", 0, -88, 22, C.muted, 700);
  const rows = [["持病", "q"], ["アレルギー", t > 7.0 ? "ok" : "q"], ["ほかの薬", "q"]];
  rows.forEach(([label, st], i) => {
    const y = -30 + i * 58;
    text(label, -125, y, 28, C.ink, 700, "left");
    if (st === "ok") {
      text("なし", 55, y, 24, C.teal, 700);
      ctx.strokeStyle = C.teal; ctx.lineWidth = 6; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(98, y); ctx.lineTo(108, y + 10); ctx.lineTo(126, y - 12); ctx.stroke();
    } else {
      const wob = Math.sin(t * 6 + i) * 0.12;
      ctx.save(); ctx.translate(110, y); ctx.rotate(wob); text("？", 0, 0, 34, C.warn, 900); ctx.restore();
    }
  });
  ctx.restore();
}

// 日本語だけの説明書
function jaLeaflet(t, alpha) {
  const k = easeInOut(prog(t, 8.4, 1.0));
  if (k <= 0 || alpha <= 0) return;
  const [x, y] = arcPos(1420, 560, 640, 330, k, 220);
  const s = lerp(0.5, 1, k) * alpha;
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(Math.sin(k * Math.PI) * 0.3 - 0.04);
  shadowed(() => { ctx.fillStyle = "#fff"; rr(-220, -170, 440, 340, 18); ctx.fill(); });
  ctx.fillStyle = "#9aa8aa"; rr(-220, -170, 440, 66, 18); ctx.fill(); ctx.fillRect(-220, -124, 440, 20);
  text("使用上の注意", 0, -137, 30, "#fff", 800);
  text("用法・用量", -190, -70, 22, C.muted, 700, "left");
  text("1日3回、食前に服用すること", -190, -28, 26, C.ink, 700, "left");
  text("高い熱が続くときは受診すること", -190, 16, 26, C.ink, 700, "left");
  text("次の人は服用前に相談すること", -190, 60, 26, C.ink, 700, "left");
  text("（日本語のみ）", 190, 120, 20, C.warn, 700, "right");
  ctx.restore();
}

function sceneLabel(s, bg, fg, a) {
  if (a <= 0) return;
  ctx.globalAlpha = a;
  ctx.font = `800 40px ${FONT}`;
  const w = ctx.measureText(s).width + 64;
  const x0 = W - 60 - w;
  ctx.fillStyle = bg; rr(x0, 50, w, 76, 38); ctx.fill();
  text(s, x0 + w / 2, 89, 40, fg, 800);
  ctx.globalAlpha = 1;
}

const WITHOUT_CAPS = [
  [1.0, 5.0, "翻訳アプリで、ことばは少し伝わる。"],
  [5.4, 8.3, "でも、まとめて聞くと答えがもれる。"],
  [8.6, 11.0, "説明書も、日本語のまま。"],
];

function drawWithout(t) {
  ctx.fillStyle = "#eceff0"; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = "rgba(60,70,72,.04)";
    ctx.beginPath(); ctx.arc(300 + i * 480 + Math.sin(GT * 0.4 + i) * 40, 160 + Math.cos(GT * 0.3 + i) * 30, 180 + i * 20, 0, Math.PI * 2); ctx.fill();
  }
  const out = 1 - prog(t, 10.9, 0.4); // 切り替え前に小物を片付ける

  // 患者さん：スマホに話す → 渡す → 受け取って読む → 説明書で困る
  const speaking = t > 0.9 && t < 2.1;
  const holding = t < 2.3;
  const reaching = (t > 5.4 && t < 8.6);
  const puzzled = t > 7.4;
  person(t, PX, PY, {
    body: C.shirt, bodyLine: C.shirtLine, skin: C.skin, hair: C.hair, long: true, phase: 0.7,
    armL: [0.15, 0.1],
    armR: holding ? [2.3, 0.75] : reaching ? [0.95, -0.35] : [0.2, 0.15],
    mood: puzzled ? "worried" : "neutral",
    talk: speaking,
    look: holding ? 14 : t > 8.6 ? 12 : 8,
    tilt: puzzled ? Math.sin(GT * 2) * 0.06 + 0.06 : 0,
    sweat: clamp((t - 9.4) * 2),
  });
  // 薬剤師：スマホを受け取り読む → 話す → メモを見て困る
  const pHold = t > 2.6 && t < 5.1;
  const pTalk = t > 4.1 && t < 4.9;
  const pNod = t > 3.2 && t < 3.9 ? Math.sin(prog(t, 3.2, 0.7) * Math.PI * 2) * 8 : 0;
  person(t, RX, RY, {
    body: C.coat, bodyLine: C.coatLine, skin: C.skin2, hair: C.hair2, coat: true, phase: 2.1,
    armL: pHold ? [1.25, -0.5] : [0.2, 0.15],
    armR: [0.2, 0.15],
    mood: t > 7.6 ? "worried" : "neutral",
    talk: pTalk, look: pHold ? -14 : t > 6.6 ? -10 : -6, nod: pNod,
    sweat: clamp((t - 8.0) * 2),
  });

  ctx.fillStyle = C.counterTop; ctx.fillRect(0, 790, W, 26);
  ctx.fillStyle = C.counter; ctx.fillRect(0, 816, W, H - 816);

  phone(t, out);
  clipboard(t, out);
  // 患者さんの答え（アレルギーのことだけ）
  bubble(400, 110, 380, 100, pop(t, 6.6) * (1 - prog(t, 8.2, 0.3)), "Không dị ứng.", "（アレルギーはないです）");
  // 「？」
  const q = pop(t, 9.4) * out;
  if (q > 0) {
    ctx.save(); ctx.translate(PX - 170, 300); ctx.rotate(Math.sin(GT * 5) * 0.1); ctx.scale(q, q);
    text("？", 0, 0, 120, C.warn, 900); ctx.restore();
  }
  jaLeaflet(t, out);

  sceneLabel("MODA がないとき", C.warnSoft, C.warn, easeOut(prog(t, 0.3, 0.5)) * out);
  for (const [s, e, msg] of WITHOUT_CAPS) caption(msg, clamp(prog(t, s, 0.4)) * (1 - prog(t, e - 0.4, 0.4)));
}

// 切り替え：青緑の円が中央（MODA の位置）に向かって閉じ、「MODA があると」の文字のあと、
// MODA の位置から開いて「あるとき」の場面が現れる。人物の立ち位置は変わらない。
function irisClose(t) {
  const k = easeInOut(prog(t, 11.0, 0.5));
  if (k <= 0) return;
  const r = lerp(2300, 0, 1 - k);
  ctx.fillStyle = C.teal;
  ctx.beginPath(); ctx.arc(HX, HY, Math.max(1, r * k), 0, Math.PI * 2); ctx.fill();
}
function irisOpen(t) {
  // t は「あるとき」の時刻（0 から）
  const k = easeInOut(prog(t, 0.0, 0.6));
  if (k >= 1) return;
  const r = lerp(124, 2300, k);
  ctx.fillStyle = C.teal;
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.arc(HX, HY, r, 0, Math.PI * 2, true);
  ctx.fill("evenodd");
}
function bridgeText(tg) {
  const a = clamp(1 - Math.abs(tg - 11.72) / 0.3);
  if (a <= 0) return;
  ctx.globalAlpha = a;
  text("MODA があると", W / 2, H / 2 - 40, 110, "#ffffff", 800);
  ctx.globalAlpha = 1;
}
