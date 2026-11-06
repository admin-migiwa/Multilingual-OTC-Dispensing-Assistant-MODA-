/**
 * 薬剤師の確認（T8a）の進め方（サーバー側）。
 *
 * - 状態の流れ：薬の選択（drug_selection）→ 薬剤師の確認（pharmacist_review）。
 *   確認からは「戻る」（→ drug_selection）と「販売しない」（→ declined。受診案内の画面は T11）。承認は T9。
 * - 禁忌の薬は、画面だけでなくここでも販売する薬として選べない（CLAUDE.md 絶対に守るルール4。packages/domain の assertSaleSelectable）。
 *   禁忌の解除（PIN の再認証と理由の記録）は T9（docs/backlog.md）。
 * - 販売手順のチェック（✓）は、付けた・外したを履歴として足すだけで、書き換えない（ルール6の考え方）。
 *   「✓ がそろうまで承認できない」の関所は T9 で、承認の処理の中で assertApprovalAllowed を呼んで作る。
 * - 販売手順の版は、日本時間（店頭の日付）の YYYY-MM-DD で選ぶ（docs/backlog.md C-07）。
 * - 問診の答えや入力された文をログ・履歴に出さない（ルール9）。履歴には項目 ID・手順 ID・薬の記号だけを入れる。
 */

import {
  DomainRuleError,
  QUESTIONS,
  STOCKED_DRUGS,
  abusePreventionAnswers,
  assertInterviewComplete,
  assertSaleSelectable,
  buildRequiredProcedure,
  factsForJudgment,
  isAsked,
  isBasicInterviewComplete,
  isInterviewComplete,
  judgeDrugs,
  questionsAskedForDrug,
  saleSelectionsFor,
  DEFAULT_INTERVIEW_SETTINGS,
  type DrugJudgment,
  type InterviewAnswers,
  type InterviewRoute,
  type QuestionId,
  type RequiredProcedure,
  type SessionStatus,
  type StepGate,
  type StockedDrugId,
} from "@moda/domain";
import type { LanguageCode } from "@moda/i18n";

import {
  SessionServiceError,
  event,
  load,
  moveTo,
  type ServiceDeps,
  type SessionRecord,
} from "./session-service.ts";

/** 販売する薬として薬剤師が選んだもの（選び直すたびに足す。最後のものが今の選択） */
export interface SaleChoice {
  readonly at: string;
  readonly drugIds: readonly StockedDrugId[];
}

/** 販売手順のチェック（✓）を付けた・外した記録 */
export interface StepCheck {
  readonly at: string;
  readonly stepId: string;
  readonly checked: boolean;
  /** どの「販売する薬の選択」のときのチェックか（saleChoices の番号）。薬を選び直したら、チェックはやり直す */
  readonly choiceIndex: number;
}

/** 薬剤師の確認1回分（確認の画面を開くたびに1つ足す。「戻る」で閉じる） */
export interface PharmacistReviewRound {
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly saleChoices: readonly SaleChoice[];
  readonly stepChecks: readonly StepCheck[];
  /** 「販売しない」の理由（薬剤師が入力。ログ・履歴には出さない） */
  readonly declinedReason: string | null;
  readonly declinedAt: string | null;
}

/** 「販売しない」の理由の長さの上限 */
export const MAX_DECLINE_REASON_LENGTH = 200;

// ---------------------------------------------------------------------------

/** 店頭の日付（日本時間の YYYY-MM-DD）。UTC の日付を使うと朝9時前が前日になるため */
export function japanDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function currentRound(record: SessionRecord): { index: number; round: PharmacistReviewRound } {
  const rounds = record.pharmacistReviews ?? [];
  const index = rounds.length - 1;
  const round = rounds[index];
  if (record.snapshot.status !== "pharmacist_review" || !round || round.closedAt !== null) {
    throw new DomainRuleError("INVALID_TRANSITION", "薬剤師の確認中ではありません");
  }
  return { index, round };
}

