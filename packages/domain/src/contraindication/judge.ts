/**
 * 禁忌判定（design.md 7節「禁忌の判定と解除」）。
 *
 * - 結果は薬剤師への提案。禁忌は既定で選べず、解除は薬剤師の PIN 再認証と理由の記録が必要（ルール4・10）。
 * - 「わからない」「かもしれない」と答えた項目が禁忌に関わるときは禁忌にする（interview-items.md）。
 * - 判定に必要な答えがまだないときは、推測せずエラーで止める（ルール7）。
 * - 処方薬を飲んでいるだけでは判定を変えない（K39）。
 */

import { DomainRuleError } from "../errors.ts";
import {
  STOCKED_DRUGS,
  type DoseByAge,
  type ProductRule,
  type RuleBasis,
  type RuleCondition,
  type RuleVerdict,
  type StockedDrug,
  type StockedDrugId,
} from "./data.ts";
import type { InterviewFacts, InterviewItemId } from "./facts.ts";

export type Verdict = "contraindicated" | "caution" | "ok";

export type JudgmentReason = {
  code: string;
  verdict: RuleVerdict;
  label: string;
  /** どの問診の項目によるか */
  itemIds: readonly InterviewItemId[];
  basis: RuleBasis;
  /** 「わからない」「かもしれない」の答えによる（はっきりしないので販売を避ける） */
  uncertain: boolean;
};

export type DrugJudgment = {
  drugId: StockedDrugId;
  verdict: Verdict;
  reasons: readonly JudgmentReason[];
};

type Match = { matched: false } | { matched: true; uncertain: boolean; itemIds: InterviewItemId[] };

const NO_MATCH: Match = { matched: false };
const hit = (itemIds: InterviewItemId[], uncertain = false): Match => ({ matched: true, uncertain, itemIds });

/** 判定に使う答えを取り出す。まだ確認していなければエラーで止める。 */
function need<K extends keyof InterviewFacts>(
  facts: InterviewFacts,
  key: K,
  itemId: InterviewItemId,
): NonNullable<InterviewFacts[K]> {
  const value = facts[key];
  if (value === undefined || value === null) {
    // message に健康情報を入れない（項目 ID だけ）
    throw new DomainRuleError("FACT_MISSING", `問診の ${itemId} がまだ確認されていません`);
  }
  return value as NonNullable<InterviewFacts[K]>;
}

/** 妊娠・授乳を聞く対象か（男性と12歳未満には聞かない。interview-items.md Q03・Q04） */
function asksPregnancyAndBreastfeeding(facts: InterviewFacts): boolean {
  const sex = need(facts, "sex", "Q02");
  const age = need(facts, "age", "Q01");
  return sex !== "male" && age >= 12;
}

type PregnancyState = "pregnant" | "maybe" | "not_pregnant";

function pregnancyState(facts: InterviewFacts): PregnancyState {
  if (!asksPregnancyAndBreastfeeding(facts)) return "not_pregnant";
  const answer = need(facts, "pregnancy", "Q03");
  if (answer === "pregnant") return "pregnant";
  if (answer === "maybe") return "maybe";
  return "not_pregnant";
}

