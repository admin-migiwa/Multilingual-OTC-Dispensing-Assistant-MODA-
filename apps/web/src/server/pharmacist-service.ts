/**
 * 薬剤師の確認（T8a）の進め方（サーバー側）。
 *
 * - 状態の流れ：薬の選択（drug_selection）→ 薬剤師の確認（pharmacist_review）。
 *   確認からは「戻る」（→ drug_selection）と「販売しない」（→ declined。受診案内の画面は T11）。承認は T9。
 * - 禁忌の薬は、画面だけでなくここでも販売する薬として選べない（CLAUDE.md 絶対に守るルール4。packages/domain の assertSaleSelectable）。
 *   禁忌の解除（PIN の再認証と理由の記録）は T9（docs/backlog.md）。
 * - 販売手順のチェック（✓）は、付けた・外したを履歴として足すだけで、書き換えない（ルール6の考え方）。
 *   「承認の後・会計の前に」の手順は、承認の前には ✓ を付けられない（まだ起きていないことを記録しないため。T9・T10）。
 *   「✓ がそろうまで承認できない」の関所は T9 で、承認の処理の中で assertApprovalAllowed を呼んで作る。
 * - 販売手順の版は、日本時間（店頭の日付）の YYYY-MM-DD で選ぶ（docs/backlog.md C-07）。
 * - 問診の答えや入力された文をログ・履歴に出さない（ルール9）。履歴には項目 ID・手順 ID・薬の記号だけを入れる。
 */

