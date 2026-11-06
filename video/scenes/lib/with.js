/*
 * 「MODA があるとき」（場面の中の時刻 0〜20.6 秒）。呼び出し側が時間を縮めて約10秒で見せる。
 * 患者さんは母国語で答える → MODA が日本語のまとめ・薬の候補（薬剤師への提案、薬剤師の画面だけ）・母国語の説明書を準備
 * → 薬剤師が選んで PIN で承認 → 承認の後に説明書が患者さんへ（説明書は承認まで鍵がかかっている：絶対ルール1）。
 * 患者さんは実演1と同じ「熱と頭痛・ぜんそくなし」の人。薬は架空（docs/demo-data/drugs.md の C と I）。
 */
const WITH_EVENTS = [
  { t: 1.2, kind: "tap" }, { t: 1.4, kind: "pop" },
  { t: 2.4, kind: "tap" }, { t: 2.6, kind: "pop" },
  { t: 3.6, kind: "tap" }, { t: 3.8, kind: "pop" },
  { t: 5.0, kind: "swoosh" },
  { t: 6.4, kind: "check" }, { t: 8.0, kind: "check" }, { t: 9.6, kind: "check" },
  { t: 12.3, kind: "tap" },
  { t: 13.3, kind: "tap" }, { t: 13.9, kind: "tap" },
  { t: 14.6, kind: "stamp" },
  { t: 15.9, kind: "swoosh" },
  { t: 19.2, kind: "pop" },
];
const WITH_CHIPS = [[6.5, "ok"], [12.3, "ok"], [17.0, "ok"]];

const PAN_X = 1320, PAN_Y = 480, PAN_W = 440, PAN_H = 560;
const SLOTS = [PAN_Y - 165, PAN_Y + 5, PAN_Y + 185];
const TAB_X = 560, TAB_Y = 700;
const ANSWERS = [
  { t: 1.4, vi: "Sốt 38°C", ja: "38℃の熱" },
  { t: 2.6, vi: "Đau đầu từ hôm qua", ja: "昨日から頭痛" },
  { t: 3.8, vi: "Chưa từng bị hen suyễn", ja: "ぜんそくはない" },
];

