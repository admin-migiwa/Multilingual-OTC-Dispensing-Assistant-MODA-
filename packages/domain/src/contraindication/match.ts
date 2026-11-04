/**
 * 「店にない商品」と取扱薬の照合（design.md 8節の6）。
 *
 * 照合の段階：同一成分 → 主成分一致 → 同効分類。
 * - 同一成分の取扱薬があれば、それだけを候補にする（そのまま代わりになるため）。
 * - なければ、主成分一致と同効分類の取扱薬を、この順に並べる（同じ薬は上の段階で1回だけ）。
 * - 主成分は、成分の先頭に書いたものとする。
 * - 「ほか」の成分がある薬は、成分の全部がわからないので同一成分にはしない。
 * 候補は薬剤師の画面にだけ出す（決まったこと No.16）。
 */

import { STOCKED_DRUGS, type EfficacyCategory, type IngredientId, type StockedDrug, type StockedDrugId } from "./data.ts";

export type MatchLevel = "same_ingredients" | "same_main_ingredient" | "same_category";

export type ShownDrug = {
  ingredients: readonly IngredientId[];
  hasUnlistedIngredients: boolean;
  category: EfficacyCategory;
};

export type MatchCandidate = {
  drugId: StockedDrugId;
  level: MatchLevel;
};

function sameIngredients(a: ShownDrug, b: StockedDrug): boolean {
  if (a.hasUnlistedIngredients || b.hasUnlistedIngredients) return false;
  const setA = new Set(a.ingredients);
  const setB = new Set(b.ingredients);
  return setA.size === setB.size && [...setA].every((i) => setB.has(i));
}

function sameMainIngredient(a: ShownDrug, b: StockedDrug): boolean {
  const mainA = a.ingredients[0];
  return mainA !== undefined && mainA === b.ingredients[0];
}

export function matchStockedDrugs(
  shown: ShownDrug,
  stocked: readonly StockedDrug[] = STOCKED_DRUGS,
): MatchCandidate[] {
  const exact = stocked.filter((d) => sameIngredients(shown, d));
  if (exact.length > 0) return exact.map((d) => ({ drugId: d.id, level: "same_ingredients" }));

  const candidates: MatchCandidate[] = [];
  const added = new Set<StockedDrugId>();
  for (const d of stocked) {
    if (sameMainIngredient(shown, d)) {
      candidates.push({ drugId: d.id, level: "same_main_ingredient" });
      added.add(d.id);
    }
  }
  for (const d of stocked) {
    if (!added.has(d.id) && d.category === shown.category) {
      candidates.push({ drugId: d.id, level: "same_category" });
    }
  }
  return candidates;
}
