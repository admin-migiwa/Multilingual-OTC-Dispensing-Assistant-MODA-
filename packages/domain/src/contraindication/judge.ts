/**
 * 禁忌判定（design.md 7節「禁忌の判定と解除」）。
 *
 * - 結果は薬剤師への提案。禁忌は既定で選べず、解除は薬剤師の PIN 再認証と理由の記録が必要（ルール4・10）。
 * - 「わからない」「かもしれない」と答えた項目が禁忌に関わるときは禁忌にする（interview-items.md）。
 *   例外：薬のアレルギー歴（Q08）の「わからない」は「なし」として扱う（11/5）。
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
import { PREGNANCY_QUESTION_MIN_AGE, assertValidFacts, type InterviewFacts, type InterviewItemId } from "./facts.ts";

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

/**
 * uncertainLabel は「わからない」「かもしれない」の答えで当てはまったときの理由の文
 * （contraindication-tests.md の「理由として出す内容」。例：「ぜんそく歴が不明」）。
 */
type Match =
  | { matched: false }
  | { matched: true; itemIds: InterviewItemId[]; uncertainLabel: string | null };

const NO_MATCH: Match = { matched: false };
const hit = (itemIds: InterviewItemId[]): Match => ({ matched: true, itemIds, uncertainLabel: null });
const uncertainHit = (itemIds: InterviewItemId[], uncertainLabel: string): Match => ({
  matched: true,
  itemIds,
  uncertainLabel,
});

const LABEL_MAYBE_PREGNANT = "妊娠の可能性";
const LABEL_MAYBE_PREGNANT_DUE_UNKNOWN = "妊娠の可能性（出産予定日まで12週以内かがわからない）";
const LABEL_DUE_UNKNOWN = "出産予定日が不明";
const LABEL_ASTHMA_UNKNOWN = "ぜんそく歴が不明";

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
  return sex !== "male" && age >= PREGNANCY_QUESTION_MIN_AGE;
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
      if (state === "maybe") return uncertainHit(["Q03"], LABEL_MAYBE_PREGNANT);
      return NO_MATCH;
    }

    case "due_within_12_weeks": {
      const state = pregnancyState(facts);
      // 妊娠しているかもしれない人には Q03a を聞けないので、12週以内かどうかもわからない
      if (state === "maybe") return uncertainHit(["Q03"], LABEL_MAYBE_PREGNANT_DUE_UNKNOWN);
      if (state !== "pregnant") return NO_MATCH;
      const due = need(facts, "dueWithin12Weeks", "Q03a");
      if (due === "yes") return hit(["Q03", "Q03a"]);
      if (due === "unknown") return uncertainHit(["Q03", "Q03a"], LABEL_DUE_UNKNOWN);
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
      if (answer === "unknown") return uncertainHit(["Q06"], LABEL_ASTHMA_UNKNOWN);
      return NO_MATCH;
    }

    case "condition": {
      const conditions = need(facts, "conditions", "Q07");
      return condition.any.some((c) => conditions.includes(c)) ? hit(["Q07"]) : NO_MATCH;
    }

    case "drug_allergy":
      // 「わからない」は、どの薬でも「アレルギー歴なし」として扱う（11/5 薬剤師の判断。
      // わからないなら成分を特定しようがないため。「わからないは禁忌」の例外）
      return need(facts, "drugAllergy", "Q08") === "yes" ? hit(["Q08"]) : NO_MATCH;

    case "taking": {
      // 「処方薬」はここでは判定に使わない（rules に入れていない）。K39
      const taking = need(facts, "currentMedications", "Q09");
      return condition.any.some((m) => taking.includes(m)) ? hit(["Q09"]) : NO_MATCH;
    }

    case "driving":
      return need(facts, "drivingAfter", "Q10") ? hit(["Q10"]) : NO_MATCH;

    case "alcohol":
      return need(facts, "alcohol", "Q11") ? hit(["Q11"]) : NO_MATCH;

    case "planned_days_over":
      return need(facts, "plannedDays", "Q12") > condition.days ? hit(["Q12"]) : NO_MATCH;

    case "soft_contact_lens":
      return need(facts, "softContactLens", "Q13") ? hit(["Q13"]) : NO_MATCH;

    case "application_site":
      return need(facts, "applicationSite", "Q14") === condition.site ? hit(["Q14"]) : NO_MATCH;
  }
}

/**
 * 判定の条件ごとに、読む問診の項目。evaluate() が need() で読む項目と同じにしておくこと
 * （ずれると、問診が終わったのに判定に必要な答えが足りない、ということが起きる。テストで確かめている）。
 */
const ITEMS_READ_BY_CONDITION: Readonly<Record<RuleCondition["kind"], readonly InterviewItemId[]>> = {
  age_under: ["Q01"],
  male: ["Q02"],
  pregnant: ["Q01", "Q02", "Q03"],
  due_within_12_weeks: ["Q01", "Q02", "Q03", "Q03a"],
  pregnant_before_12_weeks: ["Q01", "Q02", "Q03", "Q03a"],
  breastfeeding: ["Q01", "Q02", "Q04"],
  asthma: ["Q06"],
  condition: ["Q07"],
  drug_allergy: ["Q08"],
  taking: ["Q09"],
  driving: ["Q10"],
  alcohol: ["Q11"],
  planned_days_over: ["Q12"],
  soft_contact_lens: ["Q13"],
  application_site: ["Q14"],
};

/**
 * その薬の禁忌判定に使う問診の項目（Q01〜Q14）。
 * 「ほしい薬がある」流れでは、これに入っている項目だけを聞く（11/6 依頼主の判断。interview-items.md）。
 * 年齢（Q01）・性別（Q02）は、どの薬でも最初に聞くので必ず入れる。
 */
export function questionsUsedByDrug(drugId: StockedDrugId): ReadonlySet<InterviewItemId> {
  const drug = findStockedDrug(drugId);
  const items = new Set<InterviewItemId>(["Q01", "Q02"]);
  for (const rule of drug.rules) {
    for (const item of ITEMS_READ_BY_CONDITION[rule.condition.kind]) items.add(item);
  }
  return items;
}

function toReason(rule: ProductRule, match: Extract<Match, { matched: true }>): JudgmentReason {
  return {
    code: rule.code,
    // 「わからない」の答えでも、禁忌の項目なら禁忌のまま（注意の項目なら注意のまま）
    verdict: rule.verdict,
    label: match.uncertainLabel ?? rule.label,
    itemIds: match.itemIds,
    basis: rule.basis,
    uncertain: match.uncertainLabel !== null,
  };
}

export function findStockedDrug(drugId: StockedDrugId): StockedDrug {
  const drug = STOCKED_DRUGS.find((d) => d.id === drugId);
  if (!drug) throw new DomainRuleError("UNKNOWN_DRUG", `取扱薬 ${drugId} が見つかりません`);
  return drug;
}

/** 1つの薬について、禁忌・注意・問題なしと、その理由を返す。 */
export function judgeDrug(drugId: StockedDrugId, facts: InterviewFacts): DrugJudgment {
  assertValidFacts(facts);
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
  assertValidFacts({ age });
  const table = findStockedDrug(drugId).doseByAge;
  if (!table) return null;
  const row = table.find(
    (r) => age >= r.minAge && (r.maxAgeExclusive === null || age < r.maxAgeExclusive),
  );
  if (!row) throw new DomainRuleError("DOSE_NOT_FOUND", `取扱薬 ${drugId} の年齢別の用量が見つかりません`);
  return row;
}