import {
  DomainRuleError,
  QUESTIONS,
  STOCKED_DRUGS,
  INGREDIENTS,
  abusePreventionAnswers,
  doseForAge,
  findStockedDrug,
  assertInterviewComplete,
  assertSaleSelectable,
  buildRequiredProcedure,
  factsForJudgment,
  isAsked,
  isBasicInterviewComplete,
  isInterviewComplete,
  judgeDrugs,
  checkOverrideReason,
  type OverrideReasonCode,
  nextQuestion,
  keptQuestionsFromPastDrugs,
  previewCandidates,
  selectCandidateDrugs,
  type CandidatePreview,
  questionsAskedForDrug,
  saleSelectionsFor,
  undoStep,
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

import type { SaleRecord } from "./approval.ts";
import { activeApproval, sinceOfUnderstanding } from "./sale-versions.ts";
import { completedStepsAfterApproval, currentGuidance, procedureAtApproval, type GuidanceRecord } from "./guidance.ts";
import type { PinVerifier } from "./pin.ts";
import { japanDate } from "./japan-date.ts";
import {
  SessionServiceError,
  assertSomePackageChoice,
  enforcePackageLimit,
  event,
  load,
  patientView,
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

/**
 * 禁忌の解除（T9b。C-14）。薬剤師が PIN で再認証し、理由を選んで記録する。足すだけで書き換えない。
 * 解除が効くのは、その確認（round）の中だけ。確認を閉じる（戻る・候補を選び直す・承認・販売しない）と、次の確認ではやり直す
 * （確認の間は問診の答えが変わらないので、判定も変わらない）。
 */
export interface ContraindicationOverride {
  readonly at: string;
  readonly drugId: StockedDrugId;
  readonly pharmacist: { readonly id: string; readonly name: string };
  readonly reasonCode: OverrideReasonCode;
  /** 「その他」などの自由記述（ログ・履歴には出さない） */
  readonly reasonText: string | null;
  /** 解除したときの禁忌の理由（あとから確かめるため） */
  readonly judgedReasons: readonly string[];
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
  /** この確認での禁忌の解除（なければ undefined。T9b） */
  readonly overrides?: readonly ContraindicationOverride[];
  /** この確認で承認したときの販売記録の ID（承認していなければ undefined。T9a） */
  readonly saleRecordId?: string;
  /** この確認で、候補・代わりの薬を選んで問診に戻したときの薬（なければ undefined。backlog C-03） */
  readonly candidateDrugIds?: readonly StockedDrugId[];
}

/** 「販売しない」の理由の長さの上限 */
export const MAX_DECLINE_REASON_LENGTH = 200;

// ---------------------------------------------------------------------------

/** 店頭の日付（日本時間）。session-service と共通にするため japan-date.ts に移した */
export { japanDate };

export function currentRound(record: SessionRecord): { index: number; round: PharmacistReviewRound } {
  const rounds = record.pharmacistReviews ?? [];
  const index = rounds.length - 1;
  const round = rounds[index];
  if (record.snapshot.status !== "pharmacist_review" || !round || round.closedAt !== null) {
    throw new DomainRuleError("INVALID_TRANSITION", "薬剤師の確認中ではありません");
  }
  return { index, round };
}

export function withRound(record: SessionRecord, index: number, round: PharmacistReviewRound): SessionRecord {
  const rounds = record.pharmacistReviews ?? [];
  return { ...record, pharmacistReviews: rounds.map((r, i) => (i === index ? round : r)) };
}

/** 問診の答えから、患者さんが選んだ薬の禁忌判定をする（問診が終わっていなければ止まる） */
export function judgmentsOf(record: SessionRecord): DrugJudgment[] {
  return judgeDrugs(record.interview.selectedDrugs, factsForJudgment(record.interview));
}

/** 今の「販売する薬」の選択（なければ空） */
export function currentSaleDrugIds(round: PharmacistReviewRound): readonly StockedDrugId[] {
  return round.saleChoices.at(-1)?.drugIds ?? [];
}

export function procedureOf(record: SessionRecord, drugIds: readonly StockedDrugId[], now: Date): RequiredProcedure {
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
  const next: SessionRecord = {
    ...moved,
    pharmacistReviews: [...(moved.pharmacistReviews ?? []), newReviewRound(deps.now().toISOString())],
    events: [...moved.events, event(deps, "pharmacist_review_opened")],
  };
  deps.store.set(next);
  return next;
}

/** 新しい薬剤師の確認（販売する薬・手順の ✓ は空から） */
export function newReviewRound(openedAt: string): PharmacistReviewRound {
  return { openedAt, closedAt: null, saleChoices: [], stepChecks: [], declinedReason: null, declinedAt: null };
}

/**
 * 「販売しない」を取り消して、薬剤師の確認に戻す（declined → pharmacist_review。11/7 依頼主の判断。PIN は求めない）。
 * 前の確認（販売しない理由を含む）は閉じたまま残し、新しい確認を開く
 */
export function cancelDecline(deps: ServiceDeps, id: string): SessionRecord {
  const record = load(deps, id);
  const snapshot = undoStep(record.snapshot, "cancel_decline");
  const next: SessionRecord = {
    ...record,
    snapshot,
    pharmacistReviews: [...(record.pharmacistReviews ?? []), newReviewRound(deps.now().toISOString())],
    events: [...record.events, event(deps, "decline_cancelled"), event(deps, "status_changed", [snapshot.status])],
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
  assertSaleSelectable(judgmentsOf(record), unique, overriddenDrugIdsOf(round));
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
  const step = procedure.steps.find((s) => s.id === stepId);
  if (!step) {
    throw new SessionServiceError("INVALID_REQUEST", "この薬の販売手順にない手順です");
  }
  // 「会計の前に」の手順（書面を渡す・理解の確認・法定項目の記録・薬剤師の前での服用の確認など）は、承認の後に行うもの。
  // 承認の前の確認中に ✓ を付けると、まだ起きていないことを記録してしまうので受け付けない（承認の後の記録は T9・T10）
  if (step.gate !== "before_approval") {
    throw new DomainRuleError("STEP_NOT_YET_AVAILABLE", "この手順は承認の後に記録します");
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

/**
 * 候補の薬（「症状から探す」）・代わりの薬（「ほしい薬がある」）を薬剤師が選び、その薬の項目を聞く問診に戻す（backlog C-03・C-11）。
 * - 薬剤師の確認中だけ。禁忌と分かっている薬も選べる（11/7 依頼主の判断）。販売する薬に選ぶには、次の確認で禁忌の解除が要る（ルール4）。
 * - 今の確認は閉じて残し（選んだ薬も記録）、薬の選択に戻して薬を選び直す。聞く項目が残っていれば問診へ進める。
 *   聞く項目がなければ薬の選択のまま（画面がもう一度薬剤師の確認を開き、答えがそろった判定で確かめる）。
 * - 選び直しで聞かなくなった答えは消える（selectDrugs。もとの薬は履歴の drugs_selected に残る）。
 */
export function chooseCandidateDrugs(deps: ServiceDeps, id: string, drugIds: readonly StockedDrugId[]): SessionRecord {
  const record = load(deps, id);
  const { index, round } = currentRound(record);
  const interview = selectCandidateDrugs(record.interview, [...new Set(drugIds)]);
  // 18歳未満で、R02 にどの包装も選べない組み合わせ（例：B と E を一緒に）は選ばせない。問診に戻っても答えられないため（M-12）
  assertSomePackageChoice(deps, interview);
  const at = deps.now().toISOString();
  const closed = withRound(record, index, { ...round, closedAt: at, candidateDrugIds: interview.selectedDrugs });
  let next = moveTo(deps, closed, "drug_selection");
  next = {
    ...next,
    interview,
    events: [
      ...next.events,
      event(deps, "candidate_drugs_chosen", interview.selectedDrugs),
      event(deps, "drugs_selected", interview.selectedDrugs),
    ],
  };
  next = enforcePackageLimit(deps, next);
  if (nextQuestion(next.interview) !== null) next = moveTo(deps, next, "interview");
  deps.store.set(next);
  return next;
}

/** この確認で禁忌を解除した薬 */
export function overriddenDrugIdsOf(round: PharmacistReviewRound): StockedDrugId[] {
  return [...new Set((round.overrides ?? []).map((o) => o.drugId))];
}

/**
 * 禁忌を解除する（T9b。CLAUDE.md 絶対に守るルール4・C-14）。
 * - 薬剤師の PIN で再認証する（違えば記録は変わらない）。
 * - 薬剤師の確認中で、患者さんが選んだ薬のうち、今の判定で禁忌の薬だけを解除できる。
 * - 理由はリストから選ぶ（「その他」は文が必須）。解除したことは記録に足し、履歴には薬と理由の種類だけを残す。
 * - 解除しても、販売する薬に選ぶのは別の操作（薬剤師が選ぶ）。
 */
export function overrideContraindication(
  deps: ServiceDeps,
  pins: PinVerifier,
  id: string,
  input: { drugId: string; pharmacistId: string; pin: string; reasonCode: string; reasonText: string | null },
): SessionRecord {
  const now = deps.now();
  const pharmacist = pins.verify(input.pharmacistId, input.pin, now);
  const record = load(deps, id);
  const { index, round } = currentRound(record);
  const drugId = input.drugId as StockedDrugId;
  if (!record.interview.selectedDrugs.includes(drugId)) {
    throw new SessionServiceError("INVALID_REQUEST", "患者さんが選んだ薬の中から選んでください");
  }
  const judgment = judgmentsOf(record).find((j) => j.drugId === drugId);
  if (!judgment || judgment.verdict !== "contraindicated") {
    throw new DomainRuleError("NOT_CONTRAINDICATED", "禁忌ではない薬は解除しません");
  }
  const reason = checkOverrideReason(input.reasonCode, input.reasonText);
  const override: ContraindicationOverride = {
    at: now.toISOString(),
    drugId,
    pharmacist: { id: pharmacist.id, name: pharmacist.name },
    reasonCode: reason.code,
    reasonText: reason.text,
    judgedReasons: judgment.reasons.filter((r) => r.verdict === "contraindicated").map((r) => r.label),
  };
  const next: SessionRecord = {
    ...withRound(record, index, { ...round, overrides: [...(round.overrides ?? []), override] }),
    events: [...record.events, event(deps, "contraindication_overridden", [drugId, reason.code, pharmacist.id])],
  };
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

/**
 * 薬の基本の情報（添付文書の基本の項目にあたるもの。docs/demo-data/drugs.md の架空のデータ。11/7 依頼主の要望）。
 * 成分は架空成分の記号と種類だけを出す（実在の成分名・商品名は出さない）
 */
export interface DrugInfoView {
  readonly ingredients: readonly { readonly name: string; readonly kind: string }[];
  /** 表に「ほか」とあり、成分の全部はわからない */
  readonly hasUnlistedIngredients: boolean;
  /** 効き目の分類 */
  readonly category: string;
  /** 用法・用量（表のとおり） */
  readonly usage: string;
  /** 年齢別の用量の表がある薬だけ：患者さんの年齢に当たる1回量（服用しない年齢なら null） */
  readonly doseForPatient: { readonly dose: string | null } | null;
  readonly packages: string;
  /** 服用できない年齢（この年齢未満）。制限なしは null */
  readonly minAge: number | null;
}

function drugInfoOf(drugId: StockedDrugId, age: number | undefined): DrugInfoView {
  const drug = findStockedDrug(drugId);
  const row = age === undefined ? null : doseForAge(drugId, age);
  return {
    ingredients: drug.ingredients.map((id) => ({ name: INGREDIENTS[id].name, kind: INGREDIENTS[id].kind })),
    hasUnlistedIngredients: drug.hasUnlistedIngredients,
    category: drug.category,
    usage: drug.usage,
    doseForPatient: row === null ? null : { dose: row.dose },
    packages: drug.packages,
    minAge: drug.minAge,
  };
}

export interface PharmacistDrugView {
  readonly info: DrugInfoView;
  /** この確認での禁忌の解除（最後のもの。なければ null。T9b） */
  readonly override: ContraindicationOverride | null;
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
  /**
   * 前に選んでいて、選び直しで外れた薬の名前と、その薬のために聞いて残っている答えの項目（判定に使う。11/7 依頼主の判断。backlog C-17）
   */
  readonly pastDrugNames: readonly string[];
  readonly keptQuestionIds: readonly QuestionId[];
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
  /** 薬剤師が一度でも「緊急ではない」と判断したか（翻訳のチャットに渡す。patientView と同じ。CLAUDE.md ルール2の例外） */
  readonly emergencyCleared: boolean;
  /** 承認したときの販売記録（承認していなければ null。T9a） */
  readonly saleRecord: SaleRecord | null;
  /** 今の説明書（販売する薬・承認した品目と同じもの。なければ null。T10） */
  readonly guidance: GuidanceRecord | null;
  /** 承認のあと：会計の前の手順と、理解の確認・評価（T10） */
  readonly afterApproval: {
    readonly steps: readonly { readonly id: string; readonly label: string; readonly done: boolean; readonly byPatient: boolean }[];
    readonly understanding: "not_yet" | "confirmed";
    /** 最後の「わかった」以外の答え（もう一度説明するため。なければ null） */
    readonly lastNotUnderstood: string | null;
    readonly printed: boolean;
    readonly feedback: string | null;
  } | null;
  /**
   * 候補の薬・代わりの薬（取扱薬すべて。いま選んでいる薬も含む）の、いまの答えでの仮の判定（薬剤師の確認中だけ。backlog C-03）。
   * 禁忌にならない薬が先。選ぶと、その薬の項目を聞く問診に戻る
   */
  readonly candidates: readonly (CandidatePreview & {
    readonly name: string;
    readonly classification: string;
    readonly info: DrugInfoView;
  })[];
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
      info: drugInfoOf(drug.id, record.interview.answers.age),
      override: (round?.overrides ?? []).filter((o) => o.drugId === drug.id).at(-1) ?? null,
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
    pastDrugNames: (record.interview.pastDrugs ?? []).map((d) => STOCKED_DRUGS.find((s) => s.id === d)?.name ?? d),
    keptQuestionIds: keptQuestionsFromPastDrugs(record.interview),
    symptomText: record.symptomText,
    drugs,
    saleDrugIds,
    procedure,
    procedureError,
    checkHistory,
    declinedReason: round?.declinedReason ?? null,
    emergencyCleared: patientView(record).emergencyCleared,
    saleRecord: record.saleRecord ?? null,
    guidance: guidanceForView(record, reviewing ? saleDrugIds : null),
    afterApproval: afterApprovalOf(record),
    candidates: reviewing ? candidatesOf(record) : [],
  };
}

/** 今の説明書。確認中は今の「販売する薬」と同じもの、承認のあとは承認した品目と同じもの（T10） */
function guidanceForView(record: SessionRecord, reviewingDrugIds: readonly StockedDrugId[] | null): GuidanceRecord | null {
  if (!activeApproval(record.saleRecord) && (reviewingDrugIds === null || reviewingDrugIds.length === 0)) return null;
  return currentGuidance(record);
}

function afterApprovalOf(record: SessionRecord): PharmacistView["afterApproval"] {
  const sale = record.saleRecord;
  const latest = sale?.versions.at(-1);
  // 承認を取り消している間は出さない（もう一度承認するまで、承認のあとの手順はない）
  const base = activeApproval(sale);
  if (!sale || !latest || !base) return null;
  const done = new Set(completedStepsAfterApproval(record));
  const steps = procedureAtApproval(record)
    .steps.filter((s) => s.gate === "before_checkout")
    .map((s) => ({ id: s.id, label: s.label, done: done.has(s.id), byPatient: s.id === "understanding_check" }));
  // 今の承認のあと、理解の確認をやり直したあとの答えだけを見る
  const since = sinceOfUnderstanding(sale, base);
  const answers = record.events
    .filter((e) => e.type === "understanding_answered" && e.at >= since)
    .map((e) => e.detail[0] ?? "");
  const last = answers.at(-1) ?? null;
  return {
    steps,
    understanding: latest.understanding,
    lastNotUnderstood: last !== null && last !== "understood" ? last : null,
    printed: record.events.some((e) => e.type === "guidance_printed"),
    feedback: record.feedback?.rating ?? null,
  };
}

function candidatesOf(record: SessionRecord): PharmacistView["candidates"] {
  // いま選んでいる薬も並べる（例：A と J から J だけに選び直せるように。11/7 依頼主の判断・C-17）
  const ids = STOCKED_DRUGS.map((d) => d.id);
  return previewCandidates(record.interview, ids).map((preview) => {
    const drug = STOCKED_DRUGS.find((d) => d.id === preview.drugId);
    if (!drug) throw new DomainRuleError("UNKNOWN_DRUG", `取扱薬 ${preview.drugId} が見つかりません`);
    return { ...preview, name: drug.name, classification: drug.classification, info: drugInfoOf(drug.id, record.interview.answers.age) };
  });
}
