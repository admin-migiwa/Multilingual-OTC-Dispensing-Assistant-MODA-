/**
 * 「店にない商品」の照合のテスト。contraindication-tests.md の M01〜M03（☑）から作る。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { UNSTOCKED_DRUGS } from "./data.ts";
import { matchStockedDrugs } from "./match.ts";

const shown = (id: string) => {
  const drug = UNSTOCKED_DRUGS.find((d) => d.id === id);
  assert.ok(drug, `取扱外の薬 ${id} がデータにない`);
  return drug;
};

describe("店にない商品の照合（contraindication-tests.md の ☑ の行）", () => {
  it("M01 X1 を見せられたら、同一成分の B だけが候補に出る", () => {
    assert.deepEqual(matchStockedDrugs(shown("X1")), [{ drugId: "B", level: "same_ingredients" }]);
  });

  it("M02 X2 を見せられたら、主成分一致の D、同効分類の C・I の順で候補に出る", () => {
    assert.deepEqual(matchStockedDrugs(shown("X2")), [
      { drugId: "D", level: "same_main_ingredient" },
      { drugId: "C", level: "same_category" },
      { drugId: "I", level: "same_category" },
    ]);
  });

  it("M03 X3 を見せられたら、同効分類の F が候補に出る", () => {
    assert.deepEqual(matchStockedDrugs(shown("X3")), [{ drugId: "F", level: "same_category" }]);
  });
});
