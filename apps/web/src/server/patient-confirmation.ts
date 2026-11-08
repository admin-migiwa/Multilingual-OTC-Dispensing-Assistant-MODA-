/**
 * 患者さんの薬の確認と個数（サーバー側。11/8 依頼主＝薬剤師の判断。判定のルールは packages/domain の patient-confirmation.ts）。
 *
 * 薬が決まったら（患者さんが選ぶ／薬剤師が候補を選ぶ）、患者さんが自分の言語で薬を確かめ、次のどれかを選ぶ。
 * - ok：個数を選ぶ（ふつうの薬は1〜上限、E は問診 R02 の包装、A・B は1個）。E の包装は問診の R02 の答えとして入れる（同じことを2回聞かない）。
 *   そのあと、聞く項目が残っていれば問診へ、なければ薬の選択（薬剤師の確認待ち）へ
 * - consult：記録に足すだけ（画面が翻訳のチャットを開く）
 * - reselect：選んだ薬を外す。「ほしい薬がある」は患者さんが探し直し、「症状から探す」は薬剤師の確認を開いて薬剤師が選び直す
 * 記録（drugConfirmations）は足すだけ。履歴（events）には、選んだもの・薬の記号・個数だけを残す（健康情報は入れない。ルール9）。
 * 承認の関所は approval.ts（assertPatientConfirmed）。
 */

import {
  DomainRuleError,
  applyAnswersWithReport,
  isBasicInterviewComplete,
  checkConfirmQuantities,
  nextQuestion,
  quantityModeOf,
  selectDrugs as selectInterviewDrugs,
  type PackageChoice,
  type PatientDrugConfirmation,
} from "@moda/domain";

import { newReviewRound } from "./pharmacist-service.ts";
import {
  DRUG_CONFIRMATION_STATUSES,
  SessionServiceError,
  event,
  load,
  moveTo,
  packageAnswerAllowed,
  quantityRulesAt,
  type ServiceDeps,
  type SessionRecord,
} from "./session-service.ts";

export interface DrugConfirmationInput {
  readonly choice: unknown;
  /** ok のとき：薬ごとの個数（ふつうの薬だけ） */
  readonly quantities?: unknown;
  /** ok で E があるとき：R02 の包装と、複数個のときの個数 */
  readonly packageChoice?: unknown;
  readonly multipleCount?: unknown;
}

