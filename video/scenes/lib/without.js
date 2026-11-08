/*
 * 「MODA がないとき」（場面の中の時刻 0〜11.9 秒）。翻訳アプリ（特定の製品ではない一般的なもの）を行き来させて接客する。
 * 伝えること：やりとりに時間がかかる／まとめて聞くと答えがもれる（①②が「？」）／説明書は日本語のまま（③が「？」）。
 * 患者さんは実演1と同じ「熱と頭痛」の人。説明書の中身は架空の薬 C（モダペインS錠・第1類）の表（docs/demo-data/drugs.md）に合わせる。
 * 字幕は呼び出し側（opening.html）が実際の時刻で出す。
 */
const WITHOUT_EVENTS = [
  { t: 0.9, kind: "tap" },
  { t: 2.3, kind: "swoosh" }, { t: 2.9, kind: "pop" },
  { t: 4.1, kind: "tap" },
  { t: 5.1, kind: "swoosh" }, { t: 5.8, kind: "pop" },
  { t: 6.6, kind: "pop" }, { t: 7.0, kind: "huh" },
  { t: 8.4, kind: "swoosh" }, { t: 9.4, kind: "huh" },
  { t: 11.0, kind: "swoosh" }, { t: 11.75, kind: "stamp" },
];
// ①問診・②禁忌：答えがもれる／③区分の手順・④説明・理解：日本語だけの説明書／⑤記録：やりとりが残らない
const WITHOUT_CHIPS = [[7.0, "q"], [7.6, "q"], [9.4, "q"], [9.8, "q"], [10.4, "q"]];

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
function msgBlock(s, lang) {
  ctx.font = `700 19px ${FONT}`;
  const lines = [];
  let line = "";
  if (lang === "vi") {
    for (const w of s.split(" ")) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > 140 && line) { lines.push(line); line = w; } else line = test;
    }
  } else {
    for (const ch of s) {
      if (ctx.measureText(line + ch).width > 140) { lines.push(line); line = ch; } else line += ch;
    }
  }
  lines.push(line);
  const top = -10 - ((lines.length - 1) * 26) / 2;
  lines.forEach((l, i) => text(l, 0, top + i * 26, 19, C.ink, 700));
}
function phone(t, a) {
  const s = easeOut(prog(t, 0.5, 0.4)) * a;
  if (s <= 0) return;
  const [x, y, r] = phonePos(t);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(r); ctx.scale(s, s);
  shadowed(() => { ctx.fillStyle = "#1c2628"; rr(-95, -170, 190, 340, 26); ctx.fill(); });
  ctx.fillStyle = "#f7f9fa"; rr(-82, -154, 164, 308, 16); ctx.fill();
  text("翻訳アプリ", 0, -128, 16, C.muted, 700);
  ctx.fillStyle = C.line; ctx.fillRect(-70, -110, 140, 2);
  const mic = (t > 0.9 && t < 2.1) || (t > 4.1 && t < 4.9);
  if (t < 2.6) msgBlock("Tôi bị sốt và đau đầu từ hôm qua", "vi");
  else if (t < 4.1) msgBlock("熱と頭痛が昨日からです", "ja");
  else if (t < 5.5) msgBlock("持病やアレルギー、ほかに飲んでいる薬はありますか？", "ja");
  else msgBlock("Bạn có bệnh nền, dị ứng, hoặc đang dùng thuốc nào khác không?", "vi");
  if (mic) {
    for (let i = 0; i < 5; i++) {
      const h = 10 + Math.abs(Math.sin(GT * 12 + i * 1.3)) * 30;
      ctx.fillStyle = C.teal; rr(-44 + i * 20, 118 - h / 2, 10, h, 5); ctx.fill();
    }
  } else {
    ctx.fillStyle = "#e3e9ea"; ctx.beginPath(); ctx.arc(0, 118, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.muted; rr(-6, 104, 12, 22, 6); ctx.fill();
  }
  ctx.restore();
}
function clipboard(t, a) {
  const s = pop(t, 6.6) * a;
  if (s <= 0) return;
  ctx.save();
  ctx.translate(1290, 330); ctx.rotate(0.04); ctx.scale(s, s);
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
      ctx.save(); ctx.translate(110, y); ctx.rotate(Math.sin(GT * 6 + i) * 0.12); text("？", 0, 0, 34, C.warn, 900); ctx.restore();
    }
  });
  ctx.restore();
}
function jaLeaflet(t, a) {
  const k = easeInOut(prog(t, 8.4, 1.0));
  if (k <= 0 || a <= 0) return;
  const [x, y] = arcPos(1420, 560, 660, 360, k, 220);
  const s = lerp(0.5, 1, k) * a;
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(Math.sin(k * Math.PI) * 0.3 - 0.04);
  shadowed(() => { ctx.fillStyle = "#fff"; rr(-230, -170, 460, 340, 18); ctx.fill(); });
  ctx.fillStyle = "#9aa8aa"; rr(-230, -170, 460, 66, 18); ctx.fill(); ctx.fillRect(-230, -124, 460, 20);
  text("使用上の注意", 0, -137, 30, "#fff", 800);
  text("モダペインS錠（架空）", -200, -70, 22, C.muted, 700, "left");
  text("1回1錠、1日2回まで", -200, -26, 26, C.ink, 700, "left");
  text("15歳未満は服用しないこと", -200, 18, 26, C.ink, 700, "left");
  text("ぜんそくを起こしたことがある人は", -200, 62, 26, C.ink, 700, "left");
  text("服用しないこと", -200, 100, 26, C.ink, 700, "left");
  text("（日本語のみ）", 200, 140, 20, C.warn, 700, "right");
  ctx.restore();
}