function withRound(record: SessionRecord, index: number, round: PharmacistReviewRound): SessionRecord {
  const rounds = record.pharmacistReviews ?? [];
  return { ...record, pharmacistReviews: rounds.map((r, i) => (i === index ? round : r)) };
}

/** 問診の答えから、患者さんが選んだ薬の禁忌判定をする（問診が終わっていなければ止まる） */
function judgmentsOf(record: SessionRecord): DrugJudgment[] {
  return judgeDrugs(record.interview.selectedDrugs, factsForJudgment(record.interview));
}

/** 今の「販売する薬」の選択（なければ空） */
function currentSaleDrugIds(round: PharmacistReviewRound): readonly StockedDrugId[] {
  return round.saleChoices.at(-1)?.drugIds ?? [];
}

function procedureOf(record: SessionRecord, drugIds: readonly StockedDrugId[], now: Date): RequiredProcedure {
  const age = record.interview.answers.age;
  if (age === undefined) throw new DomainRuleError("ANSWER_MISSING", "年齢の答えがありません");
  return buildRequiredProcedure({
    selections: saleSelectionsFor(drugIds, abusePreventionAnswers(record.interview)),
    patientAge: age,
    date: japanDate(now),
  });
}

// ---------------------------------------------------------------------------

/**
 * 薬剤師の確認を始める（drug_selection → pharmacist_review）。すでに確認中なら、そのまま返す。
 * 問診が終わっていなければ進めない（ほしい薬：選んだ薬の項目まで。症状から探す：基本の項目まで）。
 */
export function openPharmacistReview(deps: ServiceDeps, id: string): SessionRecord {
  const record = load(deps, id);
  if (record.snapshot.status === "pharmacist_review") return record;
  if (record.snapshot.status !== "drug_selection") {
    throw new DomainRuleError("INVALID_TRANSITION", `${record.snapshot.status} の状態では薬剤師の確認を始められません`);
  }
  if (record.interview.selectedDrugs.length > 0) {
    assertInterviewComplete(record.interview);
  } else if (record.interview.route !== "symptom" || !isBasicInterviewComplete(record.interview)) {
    throw new DomainRuleError("INTERVIEW_INCOMPLETE", "問診が終わっていません");
  }
  const moved = moveTo(deps, record, "pharmacist_review");
  const round: PharmacistReviewRound = {
    openedAt: deps.now().toISOString(),
    closedAt: null,
    saleChoices: [],
    stepChecks: [],
    declinedReason: null,
    declinedAt: null,
  };
  const next: SessionRecord = {
    ...moved,
    pharmacistReviews: [...(moved.pharmacistReviews ?? []), round],
    events: [...moved.events, event(deps, "pharmacist_review_opened")],
  };
  deps.store.set(next);
  return next;
}

/**
 * 販売する薬を選ぶ（選び直しもできる。空にもできる）。
 * - 患者さんが選んだ薬の中からだけ選べる。
 * - 禁忌の薬は選べない（ルール4。解除は T9）。
 * - 選び直したら、販売手順のチェックはやり直す（前のチェックは履歴に残す）。
 */
export function chooseSaleDrugs(deps: ServiceDeps, id: string, drugIds: readonly StockedDrugId[]): SessionRecord {
  const record = load(deps, id);
  const { index, round } = currentRound(record);
  const unique = [...new Set(drugIds)];
  for (const drugId of unique) {
    if (!record.interview.selectedDrugs.includes(drugId)) {
      throw new SessionServiceError("INVALID_REQUEST", "患者さんが選んだ薬の中から選んでください");
    }
  }
  assertSaleSelectable(judgmentsOf(record), unique);
  if (unique.length > 0) procedureOf(record, unique, deps.now()); // 販売できない数量の組み合わせなら、ここで止める
  const choice: SaleChoice = { at: deps.now().toISOString(), drugIds: unique };
  const next: SessionRecord = {
    ...withRound(record, index, { ...round, saleChoices: [...round.saleChoices, choice] }),
    events: [...record.events, event(deps, "sale_drugs_chosen", unique)],
  };
  deps.store.set(next);
  return next;
}

