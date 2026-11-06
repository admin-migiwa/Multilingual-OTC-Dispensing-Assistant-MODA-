/**
 * 薬剤師の確認画面（T8a）で使うルール。
 *
 * - 禁忌の薬は既定で選べない（CLAUDE.md 絶対に守るルール4）。画面だけでなくサーバーでもこれを呼んで止める。
 *   解除（薬剤師の PIN の再認証と理由の記録）は T9 で足す（docs/backlog.md）。
 * - 選んだ薬と問診の答え（R02 の包装・個数）から、販売手順の判定に渡す「薬と個数の一覧」を作る。
 * - 選んだ薬ごとに、その薬のために聞いた項目を返す（薬剤師が「何を聞いたか」を確かめるため。backlog J-11）。
 */

import { DomainRuleError } from "../errors.ts";
import type { StockedDrugId } from "../contraindication/data.ts";
import type { DrugJudgment } from "../contraindication/judge.ts";
import { isAsked, type InterviewState } from "../interview/flow.ts";
import {
  DEFAULT_INTERVIEW_SETTINGS,
  QUESTIONS,
  type AbusePreventionAnswers,
  type QuestionId,
} from "../interview/items.ts";
import type { DrugSelection, ProcedureDrugInput } from "../sales-procedure/quantity.ts";
import { DRUG_SALE_DATA } from "./sale-data.ts";

/**
 * 薬剤師が販売する薬として選んでよいかを確かめる。
 * - 禁忌と判定された薬は選べない（解除は T9）。
 * - 判定していない薬（患者さんが選んでいない薬など）も選べない。推測で通さない（ルール7）。
 */
export function assertSaleSelectable(
  judgments: readonly DrugJudgment[],
  chosenDrugIds: readonly StockedDrugId[],
): void {
  for (const drugId of chosenDrugIds) {
    const judgment = judgments.find((j) => j.drugId === drugId);
    if (!judgment) {
      throw new DomainRuleError("DRUG_NOT_JUDGED", `薬 ${drugId} の禁忌判定がありません`);
    }
    if (judgment.verdict === "contraindicated") {
      throw new DomainRuleError("CONTRAINDICATED_NOT_SELECTABLE", `薬 ${drugId} は禁忌のため選べません`);
    }
  }
}

function procedureInput(drugId: StockedDrugId, packageAmount?: number): ProcedureDrugInput {
  const data = DRUG_SALE_DATA[drugId];
  return {
    id: drugId,
    categories: data.categories,
    efficacyClass: data.efficacyClass,
    ...(packageAmount !== undefined ? { packageAmount } : {}),
    ...(data.maxDailyAmount !== undefined ? { maxDailyAmount: data.maxDailyAmount } : {}),
  };
}

/**
 * 販売手順の判定（buildRequiredProcedure）に渡す、薬と個数の一覧を作る。
 * - 大箱がある薬（E）は、問診の R02 の答えで包装と個数を決める。小箱1個／大箱1個／複数個（小箱を個数分）。
 *   R02 の答えがなければ推測せずに止める（ルール7）。
 * - 包装が1つだけの薬は1個（B は1包装のみ。interview-items.md の R02）。
 */
export function saleSelectionsFor(
  drugIds: readonly StockedDrugId[],
  abuse: AbusePreventionAnswers,
): DrugSelection[] {
  return drugIds.map((drugId) => {
    const packages = DRUG_SALE_DATA[drugId].packages;
    if (packages?.large === undefined) {
      return { drug: procedureInput(drugId, packages?.small.amount), quantity: 1 };
    }
    switch (abuse.packageChoice) {
      case "small_one":
        return { drug: procedureInput(drugId, packages.small.amount), quantity: 1 };
      case "large_one":
        return { drug: procedureInput(drugId, packages.large.amount), quantity: 1 };
      case "multiple": {
        if (abuse.multipleCount === undefined) {
          throw new DomainRuleError("ANSWER_MISSING", "R02 の個数の答えがありません");
        }
        return { drug: procedureInput(drugId, packages.small.amount), quantity: abuse.multipleCount };
      }
      default:
        throw new DomainRuleError("ANSWER_MISSING", "R02 の包装の答えがありません");
    }
  });
}

/**
 * その薬のために聞いた（聞く）項目を、聞く順番で返す。
 * いまの問診の流れと答えのまま、その薬だけを選んだとしたら聞く項目（年齢・性別を含む）。
 */
export function questionsAskedForDrug(state: InterviewState, drugId: StockedDrugId): QuestionId[] {
  const ctx = {
    answers: state.answers,
    selectedDrugs: [drugId],
    route: state.route,
    settings: DEFAULT_INTERVIEW_SETTINGS,
  };
  return QUESTIONS.filter((question) => isAsked(question, ctx)).map((question) => question.id);
}
