import { DomainRuleError } from "../errors.ts";
import type { QuantityNoticeKind, QuantityRules, SalesCategory } from "./data.ts";

/**
 * 販売手順の判定に使う薬の情報。薬のデータの一覧は持たず、呼び出し側から受け取る。
 * 包装の量と1日の最大量は、指定濫用防止医薬品のときだけ必要（同じ単位で渡す。例：錠）。
 */
export interface ProcedureDrugInput {
  readonly id: string;
  readonly categories: readonly SalesCategory[];
  /** 効き目の分類（drugs.md の名前。例：「かぜ薬（総合）」） */
  readonly efficacyClass: string;
  /** 1包装の量（例：60錠なら 60） */
  readonly packageAmount?: number;
  /** 用法どおりの1日の最大量（例：1回3錠・1日3回なら 9） */
  readonly maxDailyAmount?: number;
}

export interface DrugSelection {
  readonly drug: ProcedureDrugInput;
  readonly quantity: number;
}

export type PackageSize = "small" | "large";

export interface PackageClassification {
  /** 包装の日数（包装の量 ÷ 1日の最大量）。Q-5 */
  readonly days: number;
  /** 小容量と認められる上限（日分）。Q-1 */
  readonly smallMaxDays: number;
  readonly size: PackageSize;
}

function assertPositive(value: number | undefined, name: string, drugId: string): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    throw new DomainRuleError("INVALID_DRUG_DATA", `薬 ${drugId} の${name}が正しくありません`);
  }
  return value;
}

export function assertValidAge(age: number): void {
  if (!Number.isInteger(age) || age < 0) {
    throw new DomainRuleError("INVALID_AGE", "年齢が正しくありません");
  }
}

export function assertValidQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new DomainRuleError("INVALID_QUANTITY", "個数は1以上の整数で指定してください");
  }
}

/**
 * 指定濫用防止医薬品の包装が小容量か大容量かを判定する（Q-1・Q-2・Q-5）。
 */
export function classifyPackage(drug: ProcedureDrugInput, rules: QuantityRules): PackageClassification {
  const packageAmount = assertPositive(drug.packageAmount, "包装の量", drug.id);
  const maxDailyAmount = assertPositive(drug.maxDailyAmount, "1日の最大量", drug.id);
  const smallMaxDays = rules.extendedSmallPackageClasses.includes(drug.efficacyClass)
    ? rules.extendedSmallPackageMaxDays
    : rules.smallPackageMaxDays;
  // 割り算の誤差で境目がずれないよう、「包装の量 ≦ 上限日数 × 1日の最大量」で比べる
  const size: PackageSize = packageAmount <= smallMaxDays * maxDailyAmount ? "small" : "large";
  return { days: packageAmount / maxDailyAmount, smallMaxDays, size };
}

export interface QuantitySelectionResult {
  /** この組み合わせ（薬と個数の一覧）を選んでよいか */
  readonly allowed: boolean;
  /** 指定濫用防止医薬品の個数の合計（種類が違っても合わせて数える。決定 12） */
  readonly abusePreventionTotal: number;
  /** 指定濫用防止医薬品を合わせて選べる最大の個数（上限がなければ null） */
  readonly maxAbusePreventionTotal: number | null;
  /** 大容量に当たる指定濫用防止医薬品の ID */
  readonly largePackageDrugIds: readonly string[];
  /** 表示する注意文の種類（なければ null） */
  readonly notice: QuantityNoticeKind | null;
  /** 理由の確認と記録（R03）が必要か。Q-4 */
  readonly requiresReason: boolean;
}

/**
 * 薬の選択の時点で、選んだ薬と個数の組み合わせを選んでよいかを判定する（Q-3・Q-4）。
 *
 * - 個数は、指定濫用防止医薬品について**すべての選択を合計して**数える。
 *   同じ薬を「1個」と「1個」に分けて渡しても、種類の違う指定濫用防止医薬品を1個ずつ選んでも、
 *   合わせて2個以上なら「複数個」に当たる（11/6 薬剤師の判断、README の決定 12）。
 * - 18歳未満の大容量・複数個は、ここで選べなくする（決定 7）。
 *   画面では1つ足すたびに、足した後の一覧全体を渡して確かめる。
 * - 画面の表示だけに頼らず、承認の前にもサーバー側で同じ判定をかける（procedure.ts）。
 */
export function checkQuantitySelection(
  input: { readonly selections: readonly DrugSelection[]; readonly patientAge: number },
  rules: QuantityRules,
): QuantitySelectionResult {
  assertValidAge(input.patientAge);

  let abusePreventionTotal = 0;
  const largePackageDrugIds: string[] = [];
  for (const { drug, quantity } of input.selections) {
    assertValidQuantity(quantity);
    if (!drug.categories.includes("abuse_prevention")) continue;
    abusePreventionTotal += quantity;
    if (classifyPackage(drug, rules).size === "large" && !largePackageDrugIds.includes(drug.id)) {
      largePackageDrugIds.push(drug.id);
    }
  }

  const isMinor = input.patientAge < rules.minorAgeBelow;
  if (isMinor) {
    const hasLarge = largePackageDrugIds.length > 0;
    const tooMany = abusePreventionTotal > rules.minorMaxQuantity;
    return {
      allowed: !hasLarge && !tooMany,
      abusePreventionTotal,
      maxAbusePreventionTotal: rules.minorMaxQuantity,
      largePackageDrugIds,
      notice: hasLarge ? "minor_large_package" : tooMany ? "minor_multiple_packages" : null,
      requiresReason: false,
    };
  }

  return {
    allowed: true,
    abusePreventionTotal,
    maxAbusePreventionTotal: null,
    largePackageDrugIds,
    notice: null,
    requiresReason: largePackageDrugIds.length > 0 || abusePreventionTotal > 1,
  };
}