export function confirmDrugChoice(deps: ServiceDeps, id: string, input: DrugConfirmationInput): SessionRecord {
  const record = load(deps, id);
  const status = record.snapshot.status;
  if (!DRUG_CONFIRMATION_STATUSES.includes(status)) {
    throw new DomainRuleError("INVALID_TRANSITION", `${status} の状態では薬の確認を受け付けません`);
  }
  const drugIds = record.interview.selectedDrugs;
  if (drugIds.length === 0) throw new DomainRuleError("NO_DRUG_SELECTED", "確かめる薬がありません");
  const now = deps.now();
  const at = now.toISOString();
  const confirmations = record.drugConfirmations ?? [];

  if (input.choice === "consult") {
    const entry: PatientDrugConfirmation = { at, drugIds, choice: "consult", quantities: {}, packageAnswer: null };
    const next: SessionRecord = {
      ...record,
      drugConfirmations: [...confirmations, entry],
      events: [...record.events, event(deps, "patient_drug_confirmed", ["consult", ...drugIds])],
    };
    deps.store.set(next);
    return next;
  }

  if (input.choice === "reselect") {
    const entry: PatientDrugConfirmation = { at, drugIds, choice: "reselect", quantities: {}, packageAnswer: null };
    const interview = selectInterviewDrugs(record.interview, []);
    let next: SessionRecord = {
      ...record,
      interview,
      drugConfirmations: [...confirmations, entry],
      events: [
        ...record.events,
        event(deps, "patient_drug_confirmed", ["reselect", ...drugIds]),
        event(deps, "drugs_selected", []),
      ],
    };
    if (next.snapshot.status === "interview") next = moveTo(deps, next, "drug_selection");
    // 「症状から探す」：薬剤師に選び直してもらう。基本の問診は済んでいるので、同じ書き込みで薬剤師の確認を開く
    // （openPharmacistReview と同じ：薬剤師の確認へ進め、新しい確認を足す）
    if (record.interview.route === "symptom") {
      if (!isBasicInterviewComplete(next.interview)) {
        throw new DomainRuleError("INTERVIEW_INCOMPLETE", "基本の問診が終わっていません");
      }
      next = moveTo(deps, next, "pharmacist_review");
      next = {
        ...next,
        pharmacistReviews: [...(next.pharmacistReviews ?? []), newReviewRound(at)],
        events: [...next.events, event(deps, "pharmacist_review_opened")],
      };
    }
    deps.store.set(next);
    return next;
  }

  if (input.choice !== "ok") throw new SessionServiceError("INVALID_REQUEST", "選び方の形が違います");

  const rules = quantityRulesAt(now);
  const rawQuantities = input.quantities ?? {};
  if (typeof rawQuantities !== "object" || rawQuantities === null || Array.isArray(rawQuantities)) {
    throw new SessionServiceError("INVALID_REQUEST", "個数の形が違います");
  }
  const quantities = checkConfirmQuantities(drugIds, rawQuantities as Record<string, unknown>, rules);

  // E（大箱がある指定濫用防止医薬品）：個数の選択＝問診 R02。答えの確かめは問診と同じ（範囲・18歳未満の大箱・複数個）
  let interview = record.interview;
  let packageAnswer: PatientDrugConfirmation["packageAnswer"] = null;
  const newEvents = [];
  if (drugIds.some((d) => quantityModeOf(d, rules) === "package")) {
    const packageChoice = input.packageChoice as PackageChoice;
    const multipleCount = packageChoice === "multiple" ? input.multipleCount : undefined;
    const answers = multipleCount === undefined ? { packageChoice } : { packageChoice, multipleCount: multipleCount as number };
    // 前の答え（複数個の個数）を残さないよう、包装の答えを入れ直す
    const cleared = { ...interview, answers: { ...interview.answers } };
    delete cleared.answers.packageChoice;
    delete cleared.answers.multipleCount;
    const applied = applyAnswersWithReport(cleared, answers);
    interview = applied.state;
    if (interview.answers.packageChoice === undefined || (packageChoice === "multiple" && interview.answers.multipleCount === undefined)) {
      throw new DomainRuleError("ANSWER_MISSING", "包装の答えがありません");
    }
    if (!packageAnswerAllowed(interview, rules)) {
      throw new DomainRuleError("QUANTITY_NOT_ALLOWED", "この年齢・個数・包装の組み合わせは選べません");
    }
    packageAnswer =
      interview.answers.multipleCount === undefined
        ? { packageChoice: interview.answers.packageChoice }
        : { packageChoice: interview.answers.packageChoice, multipleCount: interview.answers.multipleCount };
    newEvents.push(event(deps, "answered", ["packageChoice", ...(packageAnswer.multipleCount !== undefined ? ["multipleCount"] : [])]));
    // 大箱・複数個から小箱1個に変えて R03（理由）を聞かなくなったときは、消えたことを種類だけ残す（answer と同じ）
    if (record.interview.answers.reasonText !== undefined && interview.answers.reasonText === undefined) {
      newEvents.push(event(deps, "answers_cleared", ["reasonText"]));
    }
  } else if (input.packageChoice !== undefined || input.multipleCount !== undefined) {
    throw new SessionServiceError("INVALID_REQUEST", "この薬には包装の選択がありません");
  }

  const entry: PatientDrugConfirmation = { at, drugIds, choice: "ok", quantities, packageAnswer };
  const detail = drugIds.map((d) =>
    packageAnswer !== null && quantityModeOf(d, rules) === "package"
      ? `${d}:${packageAnswer.packageChoice}${packageAnswer.multipleCount !== undefined ? `x${packageAnswer.multipleCount}` : ""}`
      : `${d}:${quantities[d] ?? "?"}`,
  );
  let next: SessionRecord = {
    ...record,
    interview,
    drugConfirmations: [...confirmations, entry],
    events: [...record.events, event(deps, "patient_drug_confirmed", ["ok", ...detail]), ...newEvents],
  };
  // 聞く項目が残っていれば問診へ、なければ薬の選択（薬剤師の確認待ち）へ
  const remaining = nextQuestion(next.interview) !== null;
  if (next.snapshot.status === "drug_selection" && remaining) next = moveTo(deps, next, "interview");
  else if (next.snapshot.status === "interview" && !remaining) next = moveTo(deps, next, "drug_selection");
  deps.store.set(next);
  return next;
}
