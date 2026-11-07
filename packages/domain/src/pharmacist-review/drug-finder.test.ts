/**
 * 候補の薬の絞り込み（症状の分類・検索）のテスト。
 * 症状の分類は docs/demo-data/symptom-categories.md の ☑ の行（SC1〜SC6）から、
 * 検索は docs/demo-data/drugs.md の ☑ の取扱薬の表（商品名・区分・効き目の分類・成分）から作る。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EFFICACY_CATEGORIES, STOCKED_DRUGS, type StockedDrugId } from "../contraindication/data.ts";
import { DomainRuleError } from "../errors.ts";
import {
  SYMPTOM_CATEGORIES,
  drugMatchesSearch,
  matchingSymptomCategories,
  visibleCandidates,
  type SymptomCategoryId,
} from "./drug-finder.ts";

const ALL_IDS = STOCKED_DRUGS.map((d) => d.id);

function drugsFor(selected: readonly SymptomCategoryId[]): StockedDrugId[] {
  return ALL_IDS.filter((id) => matchingSymptomCategories(id, selected).length > 0);
}

function searched(query: string): StockedDrugId[] {
  return ALL_IDS.filter((id) => drugMatchesSearch(id, query));
}

describe("症状の分類に合う薬（symptom-categories.md）", () => {
  const table: [SymptomCategoryId, StockedDrugId[]][] = [
    ["SC1", ["B", "E", "J"]],
    ["SC2", ["C", "D", "I"]],
    ["SC3", ["F"]],
    ["SC4", ["G"]],
    ["SC5", ["H"]],
    ["SC6", ["A"]],
  ];
  for (const [sc, expected] of table) {
    it(`${sc} を押すと ${expected.join("・")} だけに印が付く`, () => {
      assert.deepEqual(drugsFor([sc]), expected);
    });
  }

  it("表の分類は SC1〜SC6 の6つで、取扱薬はどれか1つの分類に当たる", () => {
    assert.deepEqual(
      SYMPTOM_CATEGORIES.map((s) => s.id),
      ["SC1", "SC2", "SC3", "SC4", "SC5", "SC6"],
    );
    for (const id of ALL_IDS) {
      assert.equal(matchingSymptomCategories(id, ["SC1", "SC2", "SC3", "SC4", "SC5", "SC6"]).length, 1, id);
    }
  });

  it("複数押すと、どれかに合う薬に印が付き、合った分類を返す", () => {
    assert.deepEqual(drugsFor(["SC1", "SC2"]), ["B", "C", "D", "E", "I", "J"]);
    assert.deepEqual(
      matchingSymptomCategories("C", ["SC1", "SC2"]).map((s) => s.id),
      ["SC2"],
    );
  });

  it("表の効き目の分類を合わせると、薬の表の効き目の分類がすべてそろう（どの取扱薬も、どれかのボタンで見つかる）", () => {
    const covered = new Set(SYMPTOM_CATEGORIES.flatMap((s) => s.efficacyCategories));
    assert.deepEqual([...covered].sort(), [...EFFICACY_CATEGORIES].sort());
  });

  it("取扱薬にない記号は UNKNOWN_DRUG で止まる", () => {
    assert.throws(
      () => matchingSymptomCategories("Z" as StockedDrugId, ["SC1"]),
      (e: unknown) => e instanceof DomainRuleError && e.code === "UNKNOWN_DRUG",
    );
  });

  it("何も押していなければ、どの薬にも印が付かない", () => {
    assert.deepEqual(drugsFor([]), []);
  });
});

describe("薬の検索（drugs.md の取扱薬の表）", () => {
  it("商品名の一部で探せる", () => {
    assert.deepEqual(searched("ペイン"), ["C", "D"]);
  });

  it("成分の記号で探せる（全角・小文字でも同じ）", () => {
    assert.deepEqual(searched("N1"), ["B", "C"]);
    assert.deepEqual(searched("ｎ１"), ["B", "C"]);
  });

  it("成分の種類で探せる", () => {
    assert.deepEqual(searched("抗ヒスタミン"), ["B", "E"]);
  });

  it("効き目の分類で探せる", () => {
    assert.deepEqual(searched("解熱鎮痛"), ["B", "C", "D", "E", "I"]);
  });

  it("区分で探せる", () => {
    assert.deepEqual(searched("第1類"), ["C"]);
  });

  it("表に「ほか」とだけ書かれた成分では見つからない（F の制酸成分 G1 は見つかる）", () => {
    assert.deepEqual(searched("G1"), ["F"]);
    assert.deepEqual(searched("ほか"), []);
  });

  it("空の検索はすべての薬に合い、どこにもない文字はどの薬にも合わない", () => {
    assert.deepEqual(searched("  "), ALL_IDS);
    assert.deepEqual(searched("存在しない薬"), []);
  });
});

describe("絞り込みのあとに表示する候補", () => {
  // previewCandidates の並び（禁忌でない順）のつもりで、表の順と違う順に並べておく
  const order: StockedDrugId[] = ["I", "J", "F", "C", "A", "B", "D", "E", "G", "H"];
  const candidates = order.map((drugId) => ({ drugId }));
  const ids = (list: { drugId: StockedDrugId }[]) => list.map((c) => c.drugId);

  it("何も押さず検索も空（空白だけ）なら、すべてを渡した順のまま出す", () => {
    assert.deepEqual(ids(visibleCandidates(candidates, { symptomIds: [], query: " ", keepDrugIds: [] })), order);
  });

  it("症状の分類で絞っても、並び順は渡した順のまま", () => {
    assert.deepEqual(ids(visibleCandidates(candidates, { symptomIds: ["SC2"], query: "", keepDrugIds: [] })), ["I", "C", "D"]);
  });

  it("症状の分類と検索の両方に合う薬だけを出す", () => {
    assert.deepEqual(ids(visibleCandidates(candidates, { symptomIds: ["SC1"], query: "抗ヒスタミン", keepDrugIds: [] })), ["B", "E"]);
  });

  it("チェックした薬・いま選んでいる薬は、条件に合わなくても隠さない", () => {
    assert.deepEqual(ids(visibleCandidates(candidates, { symptomIds: ["SC4"], query: "", keepDrugIds: ["A", "H"] })), ["A", "G", "H"]);
  });
});
