import { DomainRuleError } from "../errors.ts";

/**
 * 区分ごとの販売手順と数量基準（施行日つきの版）。
 *
 * 手順と数量はプログラムに直書きせず、このデータから読み込む（CLAUDE.md 絶対に守るルール5）。
 * 中身は docs/demo-data/sales-procedures.md（薬剤師確認済み・11/4）の写し。
 * 制度が変わったら、古い版を消さずに新しい版を末尾に足す。
 */

/** 薬の区分。1つの薬が複数の区分を持つことがある（例：要指導＋指定濫用防止） */
export const SALES_CATEGORIES = [
  "requires_guidance", // 要指導医薬品
  "first_class", // 第1類医薬品
  "specified_requires_guidance", // 特定要指導医薬品
  "abuse_prevention", // 指定濫用防止医薬品
  "designated_second_class", // 指定第2類医薬品
  "second_class", // 第2類医薬品
  "third_class", // 第3類医薬品
] as const;

export type SalesCategory = (typeof SALES_CATEGORIES)[number];

/**
 * 手順をいつまでに終えている必要があるか。
 * - before_approval：終わるまで薬剤師が承認できない
 * - before_checkout：承認の後でよいが、終わるまで会計案内に進めない
 *   （決まったこと No.25、demo-data README の決定 5・6）
 */
export type StepGate = "before_approval" | "before_checkout";

/**
 * 手順が必要になる条件。
 * - always：その区分の薬を選んだら必ず
 * - large_or_multiple：大容量の包装、または複数個を選んだとき（数量基準 Q-4）
 * - under_18：18歳未満のとき（P04）
 */
export type StepCondition = "always" | "large_or_multiple" | "under_18";

export interface ProcedureStepDefinition {
  readonly id: string;
  /** 薬剤師の画面に出す名前（日本語） */
  readonly label: string;
  readonly gate: StepGate;
  readonly condition: StepCondition;
}

export interface CategoryRule {
  /** sales-procedures.md の ID（P01〜P07） */
  readonly ruleId: string;
  readonly category: SalesCategory;
  /** この区分で必要な手順の ID（steps の id） */
  readonly stepIds: readonly string[];
}

/** 18歳未満の人に薬の選択の時点で出す注意文の種類（Q-3） */
export type QuantityNoticeKind = "minor_large_package" | "minor_multiple_packages";

export interface QuantityRules {
  /** 小容量の上限（日分）。Q-1 */
  readonly smallPackageMaxDays: number;
  /** 上限が長くなる効き目の分類と、その上限（日分）。Q-1 */
  readonly extendedSmallPackageMaxDays: number;
  readonly extendedSmallPackageClasses: readonly string[];
  /** これより若い人は大容量・複数個を選べない。Q-3 */
  readonly minorAgeBelow: number;
  /** 18歳未満で選べる最大の個数。Q-3 */
  readonly minorMaxQuantity: number;
  /**
   * 指定濫用防止医薬品でない薬を、1回の販売で1つの薬につき選べる最大の個数（患者さんの薬の確認の画面の個数）。
   * Q-6（11/8 依頼主＝薬剤師の判断。法令の基準ではなく、ハッカソン版の店の決まり）
   */
  readonly maxQuantityPerDrug: number;
  /** 注意文の日本語の原文（各言語の訳は画面の側で用意する） */
  readonly noticeTextJa: Readonly<Record<QuantityNoticeKind, string>>;
}

export interface SalesProcedureVersion {
  /** 施行日（YYYY-MM-DD） */
  readonly effectiveFrom: string;
  readonly steps: readonly ProcedureStepDefinition[];
  readonly categoryRules: readonly CategoryRule[];
  readonly quantityRules: QuantityRules;
}

const STEPS_2026_05_01: readonly ProcedureStepDefinition[] = [
  // P01〜P03
  // 書面は「準備（承認の前）」と「渡す（承認の後・会計案内の前）」に分ける（11/6 薬剤師の判断、README の決定 13）。
  // 印刷は承認の後にしかできない（assertActionAllowed("print")）ため、渡すのは承認の後になる。
  {
    id: "written_information_prepared",
    label: "書面の準備（翻訳版の説明書＋原文の内容を薬剤師が確認する）",
    gate: "before_approval",
    condition: "always",
  },
  {
    id: "written_information_handed",
    label: "書面を渡す（翻訳版の説明書＋原文を印刷して渡す）",
    gate: "before_checkout",
    condition: "always",
  },
  { id: "understanding_check", label: "理解の確認", gate: "before_checkout", condition: "always" },
  { id: "legal_record", label: "法定項目の記録", gate: "before_checkout", condition: "always" },
  // P03
  { id: "separate_document_check", label: "別紙書類の確認", gate: "before_approval", condition: "always" },
  { id: "witnessed_dosing", label: "薬剤師の前での服用の確認", gate: "before_checkout", condition: "always" },
  // P04（年齢と購入数量は、属性入力と問診 R02 で入力された値を使って関数が判定する）
  { id: "abuse_other_store_purchase", label: "他店での購入状況の確認（R01）", gate: "before_approval", condition: "always" },
  { id: "abuse_purpose", label: "使用目的の確認（R04）", gate: "before_approval", condition: "always" },
  { id: "abuse_reason", label: "大容量・複数個が必要な理由の確認と記録（R03）", gate: "before_approval", condition: "large_or_multiple" },
  {
    id: "abuse_written_information_prepared",
    label: "濫用の危険についての書面の準備（内容を薬剤師が確認する）",
    gate: "before_approval",
    condition: "always",
  },
  {
    id: "abuse_written_information_handed",
    label: "濫用の危険についての書面を渡す（印刷して渡す）",
    gate: "before_checkout",
    condition: "always",
  },
  { id: "minor_name_sheet", label: "別紙で氏名を確認し、別紙番号を入力（18歳未満）", gate: "before_approval", condition: "under_18" },
  // P05〜P07
  { id: "contraindication_check", label: "禁忌の確認", gate: "before_approval", condition: "always" },
  { id: "consultation_notice", label: "相談を促す表示", gate: "before_approval", condition: "always" },
];

