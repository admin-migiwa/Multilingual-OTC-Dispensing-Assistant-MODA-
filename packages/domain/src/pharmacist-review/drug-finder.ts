/**
 * 薬剤師の画面で、候補の薬を「症状の分類」と「検索の文字」で絞り込むためのルール（docs/backlog.md C-16）。
 *
 * - 症状の分類は、薬剤師が症状の原文を見て押す。AI も仕組みも、症状の文から分類を決めない（決まったこと No.22・ルール10）。
 * - 症状の分類と効き目の分類の対応は docs/demo-data/symptom-categories.md（11/8 薬剤師確認済み）のデータ。
 * - 絞り込みは表示のためだけ。禁忌の判定・選んだ薬の検証は変えない（ルール4。サーバーの chooseCandidateDrugs のまま）。
 */

import { INGREDIENTS, type EfficacyCategory, type StockedDrugId } from "../contraindication/data.ts";
import { findStockedDrug } from "../contraindication/judge.ts";

export type SymptomCategoryId = "SC1" | "SC2" | "SC3" | "SC4" | "SC5" | "SC6";

export type SymptomCategory = {
  readonly id: SymptomCategoryId;
  /** 薬剤師の画面のボタンの文字 */
  readonly label: string;
  /** 対応する効き目の分類（drugs.md の取扱薬の列） */
  readonly efficacyCategories: readonly EfficacyCategory[];
};

/** docs/demo-data/symptom-categories.md の表（11/8 薬剤師確認済み） */
export const SYMPTOM_CATEGORIES: readonly SymptomCategory[] = [
  { id: "SC1", label: "かぜの症状（熱・せき・鼻水・のどの痛み など）", efficacyCategories: ["かぜ薬（総合）", "かぜ薬（漢方）"] },
  { id: "SC2", label: "熱・痛み（頭痛・歯痛・生理痛 など）", efficacyCategories: ["解熱鎮痛薬"] },
  { id: "SC3", label: "胃の不快感（胸やけ・胃もたれ など）", efficacyCategories: ["胃腸薬（制酸）"] },
  { id: "SC4", label: "目の症状（充血・疲れ目 など）", efficacyCategories: ["点眼薬"] },
  { id: "SC5", label: "肩こり・腰痛・筋肉痛・打撲 など", efficacyCategories: ["外用消炎鎮痛薬"] },
  { id: "SC6", label: "緊急避妊", efficacyCategories: ["緊急避妊薬"] },
];

/** 取扱薬にない記号なら UNKNOWN_DRUG で止まる */
const stockedDrug = findStockedDrug;

/** 薬剤師が押した症状の分類のうち、この薬の効き目の分類に合うもの（合わなければ空） */
export function matchingSymptomCategories(
  drugId: StockedDrugId,
  selected: readonly SymptomCategoryId[],
): SymptomCategory[] {
  const { category } = stockedDrug(drugId);
  return SYMPTOM_CATEGORIES.filter((sc) => selected.includes(sc.id) && sc.efficacyCategories.includes(category));
}

/** 比べるときの文字をそろえる（全角の英数字を半角に、英字は大文字に、空白は取り除く） */
function normalize(text: string): string {
  return text.normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

/**
 * 検索の文字が、この薬の商品名・区分・効き目の分類・成分名・成分の種類のどれかに含まれるか。
 * 空の検索（空白だけを含む）は、すべての薬に合う。
 * 表に「ほか」とだけ書かれた成分（F・G・H の未記載の成分）では見つからない（データにない成分は探さない）。
 * 文字のそろえ方は、全角半角・英字の大小・空白だけ（ひらがな・カタカナの違いはそろえない。backlog C-19）。
 */
export function drugMatchesSearch(drugId: StockedDrugId, query: string): boolean {
  const q = normalize(query);
  if (q === "") return true;
  const drug = stockedDrug(drugId);
  const texts = [
    drug.name,
    drug.classification,
    drug.category,
    ...drug.ingredients.flatMap((id) => [id, INGREDIENTS[id].name, INGREDIENTS[id].kind]),
  ];
  return texts.some((t) => normalize(t).includes(q));
}

/**
 * 絞り込みのあとに表示する候補（並び順は渡した順のまま。previewCandidates の「禁忌でない順」を崩さない）。
 * - 症状の分類を1つも押していなければ、分類では絞らない。検索が空なら、検索では絞らない（既定はすべて表示）。
 * - チェックした薬・いま選んでいる薬は、条件に合わなくても隠さない（選んだまま見えなくならないように）。
 */
export function visibleCandidates<T extends { readonly drugId: StockedDrugId }>(
  candidates: readonly T[],
  filter: {
    readonly symptomIds: readonly SymptomCategoryId[];
    readonly query: string;
    readonly keepDrugIds: readonly StockedDrugId[];
  },
): T[] {
  return candidates.filter(
    (c) =>
      filter.keepDrugIds.includes(c.drugId) ||
      (drugMatchesSearch(c.drugId, filter.query) &&
        (filter.symptomIds.length === 0 || matchingSymptomCategories(c.drugId, filter.symptomIds).length > 0)),
  );
}
