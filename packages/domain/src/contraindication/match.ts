/**
 * 「店にない商品」と取扱薬の照合（design.md 8節の6。11/5 薬剤師の判断で5段階に見直し）。
 *
 * 照合の段階（上ほど近い）：
 *   1. まったく同じ成分 … あれば、それだけを候補にする（そのまま代わりになるため）
 *   2. 同じ成分をすべて含む
 *   3. 同系統の成分構成（成分の系統の組み合わせが同じ）
 *   4. 同系統の成分を含む（効き目の分類は問わない）
 *   5. 同じ効き目の分類
 * - 同じ薬は、いちばん上の段階で1回だけ出す。同じ段階の中は取扱薬の並び順。
 * - 「ほか」の成分がある薬は、成分の全部がわからないので 1・3 にはしない（見せられた薬なら 2 もしない）。
 * - 配合剤（成分が2つ以上、または「ほか」がある）のときは、主訴の確認を促す印を付ける。
 * 候補は薬剤師の画面にだけ出す（決まったこと No.16）。
 */

import {
  INGREDIENTS,
  STOCKED_DRUGS,
  type EfficacyCategory,
  type IngredientGroup,
  type IngredientId,
  type StockedDrug,
  type StockedDrugId,
} from "./data.ts";

export const MATCH_LEVELS = [
  "same_ingredients",
  "contains_all_ingredients",
  "same_group_composition",
  "shares_group",
  "same_category",
] as const;
export type MatchLevel = (typeof MATCH_LEVELS)[number];

export type ShownDrug = {
  ingredients: readonly IngredientId[];
  hasUnlistedIngredients: boolean;
  category: EfficacyCategory;
};

export type MatchCandidate = {
  drugId: StockedDrugId;
  level: MatchLevel;
};

export type MatchResult = {
  candidates: MatchCandidate[];
  /** 配合剤なので、患者さんの主訴（どの症状に使いたいか）を薬剤師が確認する */
  needsChiefComplaintCheck: boolean;
};

type Drugish = { ingredients: readonly IngredientId[]; hasUnlistedIngredients: boolean };

const groupsOf = (d: Drugish): Set<IngredientGroup> => new Set(d.ingredients.map((i) => INGREDIENTS[i].group));

function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

const complete = (d: Drugish): boolean => !d.hasUnlistedIngredients;

const LEVEL_TESTS: Readonly<Record<MatchLevel, (shown: ShownDrug, stocked: StockedDrug) => boolean>> = {
  same_ingredients: (a, b) =>
    complete(a) && complete(b) && sameSet(new Set(a.ingredients), new Set(b.ingredients)),
  contains_all_ingredients: (a, b) => complete(a) && a.ingredients.every((i) => b.ingredients.includes(i)),
  same_group_composition: (a, b) => complete(a) && complete(b) && sameSet(groupsOf(a), groupsOf(b)),
  shares_group: (a, b) => {
    const groups = groupsOf(b);
    return [...groupsOf(a)].some((g) => groups.has(g));
  },
  same_category: (a, b) => a.category === b.category,
};

export function matchStockedDrugs(
  shown: ShownDrug,
  stocked: readonly StockedDrug[] = STOCKED_DRUGS,
): MatchResult {
  const needsChiefComplaintCheck = shown.ingredients.length >= 2 || shown.hasUnlistedIngredients;

  const exact = stocked.filter((d) => LEVEL_TESTS.same_ingredients(shown, d));
  if (exact.length > 0) {
    return {
      candidates: exact.map((d) => ({ drugId: d.id, level: "same_ingredients" })),
      needsChiefComplaintCheck,
    };
  }

  const candidates: MatchCandidate[] = [];
  const added = new Set<StockedDrugId>();
  for (const level of MATCH_LEVELS) {
    for (const d of stocked) {
      if (!added.has(d.id) && LEVEL_TESTS[level](shown, d)) {
        candidates.push({ drugId: d.id, level });
        added.add(d.id);
      }
    }
  }
  return { candidates, needsChiefComplaintCheck };
}