const REQUIRES_GUIDANCE_STEPS = [
  "written_information_prepared",
  "written_information_handed",
  "understanding_check",
  "legal_record",
] as const;

const CATEGORY_RULES_2026_05_01: readonly CategoryRule[] = [
  { ruleId: "P01", category: "requires_guidance", stepIds: REQUIRES_GUIDANCE_STEPS },
  { ruleId: "P02", category: "first_class", stepIds: REQUIRES_GUIDANCE_STEPS },
  {
    ruleId: "P03",
    category: "specified_requires_guidance",
    stepIds: [...REQUIRES_GUIDANCE_STEPS, "separate_document_check", "witnessed_dosing"],
  },
  {
    ruleId: "P04",
    category: "abuse_prevention",
    stepIds: [
      "abuse_other_store_purchase",
      "abuse_purpose",
      "abuse_reason",
      "abuse_written_information_prepared",
      "abuse_written_information_handed",
      "minor_name_sheet",
    ],
  },
  { ruleId: "P05", category: "designated_second_class", stepIds: ["contraindication_check", "consultation_notice"] },
  { ruleId: "P06", category: "second_class", stepIds: ["contraindication_check"] },
  { ruleId: "P07", category: "third_class", stepIds: ["contraindication_check"] },
];

/** 登録されている版（施行日の古い順） */
export const SALES_PROCEDURE_VERSIONS: readonly SalesProcedureVersion[] = [
  {
    effectiveFrom: "2026-05-01",
    steps: STEPS_2026_05_01,
    categoryRules: CATEGORY_RULES_2026_05_01,
    quantityRules: {
      smallPackageMaxDays: 5,
      extendedSmallPackageMaxDays: 7,
      // Q-1「かぜ薬・解熱鎮痛薬・鼻炎用内服薬」。効き目の分類の名前は drugs.md に合わせる
      extendedSmallPackageClasses: ["かぜ薬（総合）", "解熱鎮痛薬", "鼻炎用内服薬"],
      minorAgeBelow: 18,
      minorMaxQuantity: 1,
      maxQuantityPerDrug: 3,
      noticeTextJa: {
        minor_large_package: "18歳未満の方には大容量の包装を販売できません",
        minor_multiple_packages: "18歳未満の方には1個まで販売できます",
      },
    },
  },
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD の形で、暦にある日付か（2026-13-45 や 2026-02-30 は不可） */
function isValidCalendarDate(date: string): boolean {
  const match = ISO_DATE.exec(date);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

/**
 * 指定した日に有効な版を選ぶ。
 *
 * date は**日本時間（店頭の日付）**の YYYY-MM-DD を渡す。呼び出し側で、販売する時点の
 * 日本時間の日付に直してから渡すこと（UTC の日付を渡すと、朝9時前は前日の扱いになる）。
 * ここでは時差で日付がずれないよう、Date ではなく日付の文字列で比べる。
 * 暦にない日付や、有効な版がないときは、推測で別の版を使わずにエラーで止める。
 */
export function selectProcedureVersion(
  date: string,
  versions: readonly SalesProcedureVersion[] = SALES_PROCEDURE_VERSIONS,
): SalesProcedureVersion {
  if (!isValidCalendarDate(date)) {
    throw new DomainRuleError("INVALID_DATE", `日付は暦にある YYYY-MM-DD の形で渡してください（${date}）`);
  }
  let selected: SalesProcedureVersion | undefined;
  for (const version of versions) {
    if (version.effectiveFrom <= date && (!selected || version.effectiveFrom > selected.effectiveFrom)) {
      selected = version;
    }
  }
  if (!selected) {
    throw new DomainRuleError("NO_PROCEDURE_VERSION", `${date} に有効な販売手順の版がありません`);
  }
  return selected;
}