/** 販売手順のチェック（✓）を付ける・外す。今の手順の一覧にある手順だけ受け取り、記録に足す */
export function checkProcedureStep(deps: ServiceDeps, id: string, stepId: string, checked: boolean): SessionRecord {
  const record = load(deps, id);
  const { index, round } = currentRound(record);
  const drugIds = currentSaleDrugIds(round);
  if (drugIds.length === 0) {
    throw new DomainRuleError("NO_DRUG_SELECTED", "販売する薬を選んでからチェックします");
  }
  const procedure = procedureOf(record, drugIds, deps.now());
  if (!procedure.steps.some((step) => step.id === stepId)) {
    throw new SessionServiceError("INVALID_REQUEST", "この薬の販売手順にない手順です");
  }
  const check: StepCheck = {
    at: deps.now().toISOString(),
    stepId,
    checked,
    choiceIndex: round.saleChoices.length - 1,
  };
  const next: SessionRecord = {
    ...withRound(record, index, { ...round, stepChecks: [...round.stepChecks, check] }),
    events: [...record.events, event(deps, "procedure_step_checked", [stepId, checked ? "checked" : "unchecked"])],
  };
  deps.store.set(next);
  return next;
}

/** 「戻る」：薬の選択に戻す（pharmacist_review → drug_selection）。この確認の記録は閉じて残す */
export function returnToDrugSelection(deps: ServiceDeps, id: string): SessionRecord {
  const record = load(deps, id);
  const { index, round } = currentRound(record);
  const closed = withRound(record, index, { ...round, closedAt: deps.now().toISOString() });
  const next = moveTo(deps, closed, "drug_selection");
  deps.store.set(next);
  return next;
}

/** 「販売しない」：理由を記録して終える（pharmacist_review → declined）。受診案内の画面は T11 */
export function declineSale(deps: ServiceDeps, id: string, reason: string): SessionRecord {
  const record = load(deps, id);
  const { index, round } = currentRound(record);
  const trimmed = reason.trim();
  if (trimmed === "" || trimmed.length > MAX_DECLINE_REASON_LENGTH) {
    throw new SessionServiceError("INVALID_REQUEST", "販売しない理由を入れてください");
  }
  const at = deps.now().toISOString();
  const withReason = withRound(record, index, { ...round, declinedReason: trimmed, declinedAt: at, closedAt: at });
  const declined = moveTo(deps, withReason, "declined");
  const next: SessionRecord = { ...declined, events: [...declined.events, event(deps, "sale_declined")] };
  deps.store.set(next);
  return next;
}

// ---------------------------------------------------------------------------
// 薬剤師の画面に返す内容（日本語の画面だけが使う。患者さんの画面には返さない）
// ---------------------------------------------------------------------------

export interface PharmacistDrugView {
  readonly drugId: StockedDrugId;
  readonly name: string;
  readonly classification: string;
  /** この薬のために聞いた項目（聞く順番） */
  readonly questionIds: readonly QuestionId[];
  readonly judgment: DrugJudgment;
}

export interface PharmacistStepView {
  readonly id: string;
  readonly label: string;
  readonly gate: StepGate;
  readonly checked: boolean;
  /** 最後に付けた・外した時刻（まだなければ null） */
  readonly changedAt: string | null;
}