function evaluate(condition: RuleCondition, facts: InterviewFacts): Match {
  switch (condition.kind) {
    case "age_under":
      return need(facts, "age", "Q01") < condition.years ? hit(["Q01"]) : NO_MATCH;

    case "male":
      return need(facts, "sex", "Q02") === "male" ? hit(["Q02"]) : NO_MATCH;

    case "pregnant": {
      const state = pregnancyState(facts);
      if (state === "pregnant") return hit(["Q03"]);
      if (state === "maybe") return hit(["Q03"], true);
      return NO_MATCH;
    }

    case "due_within_12_weeks": {
      const state = pregnancyState(facts);
      // 妊娠しているかもしれない人には Q03a を聞けないので、12週以内かどうかもわからない
      if (state === "maybe") return hit(["Q03"], true);
      if (state !== "pregnant") return NO_MATCH;
      const due = need(facts, "dueWithin12Weeks", "Q03a");
      if (due === "yes") return hit(["Q03", "Q03a"]);
      if (due === "unknown") return hit(["Q03", "Q03a"], true);
      return NO_MATCH;
    }

    case "pregnant_before_12_weeks": {
      if (pregnancyState(facts) !== "pregnant") return NO_MATCH;
      const due = need(facts, "dueWithin12Weeks", "Q03a");
      return due === "no" ? hit(["Q03", "Q03a"]) : NO_MATCH;
    }

    case "breastfeeding": {
      if (!asksPregnancyAndBreastfeeding(facts)) return NO_MATCH;
      return need(facts, "breastfeeding", "Q04") === "yes" ? hit(["Q04"]) : NO_MATCH;
    }

    case "asthma": {
      const answer = need(facts, "asthmaHistory", "Q06");
      if (answer === "yes") return hit(["Q06"]);
      if (answer === "unknown") return hit(["Q06"], true);
      return NO_MATCH;
    }

    case "condition": {
      const conditions = need(facts, "conditions", "Q07");
      return condition.any.some((c) => conditions.includes(c)) ? hit(["Q07"]) : NO_MATCH;
    }

    case "drug_allergy": {
      const answer = need(facts, "drugAllergy", "Q08");
      if (answer === "yes") return hit(["Q08"]);
      if (answer === "unknown") return hit(["Q08"], true);
      return NO_MATCH;
    }

    case "taking": {
      // 「処方薬」はここでは判定に使わない（rules に入れていない）。K39
      const taking = need(facts, "currentMedications", "Q09");
      return condition.any.some((m) => taking.includes(m)) ? hit(["Q09"]) : NO_MATCH;
    }

    case "driving":
      return need(facts, "drivingAfter", "Q10") ? hit(["Q10"]) : NO_MATCH;

    case "alcohol":
      return need(facts, "alcohol", "Q11") ? hit(["Q11"]) : NO_MATCH;

    case "planned_days_over": {
      // 日数の基準が表にない（null）ときは判定しない。推測で数字を決めない
      if (condition.days === null) return NO_MATCH;
      return need(facts, "plannedDays", "Q12") > condition.days ? hit(["Q12"]) : NO_MATCH;
    }

    case "soft_contact_lens":
      return need(facts, "softContactLens", "Q13") ? hit(["Q13"]) : NO_MATCH;

    case "application_site":
      return need(facts, "applicationSite", "Q14") === condition.site ? hit(["Q14"]) : NO_MATCH;
  }
}

function toReason(rule: ProductRule, match: Extract<Match, { matched: true }>): JudgmentReason {
  return {
    code: rule.code,
    // 「わからない」の答えでも、禁忌の項目なら禁忌のまま（注意の項目なら注意のまま）
    verdict: rule.verdict,
    label: rule.label,
    itemIds: match.itemIds,
    basis: rule.basis,
    uncertain: match.uncertain,
  };
}

export function findStockedDrug(drugId: StockedDrugId): StockedDrug {
  const drug = STOCKED_DRUGS.find((d) => d.id === drugId);
  if (!drug) throw new DomainRuleError("UNKNOWN_DRUG", `取扱薬 ${drugId} が見つかりません`);
  return drug;
}

/** 1つの薬について、禁忌・注意・問題なしと、その理由を返す。 */
export function judgeDrug(drugId: StockedDrugId, facts: InterviewFacts): DrugJudgment {
  const drug = findStockedDrug(drugId);
  const reasons: JudgmentReason[] = [];
  for (const rule of drug.rules) {
    const match = evaluate(rule.condition, facts);
    if (match.matched) reasons.push(toReason(rule, match));
  }
  const verdict: Verdict = reasons.some((r) => r.verdict === "contraindicated")
    ? "contraindicated"
    : reasons.length > 0
      ? "caution"
      : "ok";
  return { drugId, verdict, reasons };
}

export function judgeDrugs(drugIds: readonly StockedDrugId[], facts: InterviewFacts): DrugJudgment[] {
  return drugIds.map((id) => judgeDrug(id, facts));
}

/**
 * 候補の薬を、禁忌にならない薬が先に来るように並べる（K28）。
 * 禁忌の薬も消さずに後ろに残す（薬剤師が理由を記録して解除できるため）。
 * 同じ組の中では、渡された順番を変えない。
 */
export function rankCandidates(drugIds: readonly StockedDrugId[], facts: InterviewFacts): DrugJudgment[] {
  const judgments = judgeDrugs(drugIds, facts);
  return [
    ...judgments.filter((j) => j.verdict !== "contraindicated"),
    ...judgments.filter((j) => j.verdict === "contraindicated"),
  ];
}

/**
 * 年齢別の用法・用量の表から、患者さんの年齢に当たる行だけを返す（design.md 7節）。
 * 表がない薬は null。服用しない年齢の行は dose が null。
 */
export function doseForAge(drugId: StockedDrugId, age: number): DoseByAge | null {
  const table = findStockedDrug(drugId).doseByAge;
  if (!table) return null;
  const row = table.find(
    (r) => age >= r.minAge && (r.maxAgeExclusive === null || age < r.maxAgeExclusive),
  );
  if (!row) throw new DomainRuleError("DOSE_NOT_FOUND", `取扱薬 ${drugId} の年齢別の用量が見つかりません`);
  return row;
}
