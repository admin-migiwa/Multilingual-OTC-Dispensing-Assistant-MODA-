/*
 * デモの患者さん（架空）のカード。実演の最初はまん中に大きく出し、操作が始まると左の余白へ、大きさと位置をなめらかに変えながら移る。
 * window.CARD = { lines, small, look: {...} } を card-*.html が決める。
 * window.drawCard(k)：k=0 がまん中の大きいカード、k=1 が左の小さいカード（render-overlay.mjs が透明な PNG の連番にする）。
 * イラストは、アニメの人物より描き込んだ上半身の絵（portrait）。11/8 夜：依頼主の希望でクオリティ重視に。
 */

/** 上半身の絵。cx, cy は頭の中心。look：{ skin, skinShade, hair, hairLight, top, topShade, long, mood, hand } */
function portrait(cx, cy, s, L) {
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(s, s);
  const HW = 92, HH = 100;
  // 影（足元）
  ctx.fillStyle = "rgba(60,40,10,.10)"; ctx.beginPath(); ctx.ellipse(0, 330, 150, 22, 0, 0, Math.PI * 2); ctx.fill();
  // 後ろ髪
  if (L.long) {
    const g = ctx.createLinearGradient(0, -80, 0, 220); g.addColorStop(0, L.hair); g.addColorStop(1, L.hairLight);
    ctx.fillStyle = g; ctx.beginPath();
    ctx.moveTo(-HW - 4, -20); ctx.bezierCurveTo(-HW - 40, 80, -HW - 30, 190, -HW + 16, 210);
    ctx.quadraticCurveTo(-HW + 40, 222, -HW + 56, 196); ctx.lineTo(HW - 56, 196);
    ctx.quadraticCurveTo(HW - 40, 222, HW - 16, 210); ctx.bezierCurveTo(HW + 30, 190, HW + 40, 80, HW + 4, -20);
    ctx.closePath(); ctx.fill();
  }
  // 肩と服
  const tg = ctx.createLinearGradient(-160, 140, 160, 330); tg.addColorStop(0, L.top); tg.addColorStop(1, L.topShade);
  ctx.fillStyle = tg; ctx.beginPath();
  ctx.moveTo(-150, 330); ctx.bezierCurveTo(-160, 200, -120, 150, -50, 132);
  ctx.quadraticCurveTo(0, 150, 50, 132); ctx.bezierCurveTo(120, 150, 160, 200, 150, 330); ctx.closePath(); ctx.fill();
  // 服のしわ（うすい線）
  ctx.strokeStyle = "rgba(0,0,0,.08)"; ctx.lineWidth = 3; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-70, 200); ctx.quadraticCurveTo(-60, 260, -74, 330); ctx.moveTo(70, 200); ctx.quadraticCurveTo(60, 260, 74, 330); ctx.stroke();
  // 襟・首
  ctx.fillStyle = L.skinShade; rr(-26, 86, 52, 60, 16); ctx.fill();
  ctx.fillStyle = L.skin; rr(-24, 84, 48, 52, 16); ctx.fill();
  ctx.fillStyle = L.collar || "rgba(255,255,255,.55)"; ctx.beginPath(); ctx.moveTo(-54, 134); ctx.quadraticCurveTo(0, 176, 54, 134); ctx.quadraticCurveTo(0, 158, -54, 134); ctx.fill();
  // 顔
  const fg = ctx.createRadialGradient(-20, -10, 20, 0, 20, 130); fg.addColorStop(0, L.skin); fg.addColorStop(1, L.skinShade);
  ctx.fillStyle = fg; ctx.beginPath(); ctx.ellipse(0, 20, HW, HH, 0, 0, Math.PI * 2); ctx.fill();
  for (const sd of [-1, 1]) { ctx.fillStyle = L.skinShade; ctx.beginPath(); ctx.ellipse(sd * (HW - 2), 34, 12, 18, 0, 0, Math.PI * 2); ctx.fill(); }
  // 前髪（グラデーションと、ハイライトの帯）
  const hg = ctx.createLinearGradient(0, -90, 0, 40); hg.addColorStop(0, L.hairLight); hg.addColorStop(0.55, L.hair); hg.addColorStop(1, L.hair);
  ctx.fillStyle = hg; ctx.beginPath();
  if (L.long) {
    ctx.ellipse(0, -2, HW + 10, HH * 0.86, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(HW + 10, -2); ctx.bezierCurveTo(HW, 40, HW * 0.5, 44, HW * 0.15, 2);
    ctx.bezierCurveTo(-HW * 0.2, 46, -HW * 0.7, 40, -HW - 10, -2);
  } else {
    ctx.ellipse(0, -4, HW + 10, HH * 0.9, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(HW + 10, -4); ctx.bezierCurveTo(HW * 0.9, 30, HW * 0.5, 34, HW * 0.3, 6);
    ctx.bezierCurveTo(0, 40, -HW * 0.4, 26, -HW * 0.55, 0); ctx.bezierCurveTo(-HW * 0.8, 30, -HW, 24, -HW - 10, -4);
  }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = 7; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-56, -44); ctx.quadraticCurveTo(-10, -70, 44, -56); ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,.14)"; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(-30, -20); ctx.quadraticCurveTo(-24, 10, -36, 30); ctx.moveTo(20, -24); ctx.quadraticCurveTo(28, 4, 18, 28); ctx.stroke();
  // 眉・目
  const worried = L.mood === "worried";
  for (const sd of [-1, 1]) {
    const ex = sd * 34, ey = 36;
    ctx.strokeStyle = L.hair; ctx.lineWidth = 4; ctx.globalAlpha = 0.85; ctx.beginPath();
    if (worried) { ctx.moveTo(ex - sd * 16, 12); ctx.quadraticCurveTo(ex, 6, ex + sd * 14, 18); }
    else { ctx.moveTo(ex - 16, 14); ctx.quadraticCurveTo(ex, 6, ex + 16, 14); }
    ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(ex, ey, 16, 13, 0, 0, Math.PI * 2); ctx.fill();
    const ig = ctx.createRadialGradient(ex, ey + 2, 2, ex, ey + 2, 11); ig.addColorStop(0, "#5a3a2a"); ig.addColorStop(1, "#2b1a12");
    ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(ex, ey + 2, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1a1012"; ctx.beginPath(); ctx.arc(ex, ey + 3, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex + 4, ey - 2, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(ex - 4, ey + 6, 1.6, 0, Math.PI * 2); ctx.fill();
    // まぶたの線とまつ毛
    ctx.strokeStyle = "#2a1a14"; ctx.lineWidth = 3.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(ex, ey + 1, 16, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
    ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(ex + sd * 15, ey - 4); ctx.lineTo(ex + sd * 21, ey - 10); ctx.stroke();
  }
  // 鼻・口・頬
  ctx.strokeStyle = L.skinShade; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(2, 62, 7, Math.PI * 0.2, Math.PI * 0.8); ctx.stroke();
  ctx.strokeStyle = "#b85c50"; ctx.lineWidth = 3.5; ctx.beginPath();
  if (worried) ctx.arc(0, 98, 11, Math.PI * 1.15, Math.PI * 1.85); else ctx.arc(0, 78, 12, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  for (const sd of [-1, 1]) { const bg = ctx.createRadialGradient(sd * 58, 68, 2, sd * 58, 68, 22); bg.addColorStop(0, "rgba(245,120,110,.45)"); bg.addColorStop(1, "rgba(245,120,110,0)"); ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(sd * 58, 68, 22, 0, Math.PI * 2); ctx.fill(); }
  // 手（こめかみ／胸）
  if (L.hand === "temple" || L.hand === "chest") {
    const hx = L.hand === "temple" ? 96 : 10, hy = L.hand === "temple" ? 20 : 190;
    // 腕（袖）
    ctx.strokeStyle = L.topShade; ctx.lineWidth = 46; ctx.lineCap = "round"; ctx.beginPath();
    if (L.hand === "temple") { ctx.moveTo(130, 330); ctx.quadraticCurveTo(190, 200, 120, 60); } else { ctx.moveTo(140, 330); ctx.quadraticCurveTo(140, 230, 40, 200); }
    ctx.stroke();
    ctx.fillStyle = L.skin; ctx.beginPath(); ctx.ellipse(hx, hy, 24, 30, L.hand === "temple" ? -0.5 : 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = L.skinShade;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(hx - 12 + i * 12, hy - (L.hand === "temple" ? 26 : -24), 6, 14, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = L.skin; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(hx - 12 + i * 12, hy - (L.hand === "temple" ? 24 : -22), 5, 12, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  if (worried) {
    // 汗と、ぐるぐる
    ctx.fillStyle = "#8fd0f4"; ctx.beginPath(); ctx.moveTo(-HW - 2, -30); ctx.quadraticCurveTo(-HW - 22, -2, -HW - 10, 10); ctx.quadraticCurveTo(-HW + 6, 12, -HW + 2, -8); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(90,110,140,.7)"; ctx.lineWidth = 4; ctx.beginPath();
    for (let a = 0; a < Math.PI * 5; a += 0.2) { const r = 6 + a * 2.2; const px = 150 + Math.cos(a) * r, py = -90 + Math.sin(a) * r * 0.8; a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
    ctx.stroke();
  }
  ctx.restore();
}

function drawCard(k) {
  const e = easeInOut(clamp(k));
  const card = window.CARD;
  const x = lerp(520, 22, e), y = lerp(230, 160, e), w = lerp(880, 352, e), h = lerp(440, 600, e);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  shadowed(() => { ctx.fillStyle = "#fff8e8"; rr(x, y, w, h, lerp(28, 18, e)); ctx.fill(); });
  ctx.fillStyle = "#f0a020";
  alpha(1 - e, () => { rr(x, y, w, 12, 6); ctx.fill(); });
  alpha(e, () => { rr(x, y, 10, h, 5); ctx.fill(); });
  ctx.save(); rr(x, y, w, h, lerp(28, 18, e)); ctx.clip();
  text(card.title || "デモの患者さん（架空）", x + lerp(50, 30, e), y + lerp(62, 36, e), lerp(32, 22, e), "#9a6400", 800, "left");
  const lines = e < 0.5 ? card.lines : card.small;
  lines.forEach((line, i) => {
    text(line, x + lerp(50, 30, e), y + lerp(132, 82, e) + i * lerp(72, 44, e), i === 0 ? lerp(52, 30, e) : lerp(42, 26, e), "#3b2a00", i === 0 ? 800 : 700, "left");
  });
  // 患者さんの絵：大きいカードでは右側、小さいカードでは下の余白
  portrait(lerp(x + w - 210, x + w / 2, e), lerp(y + 150, y + 370, e), lerp(0.9, 0.66, e), card.look);
  ctx.restore();
  ctx.restore();
}
window.drawCard = drawCard;
