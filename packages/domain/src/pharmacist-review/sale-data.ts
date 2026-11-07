import type { SalesCategory } from "../sales-procedure/data.ts";
import type { StockedDrugId } from "../contraindication/data.ts";

/**
 * 取扱薬ごとの、販売手順の判定に使う情報（区分・効き目の分類・包装の量・1日の最大量）。
 *
 * 中身は docs/demo-data/drugs.md の「取扱薬」の表（区分・効き目の分類）と、
 * docs/demo-data/sales-procedures.md の「架空の薬への当てはめ」の表（包装・1日の最大量）の写し（どちらも薬剤師確認済み）。
 * 手順そのものは sales-procedure/data.ts の版のデータが持つ（CLAUDE.md 絶対に守るルール5）。
 * 包装の量と1日の最大量は、数量基準を使う指定濫用防止医薬品（B・E）だけに入れる。
 */
export interface SalePackage {
  /** 1包装の量（錠） */
  readonly amount: number;
}

export interface DrugSaleData {
  readonly categories: readonly SalesCategory[];
  /** 効き目の分類（drugs.md の名前） */
  readonly efficacyClass: string;
  /** 用法どおりの1日の最大量（錠）。指定濫用防止医薬品だけ */
  readonly maxDailyAmount?: number;
  /** 包装。指定濫用防止医薬品だけ。E は小箱と大箱がある */
  readonly packages?: { readonly small: SalePackage; readonly large?: SalePackage };
}

export const DRUG_SALE_DATA: Readonly<Record<StockedDrugId, DrugSaleData>> = {
  A: { categories: ["specified_requires_guidance"], efficacyClass: "緊急避妊薬" },
  B: {
    categories: ["requires_guidance", "abuse_prevention"],
    efficacyClass: "かぜ薬（総合）",
    maxDailyAmount: 6,
    packages: { small: { amount: 12 } },
  },
  C: { categories: ["first_class"], efficacyClass: "解熱鎮痛薬" },
  D: { categories: ["designated_second_class"], efficacyClass: "解熱鎮痛薬" },
  E: {
    categories: ["designated_second_class", "abuse_prevention"],
    efficacyClass: "かぜ薬（総合）",
    maxDailyAmount: 9,
    packages: { small: { amount: 60 }, large: { amount: 210 } },
  },
  F: { categories: ["second_class"], efficacyClass: "胃腸薬（制酸）" },
  G: { categories: ["second_class"], efficacyClass: "点眼薬" },
  H: { categories: ["third_class"], efficacyClass: "外用消炎鎮痛薬" },
  I: { categories: ["second_class"], efficacyClass: "解熱鎮痛薬" },
  J: { categories: ["second_class"], efficacyClass: "かぜ薬（漢方）" },
};
