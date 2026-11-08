/**
 * 患者さんの薬の確認と個数（11/8 依頼主＝薬剤師の判断）。
 *
 * 流れ：薬が決まる（患者さんが選ぶ／薬剤師が候補を選ぶ）→ 患者さんが自分の言語で薬を確かめ、
 * 「この薬でOK（個数）」「相談したい」「薬を選びなおす」のどれかを選ぶ → OK なら追加の問診 → 薬剤師の PIN 承認。
 *
 * - 承認の前に、いま販売する薬の組み合わせについて患者さんの「OK」と個数がそろっていることを、サーバーで確かめる
 *   （assertPatientConfirmed。画面の表示だけで止めない。CLAUDE.md 絶対に守るルール1と同じ考え方）。
 * - 「有効な OK」は、最後の確認（OK か選びなおし）が OK で、OK した薬の組み合わせが今の選択と同じで、
 *   個数が今の答え（E は問診 R02 の答え）と同じこと。薬が変わる・R02 の答えが変わると、前の OK は効かない。
 * - 個数の決め方（sales-procedures.md Q-6・interview-items.md R02）：
 *   - count：指定濫用防止医薬品でない薬。1〜上限（版のデータ quantityRules.maxQuantityPerDrug。ルール5）
 *   - package：大箱がある指定濫用防止医薬品（E）。個数は問診 R02（小箱1個／大箱1個／複数個）の答え
 *   - fixed：1個に決まっている薬（B〈指定濫用防止・1包装のみ〉と A〈薬剤師の前で1錠を服用〉。11/8 依頼主の判断）
 * - 確認の記録は足すだけで、書き換えない（ルール6の考え方）。この関数たちは記録を受け取って判定するだけ。
 */

import { DomainRuleError } from "../errors.ts";
import type { StockedDrugId } from "../contraindication/data.ts";
import type { AbusePreventionAnswers, PackageChoice } from "../interview/items.ts";
import type { QuantityRules } from "../sales-procedure/data.ts";
import { DRUG_SALE_DATA } from "./sale-data.ts";

export type PatientDrugChoice = "ok" | "consult" | "reselect";

export type QuantityMode = "count" | "package" | "fixed";

/** 1個に決まっている薬（11/8 依頼主の判断。A は薬剤師の前で1錠を服用する薬。B は指定濫用防止で1包装のみ） */
const FIXED_ONE: readonly StockedDrugId[] = ["A", "B"];

/** 患者さんの確認1回分（足していくだけ） */
export interface PatientDrugConfirmation {
  readonly at: string;
  /** 確認したときの薬の組み合わせ */
  readonly drugIds: readonly StockedDrugId[];
  readonly choice: PatientDrugChoice;
  /** OK のときだけ：薬ごとの個数（count の薬は選んだ数、fixed の薬は1。package の薬は入れない） */
  readonly quantities: Readonly<Partial<Record<StockedDrugId, number>>>;
  /** OK のときだけ：package の薬（E）の R02 の答え（なければ null） */
  readonly packageAnswer: { readonly packageChoice: PackageChoice; readonly multipleCount?: number } | null;
}

export function quantityModeOf(drugId: StockedDrugId): QuantityMode {
  const data = DRUG_SALE_DATA[drugId];
  if (data.packages?.large !== undefined) return "package";
  if (FIXED_ONE.includes(drugId) || data.categories.includes("abuse_prevention")) return "fixed";
  return "count";
}

function sameSet(a: readonly StockedDrugId[], b: readonly StockedDrugId[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/**
 * OK のときの個数を確かめ、記録に入れる形にする。
 * - count の薬：1〜上限の整数が必要。fixed の薬：1（送られても1以外は受け取らない）。package の薬：個数は受け取らない（R02 で決める）
 * - 選んでいない薬の個数は受け取らない
 */
export function checkConfirmQuantities(
  drugIds: readonly StockedDrugId[],
  quantities: Readonly<Partial<Record<string, unknown>>>,
  rules: QuantityRules,
): Partial<Record<StockedDrugId, number>> {
  for (const key of Object.keys(quantities)) {
    if (!drugIds.includes(key as StockedDrugId)) {
      throw new DomainRuleError("INVALID_QUANTITY", `選んでいない薬 ${key} の個数です`);
    }
  }
  const result: Partial<Record<StockedDrugId, number>> = {};
  for (const drugId of drugIds) {
    const mode = quantityModeOf(drugId);
    const value = quantities[drugId];
    if (mode === "package") {
      if (value !== undefined) throw new DomainRuleError("INVALID_QUANTITY", `薬 ${drugId} の個数は包装の質問で選びます`);
      continue;
    }
    if (mode === "fixed") {
      if (value !== undefined && value !== 1) throw new DomainRuleError("INVALID_QUANTITY", `薬 ${drugId} は1個です`);
      result[drugId] = 1;
      continue;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > rules.maxQuantityPerDrug) {
      throw new DomainRuleError("INVALID_QUANTITY", `薬 ${drugId} の個数は1〜${rules.maxQuantityPerDrug}個で選んでください`);
    }
    result[drugId] = value;
  }
  return result;
}

/** 最後の確認（OK か選びなおし）。「相談したい」は記録に残すだけで、OK を消さない */
export function latestDecisiveConfirmation(
  confirmations: readonly PatientDrugConfirmation[],
): PatientDrugConfirmation | null {
  for (let i = confirmations.length - 1; i >= 0; i -= 1) {
    const c = confirmations[i];
    if (c && c.choice !== "consult") return c;
  }
  return null;
}

/**
 * いまの選択（drugIds）と答え（R02）について、有効な OK を返す（なければ null）。
 * 個数は、今の版の上限でも確かめ直す（日付で版が変わっても、上限を超えた OK を使わない）
 */
export function currentPatientOk(
  confirmations: readonly PatientDrugConfirmation[],
  drugIds: readonly StockedDrugId[],
  abuse: AbusePreventionAnswers,
  rules: QuantityRules,
): PatientDrugConfirmation | null {
  const latest = latestDecisiveConfirmation(confirmations);
  if (latest === null || latest.choice !== "ok" || drugIds.length === 0 || !sameSet(latest.drugIds, drugIds)) return null;
  try {
    checkConfirmQuantities(drugIds, latest.quantities, rules);
  } catch (error: unknown) {
    if (error instanceof DomainRuleError) return null;
    throw error;
  }
  if (drugIds.some((id) => quantityModeOf(id) === "package")) {
    const p = latest.packageAnswer;
    if (p === null || p.packageChoice !== abuse.packageChoice || p.multipleCount !== abuse.multipleCount) return null;
  }
  return latest;
}

/**
 * 承認の前に呼ぶ：販売する薬の組み合わせについて、患者さんの有効な OK があること（ないときは止める）。
 * - OK した組み合わせと販売する組み合わせが違う（一部だけ売るときも）なら止める。薬剤師は候補から選び直し、患者さんがもう一度確かめる
 *   （11/8 依頼主の判断）
 */
export function assertPatientConfirmed(
  confirmations: readonly PatientDrugConfirmation[],
  saleDrugIds: readonly StockedDrugId[],
  selectedDrugIds: readonly StockedDrugId[],
  abuse: AbusePreventionAnswers,
  rules: QuantityRules,
): PatientDrugConfirmation {
  const ok = currentPatientOk(confirmations, selectedDrugIds, abuse, rules);
  if (ok === null || !sameSet(ok.drugIds, saleDrugIds)) {
    throw new DomainRuleError("PATIENT_NOT_CONFIRMED", "販売する薬と個数を、患者さんがまだ確かめていません");
  }
  return ok;
}
