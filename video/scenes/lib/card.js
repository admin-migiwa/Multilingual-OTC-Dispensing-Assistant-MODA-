/*
 * デモの患者さん（架空）のカード。実演の最初はまん中に大きく出し、操作が始まると左の余白へ、大きさと位置をなめらかに変えながら移る。
 * window.CARD = { lines: [...], small: [...], patient: {...}, mood } を card-*.html が決める。
 * window.drawCard(k)：k=0 がまん中の大きいカード、k=1 が左の小さいカード（render-overlay.mjs が透明な PNG の連番にする）。
 */
function drawCard(k) {
  const e = easeInOut(clamp(k));
  const card = window.CARD;
  // 大きいカード（まん中）→ 小さいカード（左の余白。右の「いまの場面」と同じ高さ）
  const x = lerp(520, 22, e), y = lerp(230, 160, e), w = lerp(880, 352, e), h = lerp(440, 600, e);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  shadowed(() => { ctx.fillStyle = "#fff8e8"; rr(x, y, w, h, lerp(28, 18, e)); ctx.fill(); });
  // 飾りの帯：大きいカードは上に、小さいカードは左に（途中は入れ替える）
  ctx.fillStyle = "#f0a020";
  alpha(1 - e, () => { rr(x, y, w, 12, 6); ctx.fill(); });
  alpha(e, () => { rr(x, y, 10, h, 5); ctx.fill(); });
  ctx.save(); rr(x, y, w, h, lerp(28, 18, e)); ctx.clip();
  const title = card.title || "デモの患者さん（架空）";
  text(title, x + lerp(50, 30, e), y + lerp(62, 36, e), lerp(32, 22, e), "#9a6400", 800, "left");
  const lines = e < 0.5 ? card.lines : card.small;
  lines.forEach((line, i) => {
    text(line, x + lerp(50, 30, e), y + lerp(132, 82, e) + i * lerp(72, 44, e), i === 0 ? lerp(52, 30, e) : lerp(42, 26, e), "#3b2a00", i === 0 ? 800 : 700, "left");
  });
  // 患者さんのイメージ（アニメと同じ人物）。大きいカードでは右側、小さいカードでは下の余白
  const px = lerp(x + w - 200, x + w / 2, e), py = lerp(y + 90, y + 300, e), sc = lerp(0.5, 0.5, e);
  person(px, py, { ...card.patient, scale: sc, armL: [0.2, 0.1], armR: card.armR || [0.25, 0.15], mood: card.mood || "neutral", look: 0, sweat: card.sweat || 0 });
  ctx.restore();
  ctx.restore();
}
window.drawCard = drawCard;
