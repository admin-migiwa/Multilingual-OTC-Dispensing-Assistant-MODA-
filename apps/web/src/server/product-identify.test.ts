import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AiError, createAiClient, type AiClient, type AiRequest } from "./ai/index.ts";
import { identifyFromPhoto, identifyFromText, MAX_IMAGE_BASE64_LENGTH } from "./product-identify.ts";
import { isAmbiguous, matchProducts, normalizeName, type ProductCandidate } from "./product-match.ts";
import { SessionServiceError } from "./session-service.ts";

/**
 * 商品名は docs/demo-data/drugs.md の ☑ の架空の薬（取扱薬 A〜J、取扱外 X1〜X3）だけを使う。
 * 写真の読み取りは、決まった答えを返す「テスト用の AI」で作る（本物の AI は呼ばない）。
 */

const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function fakeAi(answer: unknown): AiClient & { calls: AiRequest[] } {
  const calls: AiRequest[] = [];
  return {
    provider: "anthropic",
    calls,
    async generateJson(request) {
      calls.push(request);
      return answer;
    },
  };
}

function ids(names: string[]): string[] {
  return matchProducts(names).map((candidate) => candidate.drugId);
}

describe("商品名の照らし合わせ", () => {
  it("表の名前と同じなら、その薬がいちばん上に出る（モダペインS錠 → C）", () => {
    assert.equal(ids(["モダペインS錠"])[0], "C");
  });

  it("「（架空）」や「錠」がなくても、空白や全角・半角が違っても当たる", () => {
    assert.equal(ids(["モダペイン Ｓ"])[0], "C");
    assert.equal(ids(["ﾓﾀﾞかぜプロ錠"])[0], "B");
  });

  it("ひらがなとカタカナの違いは同じとみなす", () => {
    assert.equal(normalizeName("モダいぐすり散"), normalizeName("もだイグスリ散"));
  });

  it("名前の前後に容量などの文字があっても当たる（モダかぜゴールド錠 210錠 → E）", () => {
    assert.equal(ids(["モダかぜゴールド錠 210錠"])[0], "E");
  });

  it("似た名前（モダペインS と モダペインA）は、名前が同じほうを上に出す", () => {
    const result = ids(["モダペインA錠"]);
    assert.equal(result[0], "D");
  });

  it("店で扱っていない薬（モダかぜナイト錠 → X1）は、取扱外として出る", () => {
    const [first] = matchProducts(["モダかぜナイト錠"]);
    assert.ok(first);
    assert.equal(first.drugId, "X1");
    assert.equal(first.stocked, false);
  });

  it("表にない名前には候補を出さない", () => {
    assert.deepEqual(ids(["ビタミンドリンク"]), []);
  });

  it("名前の一部しか読めず、S と A のどちらか決めにくいときは「決めにくい」と知らせる（モダペイン → C と D）", () => {
    const result = identifyFromText("モダペイン");
    assert.equal(result.ambiguous, true);
    assert.deepEqual(result.candidates.slice(0, 2).map((c) => c.drugId).sort(), ["C", "D"]);
  });

  it("名前が同じときは「決めにくい」にしない（モダペインS錠）", () => {
    assert.equal(identifyFromText("モダペインS錠").ambiguous, false);
  });

  it("点数の差がちょうど 0.05 のときも「決めにくい」にする（小数の誤差で外れない）", () => {
    const c = (drugId: string, score: number): ProductCandidate => ({ drugId, name: drugId, stocked: true, score, matchedText: "" });
    assert.equal(isAmbiguous([c("X2", 0.67), c("C", 0.62)]), true);
    assert.equal(isAmbiguous([c("F", 0.97), c("X3", 0.92)]), true);
    assert.equal(isAmbiguous([c("F", 0.97), c("X3", 0.91)]), false);
  });

  it("名前が完全に同じでなければ「完全には一致しない」と知らせる（モダシップクール → H だが、完全一致ではない）", () => {
    const exact = identifyFromText("モダシップ");
    assert.equal(exact.exactMatch, true);
    const partial = identifyFromText("モダシップクール");
    assert.equal(partial.candidates[0]?.drugId, "H");
    assert.equal(partial.exactMatch, false);
  });

  it("候補は3つまで", () => {
    assert.ok(matchProducts(["モダ"]).length <= 3);
  });
});