function hub(t) {
  const on = easeOut(prog(t, 0.2, 0.6));
  if (on <= 0) return;
  const busy = clamp(prog(t, 1.4, 0.3)) * (1 - prog(t, 11.0, 1.0));
  const pulse = 1 + Math.sin(GT * 6) * 0.04 * busy;
  ctx.save();
  ctx.translate(HX, HY); ctx.scale(on * pulse, on * pulse);
  ctx.strokeStyle = C.tealLight; ctx.lineWidth = 10; ctx.setLineDash([30, 22]);
  ctx.lineDashOffset = -GT * 120 * (0.3 + busy);
  ctx.beginPath(); ctx.arc(0, 0, 150, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  shadowed(() => { ctx.fillStyle = C.teal; ctx.beginPath(); ctx.arc(0, 0, 124, 0, Math.PI * 2); ctx.fill(); });
  text("MODA", 0, -22, 56, "#fff", 800);
  text("訳す・まとめる", 0, 28, 20, C.tealSoft, 700);
  text("照らし合わせる", 0, 56, 20, C.tealSoft, 700);
  for (let i = 0; i < 3; i++) {
    const a = GT * (1.4 + busy * 2) + (i * Math.PI * 2) / 3;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(Math.cos(a) * 150, Math.sin(a) * 150, 9, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function patientTablet(t) {
  const s = easeOut(prog(t, 0.2, 0.5));
  if (s <= 0) return;
  ctx.save();
  ctx.translate(TAB_X, TAB_Y); ctx.scale(s, s); ctx.rotate(-0.05);
  ctx.fillStyle = "#33484b"; rr(-26, 80, 52, 40, 6); ctx.fill();
  ctx.fillStyle = "#26363a"; rr(-150, -110, 300, 200, 20); ctx.fill();
  ctx.fillStyle = "#fff"; rr(-136, -96, 272, 172, 10); ctx.fill();
  text("Tiếng Việt", 0, -70, 18, C.teal, 700);
  const qi = t < 2.4 ? 0 : t < 3.6 ? 1 : 2;
  const qs = ["Bạn có sốt không?", "Bạn bị đau đầu từ khi nào?", "Bạn đã từng bị hen suyễn chưa?"];
  if (t < 5) {
    text(qs[qi], 0, -28, qi === 2 ? 18 : 21, C.ink, 700);
    ctx.fillStyle = C.tealSoft; rr(-90, 12, 180, 44, 10); ctx.fill();
    text(`${qi + 1} / 3`, 0, 34, 18, C.teal, 700);
  } else {
    alpha(prog(t, 5, 0.3), () => {
      text("Cảm ơn bạn.", 0, -20, 22, C.ink, 700);
      text("Vui lòng chờ dược sĩ.", 0, 20, 18, C.muted, 500);
    });
  }
  ctx.restore();
}
function stream(t, x0, y0, x1, y1, start, end, lift) {
  if (t < start || t > end + 0.8) return;
  for (let i = 0; i < 10; i++) {
    const k = prog(t, start + i * ((end - start) / 10), 0.8);
    if (k <= 0 || k >= 1) continue;
    const [x, y] = arcPos(x0, y0, x1, y1, easeInOut(k), lift);
    alpha(Math.sin(k * Math.PI) * 0.9, () => { ctx.fillStyle = C.teal; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill(); });
  }
}
function panelFrame(t) {
  const s = easeOut(prog(t, 4.8, 0.5));
  if (s <= 0) return;
  ctx.save();
  ctx.translate(PAN_X, PAN_Y); ctx.scale(s, s);
  shadowed(() => { ctx.fillStyle = "#26363a"; rr(-PAN_W / 2 - 16, -PAN_H / 2 - 16, PAN_W + 32, PAN_H + 32, 30); ctx.fill(); });
  ctx.fillStyle = "#f4f8f8"; rr(-PAN_W / 2, -PAN_H / 2, PAN_W, PAN_H, 16); ctx.fill();
  text("薬剤師の画面", -PAN_W / 2 + 22, -PAN_H / 2 + 28, 20, C.muted, 700, "left");
  text("薬はすべて架空", PAN_W / 2 - 22, -PAN_H / 2 + 28, 16, C.muted, 500, "right");
  ctx.restore();
}
function cardSummary() {
  text("日本語のまとめ", -180, -52, 22, C.teal, 800, "left");
  text("38℃の熱・頭痛（昨日から）", -180, -6, 26, C.ink, 700, "left");
  text("ぜんそく：なし", -180, 36, 26, C.ink, 700, "left");
}
function cardCandidates(t) {
  text("薬の候補（薬剤師への提案）", -180, -52, 22, C.teal, 800, "left");
  const picked = t > 12.3;
  [["モダペインS錠", "第1類", -6, true], ["モダねつさまし錠", "第2類", 38, false]].forEach(([name, cls, y, isPick]) => {
    const on = isPick && picked;
    ctx.strokeStyle = on ? C.teal : "#9fb3b5"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(-166, y, 13, 0, Math.PI * 2); ctx.stroke();
    if (on) { ctx.fillStyle = C.teal; ctx.beginPath(); ctx.arc(-166, y, 7, 0, Math.PI * 2); ctx.fill(); }
    text(name, -140, y, 25, on ? C.teal : C.ink, 700, "left");
    text(cls, 180, y, 18, C.muted, 700, "right");
  });
}
function cardLeaflet(t) {
  text("説明書（Tiếng Việt）", -180, -52, 22, C.teal, 800, "left");
  const unlock = prog(t, 15.4, 0.4);
  ctx.fillStyle = unlock > 0 ? "#b9cfd0" : "#dbe5e6";
  rr(-180, -14, 260, 14, 7); ctx.fill();
  rr(-180, 16, 230, 14, 7); ctx.fill();
  rr(-180, 46, 200, 14, 7); ctx.fill();
  ctx.save();
  ctx.translate(120, 10);
  const lift = easeOut(unlock) * 16;
  ctx.strokeStyle = unlock > 0 ? C.teal : C.warn; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(unlock > 0.5 ? 10 : 0, -16 - lift, 16, Math.PI, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-16, -16); ctx.lineTo(-16, -16 - lift); ctx.stroke();
  ctx.fillStyle = unlock > 0 ? C.teal : C.warn; rr(-26, -14, 52, 40, 8); ctx.fill();
  ctx.restore();
  text(unlock > 0 ? "承認済み" : "承認まで渡せません", 120, 58, 15, unlock > 0 ? C.teal : C.warn, 700);
}
const CARDS = [
  { t: 5.8, draw: cardSummary },
  { t: 7.4, draw: cardCandidates },
  { t: 9.0, draw: cardLeaflet },
];
function cards(t) {
  CARDS.forEach((cd, i) => {
    if (t < cd.t) return;
    const k = easeInOut(prog(t, cd.t, 0.7));
    const [x, y] = arcPos(HX, HY, PAN_X, SLOTS[i], k, 140);
    const glow = 1 - prog(t, cd.t + 0.6, 0.8);
    ctx.save();
    ctx.translate(x, y); ctx.scale(lerp(0.25, 1, k), lerp(0.25, 1, k)); ctx.rotate((1 - k) * -0.25);
    shadowed(() => { ctx.fillStyle = "#fff"; rr(-200, -78, 400, 156, 16); ctx.fill(); });
    if (glow > 0 && k >= 1) { ctx.strokeStyle = `rgba(15,118,110,${glow})`; ctx.lineWidth = 6; rr(-200, -78, 400, 156, 16); ctx.stroke(); }
    cd.draw(t);
    ctx.restore();
  });
}
function pinAndStamp(t) {
  const s = easeOut(prog(t, 12.9, 0.3)) * (1 - prog(t, 14.4, 0.25));
  if (s > 0) {
    ctx.save();
    ctx.translate(PAN_X, PAN_Y + PAN_H / 2 + 70); ctx.scale(s, s);
    shadowed(() => { ctx.fillStyle = "#fff"; rr(-170, -46, 340, 92, 46); ctx.fill(); });
    text("PIN", -112, 0, 26, C.muted, 800);
    [13.3, 13.6, 13.9, 14.2].forEach((pt, i) => {
      const on = t > pt;
      ctx.fillStyle = on ? C.teal : "#d6e1e2";
      ctx.beginPath(); ctx.arc(-40 + i * 52, 0, on ? 15 : 12, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }
  const st = pop(t, 14.6, 0.4);
  if (st > 0) {
    ctx.save();
    ctx.translate(PAN_X + 40, PAN_Y + PAN_H / 2 + 70); ctx.rotate(-0.07); ctx.scale(st, st);
    ctx.fillStyle = C.teal; rr(-180, -42, 360, 84, 42); ctx.fill();
    text("薬剤師が承認", 0, 2, 38, "#fff", 800);
    ctx.restore();
  }
}
function leafletToPatient(t) {
  const k = easeInOut(prog(t, 15.9, 1.1));
  if (k <= 0) return;
  const [x, y] = arcPos(PAN_X, SLOTS[2], 660, 360, k, 260);
  const s = lerp(0.55, 1, k);
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(Math.sin(k * Math.PI) * 0.3 - 0.04);
  shadowed(() => { ctx.fillStyle = "#fff"; rr(-230, -190, 460, 380, 18); ctx.fill(); });
  ctx.fillStyle = C.teal; rr(-230, -190, 460, 70, 18); ctx.fill(); ctx.fillRect(-230, -140, 460, 20);
  text("Hướng dẫn sử dụng", 0, -155, 30, "#fff", 800);
  text("Moda Pain S (hư cấu)", -200, -88, 22, C.muted, 700, "left");
  text("Mỗi lần 1 viên, tối đa 2 lần/ngày", -200, -40, 26, C.ink, 700, "left");
  text("Không dùng cho trẻ dưới 15 tuổi", -200, 4, 26, C.ink, 700, "left");
  ctx.fillStyle = C.line; ctx.fillRect(-200, 48, 400, 3);
  text("原文（日本語）", -200, 82, 18, C.muted, 700, "left");
  text("1回1錠、1日2回まで", -200, 116, 22, C.muted, 500, "left");
  text("15歳未満は服用しないこと", -200, 150, 22, C.muted, 500, "left");
  ctx.restore();
}
function irisOpen(t) {
  const k = easeInOut(prog(t, 0.0, 0.6));
  if (k >= 1) return;
  ctx.fillStyle = C.teal;
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.arc(HX, HY, lerp(124, 2300, k), 0, Math.PI * 2, true);
  ctx.fill("evenodd");
}

function drawWith(t) {
  room(false);
  const tapping = ANSWERS.some((a) => Math.abs(t - (a.t - 0.2)) < 0.25) ? 1 : 0;
  const reaching = t > 0.8 && t < 4.4;
  const reading = t > 17.0 && t < 18.8;
  person(PX, PY, {
    ...PATIENT,
    armL: [0.15, 0.1],
    armR: reaching ? [0.95 - tapping * 0.15, -0.35 + tapping * 0.2] : t > 19.2 ? [2.6, 0.4] : [0.2, 0.15],
    mood: t > 18.6 ? "happy" : "neutral",
    talk: t > 1.0 && t < 4.2 && !tapping,
    look: reading ? 14 : t < 5 ? 10 : 0,
    tilt: reading ? 0.12 : 0,
    nod: t > 18.8 && t < 19.8 ? Math.sin(prog(t, 18.8, 1.0) * Math.PI * 2) * 10 : 0,
  });
  const choosing = t > 11.6 && t < 14.4;
  person(RX, RY, {
    ...PHARMACIST,
    armL: choosing ? [1.25, -0.5] : [0.2, 0.15],
    armR: t > 19.2 ? [2.4, 0.5] : [0.2, 0.15],
    mood: t > 14.6 ? "happy" : "neutral",
    look: t > 5.5 && t < 16 ? -14 : 0, tilt: choosing ? -0.06 : 0,
    nod: t > 14.7 && t < 15.6 ? Math.sin(prog(t, 14.7, 0.9) * Math.PI * 2) * 9 : 0,
  });
  counter();
  patientTablet(t);
  hub(t);
  ANSWERS.forEach((a, i) => {
    const s = pop(t, a.t);
    const fly = easeInOut(prog(t, a.t + 0.9, 0.7));
    if (s <= 0 || fly >= 1) return;
    const [x, y] = arcPos(420 + i * 30, 210, HX, HY, fly, 60);
    bubble(x, y, 400, 108, s * (1 - fly * 0.8), a.vi, a.ja);
  });
  stream(t, 420, 250, HX, HY, 1.6, 4.6, 40);
  stream(t, HX + 130, HY, PAN_X - 220, PAN_Y, 5.2, 10.0, 120);
  panelFrame(t);
  cards(t);
  const rip = prog(t, 12.3, 0.5);
  if (rip > 0 && rip < 1) {
    ctx.strokeStyle = `rgba(15,118,110,${1 - rip})`; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(PAN_X - 166, SLOTS[1] - 6, 18 + rip * 40, 0, Math.PI * 2); ctx.stroke();
  }
  pinAndStamp(t);
  leafletToPatient(t);
  bubble(400, 200, 320, 100, pop(t, 19.2), "Cảm ơn!", "（ありがとう）");
  stepChips(chipStates(t, WITH_CHIPS), 1);
  sceneLabel("MODA があるとき", C.teal, "#ffffff", clamp(prog(t, 0.4, 0.4)));
  irisOpen(t);
}
