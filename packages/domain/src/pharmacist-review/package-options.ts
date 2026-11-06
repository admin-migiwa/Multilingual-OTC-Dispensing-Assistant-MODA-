/**
 * 問診 R02（買いたい個数・包装）の時点で、18歳未満の大容量・複数個を選べなくする（docs/backlog.md M-12。
 * sales-procedures.md S09・S10、数量基準 Q-3。11/4 薬剤師の判断）。
 *
 * - 選べるかは、選んだ薬ぜんぶと R02 の答えから作った「薬と個数の一覧」に checkQuantitySelection をかけて決める
 *   （種類の違う指定濫用防止医薬品も合わせて数える。README の決定 12）。
 * - 基準（年齢・個数・大容量の線引き）はコードに書かず、販売手順の版のデータ（quantityRules）を渡してもらう（CLAUDE.md 絶対に守るルール5）。
 * - 画面の表示だけに頼らず、サーバーでも同じ判定で止める（apps/web/src/server/session-service.ts）。
 */

import type { StockedDrugId } from "../contraindication/data.ts";
import type { QuantityNoticeKind, QuantityRules } from "../sales-procedure/data.ts";
import { checkQuantitySelection } from "../sales-procedure/quantity.ts";
import { PACKAGE_CHOICES, type AbusePreventionAnswers, type PackageChoice } from "../interview/items.ts";
import { saleSelectionsFor } from "./review.ts";

export interface PackageChoiceOptions {
  /** 選べる R02 の選択肢（PACKAGE_CHOICES の順） */
  readonly allowed: readonly PackageChoice[];
  /** 出す注意文の種類（選べない選択肢があるときだけ。重ねない） */
  readonly notices: readonly QuantityNoticeKind[];
}

/** R02 の答え（包装と個数）が、選んだ薬・年齢で選べるか。選べなければ注意文の種類を返す */
export function checkPackageAnswer(
  drugIds: readonly StockedDrugId[],
  abuse: AbusePreventionAnswers,
  patientAge: number,
  rules: QuantityRules,
): { readonly allowed: boolean; readonly notice: QuantityNoticeKind | null } {
  const result = checkQuantitySelection({ selections: saleSelectionsFor(drugIds, abuse), patientAge }, rules);
  return { allowed: result.allowed, notice: result.notice };
}

/**
 * R02 の選択肢ごとに、選べるかを返す（画面で、選べない選択肢を押せなくして注意文を出すため）。
 * 「複数個」は、いちばん少ない2個で確かめる（2個で選べなければ、それより多くても選べない）。
 */
export function packageChoiceOptions(
  drugIds: readonly StockedDrugId[],
  patientAge: number,
  rules: QuantityRules,
): PackageChoiceOptions {
  const allowed: PackageChoice[] = [];
  const notices: QuantityNoticeKind[] = [];
  for (const choice of PACKAGE_CHOICES) {
    const abuse: AbusePreventionAnswers = choice === "multiple" ? { packageChoice: choice, multipleCount: 2 } : { packageChoice: choice };
    const checked = checkPackageAnswer(drugIds, abuse, patientAge, rules);
    if (checked.allowed) allowed.push(choice);
    else if (checked.notice !== null && !notices.includes(checked.notice)) notices.push(checked.notice);
  }
  return { allowed, notices };
}