describe("名前の入力から候補を出す（決まったこと No.35：写真が使えないとき）", () => {
  it("入力した名前から候補を出す", () => {
    const result = identifyFromText("モダシップ");
    assert.equal(result.source, "text");
    assert.equal(result.candidates[0]?.drugId, "H");
  });

  it("空の名前・長すぎる名前は止める", () => {
    assert.throws(() => identifyFromText("  "), SessionServiceError);
    assert.throws(() => identifyFromText("あ".repeat(101)), SessionServiceError);
  });
});

describe("写真から商品名を読む", () => {
  it("同意がなければ AI に送らない（決まったこと No.27）", async () => {
    const ai = fakeAi({ readable: true, productNames: ["モダシップ"] });
    await assert.rejects(
      identifyFromPhoto(ai, { consent: false, mediaType: "image/png", base64: TINY_PNG }),
      SessionServiceError,
    );
    assert.equal(ai.calls.length, 0);
  });

  it("読んだ商品名から候補を出す（読んだ名前は候補と一緒に返す）", async () => {
    const ai = fakeAi({ readable: true, productNames: ["モダアイクリア"] });
    const result = await identifyFromPhoto(ai, { consent: true, mediaType: "image/png", base64: TINY_PNG });
    assert.equal(result.candidates[0]?.drugId, "G");
    assert.equal(result.exactMatch, true);
    const call = ai.calls[0];
    assert.ok(call);
    assert.equal(call.task, "read_product");
    assert.equal(call.content[0]?.type, "image");
  });

  it("写真から読んだ文字は画面に返さない（名前や電話番号が商品名と一緒に読まれても、表の商品名だけを返す）", async () => {
    const ai = fakeAi({ readable: true, productNames: ["山田花子 090-1234 モダシップ", "新着メッセージ"] });
    const result = await identifyFromPhoto(ai, { consent: true, mediaType: "image/png", base64: TINY_PNG });
    assert.deepEqual(result.productNames, []);
    assert.equal(result.candidates[0]?.drugId, "H");
    assert.equal(result.candidates[0]?.matchedText, "モダシップ（架空）");
    assert.ok(!JSON.stringify(result).includes("090"));
    assert.ok(!JSON.stringify(result).includes("新着"));
  });

  it("40文字を超える読み取りは、商品名以外が混じっているとみなして止める", async () => {
    const ai = fakeAi({ readable: true, productNames: ["あ".repeat(41)] });
    await assert.rejects(
      identifyFromPhoto(ai, { consent: true, mediaType: "image/png", base64: TINY_PNG }),
      (err: unknown) => err instanceof AiError && err.code === "AI_INVALID_OUTPUT",
    );
  });

  it("読めなかったら候補は空（推測で出さない）", async () => {
    const ai = fakeAi({ readable: false, productNames: [] });
    const result = await identifyFromPhoto(ai, { consent: true, mediaType: "image/png", base64: TINY_PNG });
    assert.equal(result.readable, false);
    assert.deepEqual(result.candidates, []);
  });

  it("AI が決めていない項目（成分の推測など）を返したら止める", async () => {
    const ai = fakeAi({ readable: true, productNames: ["モダシップ"], ingredients: ["T1"] });
    await assert.rejects(
      identifyFromPhoto(ai, { consent: true, mediaType: "image/png", base64: TINY_PNG }),
      (err: unknown) => err instanceof AiError && err.code === "AI_INVALID_OUTPUT",
    );
  });

  it("対応していない形式・大きすぎる写真・base64 でないものは止める", async () => {
    const ai = fakeAi({ readable: true, productNames: [] });
    const cases = [
      { mediaType: "image/gif", base64: TINY_PNG },
      { mediaType: "image/png", base64: "A".repeat(MAX_IMAGE_BASE64_LENGTH + 4) },
      { mediaType: "image/png", base64: "これは写真ではない" },
      // PNG なのに JPEG と名乗っている
      { mediaType: "image/jpeg", base64: TINY_PNG },
      // base64 の長さが4の倍数でない
      { mediaType: "image/png", base64: TINY_PNG.slice(0, -1) },
    ];
    for (const input of cases) {
      await assert.rejects(identifyFromPhoto(ai, { consent: true, ...input }), SessionServiceError);
    }
    assert.equal(ai.calls.length, 0);
  });

  it("仮の AI は写真を読まない（読めなかったときの流れになる）", async () => {
    const result = await identifyFromPhoto(createAiClient({}), { consent: true, mediaType: "image/png", base64: TINY_PNG });
    assert.equal(result.readable, false);
    assert.equal(result.provider, "mock");
  });
});