export interface PharmacistView {
  readonly id: string;
  readonly language: LanguageCode;
  readonly status: SessionStatus;
  readonly route: InterviewRoute | null;
  /** 問診の答え（自由に入力された文は原文のまま。翻訳は T13） */
  readonly answers: InterviewAnswers;
  /** いまの問診で聞いた項目（聞く順番） */
  readonly askedQuestionIds: readonly QuestionId[];
  /** 「症状から探す」で入力された症状（原文） */
  readonly symptomText: string | null;
  /** 患者さんが選んだ薬と、その判定（薬剤師の確認中だけ。問診が終わっていないと判定しない） */
  readonly drugs: readonly PharmacistDrugView[];
  readonly saleDrugIds: readonly StockedDrugId[];
  /** 販売する薬の販売手順（薬を選んでいなければ null） */
  readonly procedure: { readonly effectiveFrom: string; readonly steps: readonly PharmacistStepView[] } | null;
  /** 販売手順を作れなかったとき（例：18歳未満に大箱）のエラーの種類 */
  readonly procedureError: string | null;
  /** この確認でのチェックの履歴（新しい順ではなく、起きた順） */
  readonly checkHistory: readonly { readonly at: string; readonly stepId: string; readonly label: string; readonly checked: boolean }[];
  /** 「販売しない」で終えたときの理由 */
  readonly declinedReason: string | null;
}

export function pharmacistView(record: SessionRecord, now: Date): PharmacistView {
  const status = record.snapshot.status;
  const ctx = {
    answers: record.interview.answers,
    selectedDrugs: record.interview.selectedDrugs,
    route: record.interview.route,
    settings: DEFAULT_INTERVIEW_SETTINGS,
  };
  const askedQuestionIds = QUESTIONS.filter((q) => isAsked(q, ctx)).map((q) => q.id);
  const rounds = record.pharmacistReviews ?? [];
  const round = rounds.at(-1);
  const reviewing = status === "pharmacist_review" && round !== undefined && round.closedAt === null;

  const complete = record.interview.selectedDrugs.length > 0 && isInterviewComplete(record.interview);
  const judgments = reviewing && complete ? judgmentsOf(record) : [];
  const drugs: PharmacistDrugView[] = judgments.map((judgment) => {
    const drug = STOCKED_DRUGS.find((d) => d.id === judgment.drugId);
    if (!drug) throw new DomainRuleError("UNKNOWN_DRUG", `取扱薬 ${judgment.drugId} が見つかりません`);
    return {
      drugId: drug.id,
      name: drug.name,
      classification: drug.classification,
      questionIds: questionsAskedForDrug(record.interview, drug.id),
      judgment,
    };
  });

  const saleDrugIds = reviewing ? currentSaleDrugIds(round) : [];
  let procedure: PharmacistView["procedure"] = null;
  let procedureError: string | null = null;
  const checkHistory: { at: string; stepId: string; label: string; checked: boolean }[] = [];
  if (reviewing && saleDrugIds.length > 0) {
    try {
      const built = procedureOf(record, saleDrugIds, now);
      const choiceIndex = round.saleChoices.length - 1;
      const checks = round.stepChecks.filter((c) => c.choiceIndex === choiceIndex);
      procedure = {
        effectiveFrom: built.effectiveFrom,
        steps: built.steps.map((step) => {
          const last = checks.filter((c) => c.stepId === step.id).at(-1);
          return { id: step.id, label: step.label, gate: step.gate, checked: last?.checked ?? false, changedAt: last?.at ?? null };
        }),
      };
      for (const c of checks) {
        const label = built.steps.find((s) => s.id === c.stepId)?.label ?? c.stepId;
        checkHistory.push({ at: c.at, stepId: c.stepId, label, checked: c.checked });
      }
    } catch (error: unknown) {
      if (!(error instanceof DomainRuleError)) throw error;
      procedureError = error.code;
    }
  }

  return {
    id: record.id,
    language: record.language,
    status,
    route: record.interview.route ?? null,
    answers: record.interview.answers,
    askedQuestionIds,
    symptomText: record.symptomText,
    drugs,
    saleDrugIds,
    procedure,
    procedureError,
    checkHistory,
    declinedReason: round?.declinedReason ?? null,
  };
}
