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
  it("M01 配合剤 X1 を見せられたら、まったく同じ成分の B だけが候補に出て、主訴を確認する印が付く", () => {
    assert.deepEqual(matchStockedDrugs(shown("X1")), {
      candidates: [{ drugId: "B", level: "same_ingredients" }],
      needsChiefComplaintCheck: true,
    });
  });

  it("M02 X2 を見せられたら、D（同じ成分を含む）→ C（同系統の構成）→ B（同系統を含む）→ I（同じ効き目の分類）の順で候補に出る", () => {
    assert.deepEqual(matchStockedDrugs(shown("X2")).candidates, [
      { drugId: "D", level: "contains_all_ingredients" },
      { drugId: "C", level: "same_group_composition" },
      { drugId: "B", level: "shares_group" },
      { drugId: "I", level: "same_category" },
    ]);
  });

  it("M03 X3 を見せられたら、同じ制酸の系統を含む F が候補に出る", () => {
    assert.deepEqual(matchStockedDrugs(shown("X3")).candidates, [{ drugId: "F", level: "shares_group" }]);
  });
});