function drawWithout(t) {
  room(true);
  const out = 1 - prog(t, 10.9, 0.4); // 切り替え前に小物を片付ける
  const speaking = t > 0.9 && t < 2.1;
  const holding = t < 2.3;
  const reaching = t > 5.4 && t < 8.6;
  const puzzled = t > 7.4;
  person(PX, PY, {
    ...PATIENT,
    armL: [0.15, 0.1],
    armR: holding ? [2.3, 0.75] : reaching ? [0.95, -0.35] : [0.2, 0.15],
    mood: puzzled ? "worried" : "neutral", talk: speaking,
    look: holding ? 14 : t > 8.6 ? 12 : 8,
    tilt: puzzled ? Math.sin(GT * 2) * 0.06 + 0.06 : 0,
    sweat: clamp((t - 9.4) * 2),
  });
  const pHold = t > 2.6 && t < 5.1;
  person(RX, RY, {
    ...PHARMACIST,
    armL: pHold ? [1.25, -0.5] : [0.2, 0.15], armR: [0.2, 0.15],
    mood: t > 7.6 ? "worried" : "neutral", talk: t > 4.1 && t < 4.9,
    look: pHold ? -14 : t > 6.6 ? -10 : -6,
    nod: t > 3.2 && t < 3.9 ? Math.sin(prog(t, 3.2, 0.7) * Math.PI * 2) * 8 : 0,
    sweat: clamp((t - 8.0) * 2),
  });
  counter();
  phone(t, out);
  clipboard(t, out);
  bubble(400, 200, 380, 100, pop(t, 6.6) * (1 - prog(t, 8.2, 0.3)), "Không dị ứng.", "（アレルギーはないです）");
  const q = pop(t, 9.4) * out;
  if (q > 0) {
    ctx.save(); ctx.translate(PX - 170, 300); ctx.rotate(Math.sin(GT * 5) * 0.1); ctx.scale(q, q);
    text("？", 0, 0, 120, C.warn, 900); ctx.restore();
  }
  jaLeaflet(t, out);
  stepChips(chipStates(t, WITHOUT_CHIPS), easeOut(prog(t, 0.6, 0.5)) * out);
  sceneLabel("MODA がないとき", C.warnSoft, C.warn, easeOut(prog(t, 0.3, 0.5)) * out);
}

// 切り替え：青緑の円が中央（MODA の位置）へ閉じ、「MODA があると」のあと、同じ位置から開く
function irisClose(t) {
  const k = easeInOut(prog(t, 11.0, 0.5));
  if (k <= 0) return;
  ctx.fillStyle = C.teal;
  ctx.beginPath(); ctx.arc(HX, HY, Math.max(1, 2300 * k), 0, Math.PI * 2); ctx.fill();
  alpha(clamp(1 - Math.abs(t - 11.7) / 0.25), () => text("MODA があると", W / 2, H / 2 - 40, 110, "#ffffff", 800));
}
