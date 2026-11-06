/**
 * T12 の確かめ：自作の架空パッケージ画像5枚（docs/demo-data/photos）を本物の AI に読ませ、
 * 正しい薬がいちばん上の候補に出るかを数える（spec.md の完了条件：5枚のうち4枚以上）。
 *
 * 動かし方（apps/web で）：pnpm eval:photos
 * - .env.local の AI_PROVIDER=anthropic と ANTHROPIC_API_KEY を使う。1回で5回 AI を呼ぶ。
 * - 画像は架空の商品だけ。結果には読み取った商品名と候補の記号だけを出す。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createAiClient } from "../src/server/ai/index.ts";
import { identifyFromPhoto } from "../src/server/product-identify.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const photoDir = path.resolve(here, "../../../docs/demo-data/photos");

/** 画像と正しい薬（docs/demo-data/photos/README.md の表と同じ） */
const CASES: ReadonlyArray<{ file: string; expected: string }> = [
  { file: "p1-box-front.jpg", expected: "C" },
  { file: "p2-phone-screen.jpg", expected: "E" },
  { file: "p3-tilted-box.jpg", expected: "G" },
  { file: "p4-busy-label.jpg", expected: "H" },
  { file: "p5-glare.jpg", expected: "F" },
];

const ai = createAiClient(process.env);
if (ai.provider !== "anthropic") {
  console.error("AI_PROVIDER=anthropic にしてください（仮の AI では写真を読みません）");
  process.exit(1);
}

let correct = 0;
for (const { file, expected } of CASES) {
  const base64 = readFileSync(path.join(photoDir, file)).toString("base64");
  try {
    const result = await identifyFromPhoto(ai, { consent: true, mediaType: "image/jpeg", base64 });
    const top = result.candidates[0]?.drugId ?? "なし";
    const ok = top === expected;
    if (ok) correct += 1;
    const ids = result.candidates.map((candidate) => candidate.drugId).join(",") || "なし";
    process.stdout.write(
      `${ok ? "○" : "×"} ${file}：候補 ${ids}（正解 ${expected}${result.exactMatch ? "、名前が完全に一致" : "、名前は完全には一致しない"}）\n`,
    );
  } catch (error: unknown) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "不明";
    process.stdout.write(`× ${file}：エラー ${code}\n`);
  }
}
process.stdout.write(`\n正しい候補がいちばん上に出た枚数：${correct} / ${CASES.length}（4枚以上で合格）\n`);
process.exit(correct >= 4 ? 0 : 1);
