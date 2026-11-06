/**
 * 接客1件ごとの記録と、その進め方（サーバー側）。
 *
 * - ハッカソン版はデータベースを使わず、サーバーのメモリに置く。サーバーを止めると消える（docs/backlog.md S-03）。
 * - 次に聞く項目・状態の進め方・答えの確かめは、すべて packages/domain のルールで行う（CLAUDE.md 絶対に守るルール3）。
 * - 記録の履歴（events）は足すだけで、書き換えない（ルール6の考え方）。
 * - 問診の答えや入力された文をログに出さない（ルール9）。エラーの文にも項目 ID しか入れない。
 */

import {
  DomainRuleError,
  EMERGENCY_RULES,
  applyAnswersWithReport,
  chooseRoute as chooseInterviewRoute,
  isTerminal,
  isBasicInterviewComplete,
  isInterviewComplete,
  nextQuestion,
  selectDrugs as selectInterviewDrugs,
  transition,
  cancelEmergencyEnd,
  checkPackageAnswer,
  packageChoiceOptions,
  selectProcedureVersion,
  type InterviewAnswers,
  type PackageChoice,
  type QuantityNoticeKind,
  type QuantityRules,
  type InterviewRoute,
  type InterviewState,
  type QuestionId,
  type SessionSnapshot,
  type SessionStatus,
  type StockedDrugId,
} from "@moda/domain";
import { isSupportedLanguage, type LanguageCode } from "@moda/i18n";

import { japanDate } from "./japan-date.ts";
import type { PharmacistReviewRound } from "./pharmacist-service";

/** セッションが見つからないなど、ルール以外の理由で処理できないとき */
export type SessionServiceErrorCode = "SESSION_NOT_FOUND" | "UNSUPPORTED_LANGUAGE" | "INVALID_REQUEST";

export class SessionServiceError extends Error {
  readonly code: SessionServiceErrorCode;

  constructor(code: SessionServiceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "SessionServiceError";
  }
}

/** 緊急の確認のきっかけ（spec.md 決まったこと No.38：キーワードの検知か、薬剤師が手動で開いたか、AI の緊急フラグ〈T13〉か） */
export type EmergencyTrigger = "keyword" | "staff" | "ai";

/** 緊急の確認画面で集めたもの（追加の質問 EF01〜EF09、つらさの数字 ES01、観察の印） */
export interface EmergencyFollowUp {
  readonly answers: Readonly<Record<string, string>>;
  readonly scale: number | null;
  readonly observedRuleIds: readonly string[];
}

/** 送られた時刻つきの、緊急の確認画面の内容（送り直しても前の内容を消さず、足していく） */
export interface RecordedFollowUp extends EmergencyFollowUp {
  readonly at: string;
}

/** 自由に入力された文の長さの上限（メモリにため込みすぎないため） */
export const MAX_TEXT_LENGTH = 500;
/** 一覧で答える項目（薬の名前、選択肢の一覧）の数の上限 */
export const MAX_NAME_LIST_LENGTH = 20;

export type EmergencyDecision = "show_119" | "not_emergency";

/** 緊急の出来事。問診の記録に紐づけて残す（docs/backlog.md C-04） */
export interface EmergencyEvent {
  readonly openedAt: string;
  readonly trigger: EmergencyTrigger;
  /** 当てはまった緊急症状の表の ID（EA01 など）。手動で開いたときは空 */
  readonly matchedRuleIds: readonly string[];
  /** 検知のもとになった患者さんの入力（薬剤師が根拠を確認するため。ログには出さない） */
  readonly inputText: string | null;
  /** 確認に入る前の状態 */
  readonly returnTo: SessionStatus;
  /** 緊急の確認画面の内容。送られるたびに足す（最後のものが今の内容）。判断の根拠を後から確かめられるよう、前の内容も残す */
  readonly followUps: readonly RecordedFollowUp[];
  readonly decision: EmergencyDecision | null;
  readonly decidedAt: string | null;
  /** 「119番の案内を出す」を薬剤師が押し間違いとして取り消した時刻（取り消していなければ null。もとの判断は消さずに残す） */
  readonly cancelledAt: string | null;
}

/** 何が起きたかの履歴。中身（答えや入力）は入れず、種類と項目 ID だけを残す */
export type SessionEventType =
  | "created"
  | "answered"
  | "corrected"
  | "answers_cleared"
  | "answers_ignored"
  | "drugs_selected"
  | "route_chosen"
  | "status_changed"
  | "emergency_opened"
  | "emergency_follow_up"
  | "emergency_decided"
  | "emergency_cancelled"
  // 薬剤師の確認（T8a。apps/web/src/server/pharmacist-service.ts）
  | "pharmacist_review_opened"
  | "sale_drugs_chosen"
  | "procedure_step_checked"
  | "sale_declined"
  // 候補・代わりの薬を薬剤師が選び、その薬の項目を聞く問診に戻した（T8b。backlog C-03）
  | "candidate_drugs_chosen";

export interface SessionEvent {
  readonly at: string;
  readonly type: SessionEventType;
  /** 答えた項目 ID、選んだ薬の記号、変わった後の状態など（健康情報の中身は入れない） */
  readonly detail: readonly string[];
}

export interface SessionRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly language: LanguageCode;
  readonly snapshot: SessionSnapshot;
  readonly interview: InterviewState;
  /** 「症状から探す」で入力された症状（薬剤師の画面で候補を選ぶのに使う。ログ・履歴には出さない） */
  readonly symptomText: string | null;
  readonly emergencies: readonly EmergencyEvent[];
  /** 薬剤師の確認（T8a）。確認の画面を開くたびに1つ足す（なければ空。中身は pharmacist-service.ts） */
  readonly pharmacistReviews?: readonly PharmacistReviewRound[];
  readonly events: readonly SessionEvent[];
}

/** 患者さんの画面に返す内容（答えの中身は返さない。年齢だけは緊急キーワードの確認に使うので返す） */
export interface PatientView {
  readonly id: string;
  readonly language: LanguageCode;
  readonly status: SessionStatus;
  /** 問診の流れ（ほしい薬がある／症状から探す）。まだ選んでいなければ null */
  readonly route: InterviewRoute | null;
  /** 次に聞く項目。聞く項目がなければ null */
  readonly nextQuestion: QuestionId | null;
  readonly selectedDrugs: readonly StockedDrugId[];
  /** 基本の項目を答え終えたか（薬の選択に進めるか） */
  readonly basicInterviewComplete: boolean;
  /** 選んだ薬の項目まで答え終えたか */
  readonly interviewComplete: boolean;
  /**
   * この接客で、薬剤師が一度でも緊急の確認をして「緊急ではない」と判断したか（119番の案内の押し間違いの取り消しは含めない）。
   * true なら、画面は以降の入力で緊急キーワードによる自動の切り替えをしない。薬剤師は手動で緊急の確認を開ける
   * （11/6 依頼主の判断。CLAUDE.md 絶対に守るルール2・spec.md 決まったこと No.38 の例外）
   */
  readonly emergencyCleared: boolean;
  /** 年齢（Q01）の答え。画面を読み直したときに、緊急キーワードの確認で子どもの項目を使うかを決め直すため（T8a）。まだなら null */
  readonly age: number | null;
  /**
   * 次の質問が R02（買いたい個数・包装）のときだけ：選べる選択肢と注意文（18歳未満の大容量・複数個。backlog M-12）。
   * 年齢・個数は販売手順の版のデータの値（画面の注意文に差し込む。ルール5）
   */
  readonly packageOptions: {
    readonly allowed: readonly PackageChoice[];
    readonly notices: readonly QuantityNoticeKind[];
    readonly minorAgeBelow: number;
    readonly minorMaxQuantity: number;
  } | null;
}

export interface SessionStore {
  get(id: string): SessionRecord | undefined;
  set(record: SessionRecord): void;
}

/** サーバーのメモリに置く入れ物。開発サーバーの再読み込みで消えないよう globalThis に置く */
export function memoryStore(): SessionStore {
  const holder = globalThis as unknown as { __modaSessions?: Map<string, SessionRecord> };
  holder.__modaSessions ??= new Map();
  const map = holder.__modaSessions;
  return { get: (id) => map.get(id), set: (record) => void map.set(record.id, record) };
}

export interface ServiceDeps {
  readonly store: SessionStore;
  readonly now: () => Date;
  readonly newId: () => string;
}

export function defaultDeps(): ServiceDeps {
  return { store: memoryStore(), now: () => new Date(), newId: () => crypto.randomUUID() };
}

// ---------------------------------------------------------------------------

export function load(deps: ServiceDeps, id: string): SessionRecord {
  const record = deps.store.get(id);
  if (!record) throw new SessionServiceError("SESSION_NOT_FOUND", "接客の記録が見つかりません");
  return record;
}

export function event(deps: ServiceDeps, type: SessionEventType, detail: readonly string[] = []): SessionEvent {
  return { at: deps.now().toISOString(), type, detail };
}

/** 状態を進め、履歴に残す */
export function moveTo(deps: ServiceDeps, record: SessionRecord, to: SessionStatus): SessionRecord {
  const snapshot = transition(record.snapshot, to);
  return { ...record, snapshot, events: [...record.events, event(deps, "status_changed", [to])] };
}

/**
 * 問診の進み具合に合わせて状態を進める。
 * - 年齢・性別（Q01・Q02）を答えたら「問診」へ
 * - 基本の項目を答え終えたら「薬の選択」へ
 * - 薬を選んで、その薬の項目まで答え終えたら「薬の選択」へ戻る（薬剤師の確認は T8）
 */
function advance(deps: ServiceDeps, record: SessionRecord): SessionRecord {
  let current = record;
  const { answers } = current.interview;
  if (current.snapshot.status === "attributes" && answers.age !== undefined && answers.sex !== undefined) {
    current = moveTo(deps, current, "interview");
  }
  if (current.snapshot.status === "interview") {
    const done =
      current.interview.selectedDrugs.length === 0
        ? isBasicInterviewComplete(current.interview)
        : isInterviewComplete(current.interview);
    if (done) current = moveTo(deps, current, "drug_selection");
  }
  return current;
}

export function patientView(record: SessionRecord, now: Date = new Date()): PatientView {
  const status = record.snapshot.status;
  // 問診を進めてよい状態のときだけ、次に聞く項目を返す（緊急の確認中などに質問を出さないため）
  const asking = status === "attributes" || status === "interview";
  const next = asking ? nextQuestion(record.interview) : null;
  const age = record.interview.answers.age;
  let packageOptions: PatientView["packageOptions"] = null;
  if (next === "R02" && age !== undefined) {
    const rules = quantityRulesAt(now);
    packageOptions = {
      ...packageChoiceOptions(record.interview.selectedDrugs, age, rules),
      minorAgeBelow: rules.minorAgeBelow,
      minorMaxQuantity: rules.minorMaxQuantity,
    };
  }
  return {
    id: record.id,
    language: record.language,
    status,
    route: record.interview.route ?? null,
    nextQuestion: next,
    selectedDrugs: record.interview.selectedDrugs,
    basicInterviewComplete: isBasicInterviewComplete(record.interview),
    interviewComplete: isInterviewComplete(record.interview),
    emergencyCleared: record.emergencies.some((e) => e.decision === "not_emergency"),
    age: record.interview.answers.age ?? null,
    packageOptions,
  };
}

// ---------------------------------------------------------------------------
// R02 の時点の個数・包装の制限（18歳未満の大容量・複数個。backlog M-12・sales-procedures.md S09・S10）
// ---------------------------------------------------------------------------

/** 店頭の日付（日本時間）の販売手順の版の数量基準 */
export function quantityRulesAt(now: Date): QuantityRules {
  return selectProcedureVersion(japanDate(now)).quantityRules;
}

const PACKAGE_KEYS = ["packageChoice", "multipleCount"] as const;

/** R02 の答えが、いまの年齢・選んだ薬で選べるか（答えがなければ選べるとみなす） */
function packageAnswerAllowed(interview: InterviewState, rules: QuantityRules): boolean {
  const { age, packageChoice, multipleCount } = interview.answers;
  if (age === undefined || packageChoice === undefined) return true;
  const abuse = multipleCount === undefined ? { packageChoice } : { packageChoice, multipleCount };
  return checkPackageAnswer(interview.selectedDrugs, abuse, age, rules).allowed;
}

/**
 * 18歳未満で、R02 にどの包装も選べない薬の組み合わせ（例：B と E を一緒に。種類が違っても合わせて数える。決定12）なら止める。
 * 問診に戻っても R02 に答えられないため、薬を選ぶ時点で止める（M-12）
 */
export function assertSomePackageChoice(deps: ServiceDeps, interview: InterviewState): void {
  const age = interview.answers.age;
  if (!interview.selectedDrugs.includes("E") || age === undefined) return;
  if (packageChoiceOptions(interview.selectedDrugs, age, quantityRulesAt(deps.now())).allowed.length === 0) {
    throw new DomainRuleError("QUANTITY_NOT_ALLOWED", "この年齢では、この薬の組み合わせは販売できません");
  }
}

/**
 * 記録にある R02 の答えが、年齢の訂正や薬の選び直しで選べなくなったら、その答え（と、それで聞いた R03）を消して聞き直す。
 * 消したことは種類だけを履歴に残す（中身は残さない）。呼んだあとに、次の質問があれば問診に戻すこと。
 */
export function enforcePackageLimit(deps: ServiceDeps, record: SessionRecord): SessionRecord {
  if (packageAnswerAllowed(record.interview, quantityRulesAt(deps.now()))) return record;
  const answers: InterviewAnswers = { ...record.interview.answers };
  for (const key of PACKAGE_KEYS) delete answers[key];
  const hadReason = answers.reasonText !== undefined;
  // 包装の答えを消すと R03（大容量・複数個の理由）も聞かなくなるので、聞かなくなった答えを消す
  const interview = selectInterviewDrugs({ ...record.interview, answers }, record.interview.selectedDrugs);
  const cleared = ["R02", ...(hadReason && interview.answers.reasonText === undefined ? ["R03"] : [])];
  return { ...record, interview, events: [...record.events, event(deps, "answers_cleared", cleared)] };
}

/** 言語を選んで接客を始める。言語選択はここで済んだことになり、年齢・性別を聞く状態から始める */
export function createSession(deps: ServiceDeps, language: string): SessionRecord {
  if (!isSupportedLanguage(language)) {
    throw new SessionServiceError("UNSUPPORTED_LANGUAGE", "対応していない言語です");
  }
  const at = deps.now().toISOString();
  const base: SessionRecord = {
    id: deps.newId(),
    createdAt: at,
    language,
    snapshot: { status: "language_selection", understandingConfirmed: false },
    interview: { answers: {}, selectedDrugs: [] },
    symptomText: null,
    emergencies: [],
    events: [{ at, type: "created", detail: [language] }],
  };
  const record = moveTo(deps, base, "attributes");
  deps.store.set(record);
  return record;
}

export function getSession(deps: ServiceDeps, id: string): SessionRecord {
  return load(deps, id);
}

/**
 * 問診の答えを受け取る。決められた形でない答えや、聞かない項目への答えは DomainRuleError で止まり、
 * 記録は変わらない（呼び出す側は同じ質問をもう一度出す）。
 */
export function answer(deps: ServiceDeps, id: string, answers: InterviewAnswers): SessionRecord {
  const record = load(deps, id);
  const status = record.snapshot.status;
  if (isTerminal(status)) {
    throw new DomainRuleError("SESSION_ALREADY_ENDED", "終了した接客には答えを受け取れません");
  }
  if (status !== "attributes" && status !== "interview" && status !== "drug_selection") {
    throw new DomainRuleError("INVALID_TRANSITION", `${status} の状態では問診の答えを受け取れません`);
  }
  for (const value of Object.values(answers)) {
    if (typeof value === "string" && value.length > MAX_TEXT_LENGTH) {
      throw new SessionServiceError("INVALID_REQUEST", "入力が長すぎます");
    }
    // 薬の名前（Q08・Q09）は文の一覧。数と、1つずつの長さに上限をかける（メモリにため込みすぎないため）
    if (Array.isArray(value)) {
      if (value.length > MAX_NAME_LIST_LENGTH) throw new SessionServiceError("INVALID_REQUEST", "入力が多すぎます");
      for (const item of value as unknown[]) {
        if (typeof item === "string" && item.length > MAX_TEXT_LENGTH) {
          throw new SessionServiceError("INVALID_REQUEST", "入力が長すぎます");
        }
      }
    }
  }
  const before = record.interview.answers;
  const { state: interview, ignored } = applyAnswersWithReport(record.interview, answers);
  const keys = Object.keys(answers) as (keyof InterviewAnswers)[];
  // 聞かない項目への答え（捨てたもの）は「答えた」に入れない
  const answered = keys.filter((key) => answers[key] !== undefined && interview.answers[key] !== undefined);
  // 訂正した項目と、訂正で聞く必要がなくなって消えた項目を、種類だけ履歴に残す（中身は残さない）
  const corrected = answered.filter((key) => before[key] !== undefined && JSON.stringify(before[key]) !== JSON.stringify(answers[key]));
  const cleared = (Object.keys(before) as (keyof InterviewAnswers)[]).filter(
    (key) => before[key] !== undefined && interview.answers[key] === undefined,
  );
  const newEvents = [event(deps, "answered", answered)];
  if (corrected.length > 0) newEvents.push(event(deps, "corrected", corrected));
  if (cleared.length > 0) newEvents.push(event(deps, "answers_cleared", cleared));
  if (ignored.length > 0) newEvents.push(event(deps, "answers_ignored", ignored));
  // 18歳未満の大容量・複数個は、R02 の答えとしては受け取らない（記録は変わらない。画面は同じ質問を出す。M-12）
  if (PACKAGE_KEYS.some((key) => answers[key] !== undefined) && !packageAnswerAllowed(interview, quantityRulesAt(deps.now()))) {
    throw new DomainRuleError("QUANTITY_NOT_ALLOWED", "この年齢・個数・包装の組み合わせは選べません");
  }
  let next: SessionRecord = { ...record, interview, events: [...record.events, ...newEvents] };
  // 年齢を直して、前の R02 の答えが選べなくなったら、聞き直す
  next = enforcePackageLimit(deps, next);
  // 薬の選択のあとに答え直して聞く項目が増えたら、問診に戻る
  if (next.snapshot.status === "drug_selection" && nextQuestion(next.interview) !== null) {
    next = moveTo(deps, next, "interview");
  }
  next = advance(deps, next);
  deps.store.set(next);
  return next;
}

/**
 * 問診の流れを選ぶ（11/6 依頼主の判断）。年齢・性別を答えたあと、薬を選ぶ前に選ぶ（選び直しもできる）。
 * - product：ほしい薬がある → すぐに薬の選択へ（その薬の判定に使う項目だけを、あとで聞く）
 * - symptom：症状から探す → 基本の項目をすべて聞く。入力された症状は記録に残す（履歴には中身を入れない）
 */
export function chooseRoute(
  deps: ServiceDeps,
  id: string,
  route: InterviewRoute,
  symptomText: string | null = null,
): SessionRecord {
  const record = load(deps, id);
  const status = record.snapshot.status;
  if ((status !== "interview" && status !== "drug_selection") || record.interview.selectedDrugs.length > 0) {
    throw new DomainRuleError("INVALID_TRANSITION", "年齢・性別を答えたあと、薬を選ぶ前に流れを選びます");
  }
  if (symptomText !== null && (symptomText.trim() === "" || symptomText.length > MAX_TEXT_LENGTH)) {
    throw new SessionServiceError("INVALID_REQUEST", "症状の入力の形が違います");
  }
  const interview = chooseInterviewRoute(record.interview, route);
  let next: SessionRecord = {
    ...record,
    interview,
    symptomText: route === "symptom" ? symptomText : null,
    events: [...record.events, event(deps, "route_chosen", [route])],
  };
  if (next.snapshot.status === "drug_selection" && nextQuestion(next.interview) !== null) {
    next = moveTo(deps, next, "interview");
  }
  next = advance(deps, next);
  deps.store.set(next);
  return next;
}

/** 薬を選ぶ（希望の薬・候補の薬）。選んだ薬の項目が残っていれば問診に戻る */
export function chooseDrugs(deps: ServiceDeps, id: string, drugIds: readonly StockedDrugId[]): SessionRecord {
  let record = load(deps, id);
  // 薬を選んだあと、その薬の項目に答えている途中でも選び直せる（基本の項目は答え終えているとき）
  if (
    record.snapshot.status === "interview" &&
    record.interview.selectedDrugs.length > 0 &&
    // 「ほしい薬がある」では、薬ごとに聞く基本の項目に答えている途中でも選び直せる
    (record.interview.route === "product" || isBasicInterviewComplete(record.interview))
  ) {
    record = moveTo(deps, record, "drug_selection");
  }
  if (record.snapshot.status !== "drug_selection") {
    throw new DomainRuleError("INVALID_TRANSITION", "基本の問診を答え終えてから薬を選びます");
  }
  if (drugIds.length === 0) {
    throw new SessionServiceError("INVALID_REQUEST", "薬が選ばれていません");
  }
  const interview = selectInterviewDrugs(record.interview, drugIds);
  assertSomePackageChoice(deps, interview);
  let next: SessionRecord = {
    ...record,
    interview,
    events: [...record.events, event(deps, "drugs_selected", interview.selectedDrugs)],
  };
  // 薬を足して、前の R02 の答えが選べなくなったら、聞き直す（M-12）
  next = enforcePackageLimit(deps, next);
  if (nextQuestion(next.interview) !== null) next = moveTo(deps, next, "interview");
  deps.store.set(next);
  return next;
}

// ---------------------------------------------------------------------------
// 緊急の確認（spec.md 決まったこと No.38）
// ---------------------------------------------------------------------------

const KNOWN_RULE_IDS = new Set(EMERGENCY_RULES.map((rule) => rule.id));
/** 緊急の確認画面の追加の質問の ID（EF01〜EF09）。定義はまだ画面の中にある（docs/backlog.md S-10） */
const FOLLOW_UP_QUESTION_ID = /^EF\d{2}$/;

/** 緊急症状の表（emergency.md）にある ID だけを受け取る。自由な文を記録や履歴に入れないため */
function assertKnownRuleIds(ids: readonly string[]): void {
  for (const id of ids) {
    if (!KNOWN_RULE_IDS.has(id)) throw new SessionServiceError("INVALID_REQUEST", "緊急症状の ID が表にありません");
  }
}

function openEmergencyOf(record: SessionRecord): { index: number; event: EmergencyEvent } {
  const index = record.emergencies.findIndex((e) => e.decision === null);
  const found = record.emergencies[index];
  if (record.snapshot.status !== "emergency_review" || index < 0 || !found) {
    throw new DomainRuleError("INVALID_TRANSITION", "緊急の確認中ではありません");
  }
  return { index, event: found };
}

/** 緊急の確認を開く（問診をすぐに止める）。キーワードの検知でも、薬剤師が手動で開いてもよい */
export function openEmergency(
  deps: ServiceDeps,
  id: string,
  input: { trigger: EmergencyTrigger; matchedRuleIds?: readonly string[]; inputText?: string | null },
): SessionRecord {
  const record = load(deps, id);
  assertKnownRuleIds(input.matchedRuleIds ?? []);
  if (input.inputText != null && input.inputText.length > MAX_TEXT_LENGTH) {
    throw new SessionServiceError("INVALID_REQUEST", "入力が長すぎます");
  }
  const returnTo = record.snapshot.status;
  const moved = moveTo(deps, record, "emergency_review");
  const emergency: EmergencyEvent = {
    openedAt: deps.now().toISOString(),
    trigger: input.trigger,
    matchedRuleIds: [...(input.matchedRuleIds ?? [])],
    inputText: input.inputText ?? null,
    returnTo,
    followUps: [],
    decision: null,
    decidedAt: null,
    cancelledAt: null,
  };
  const next: SessionRecord = {
    ...moved,
    emergencies: [...moved.emergencies, emergency],
    events: [...moved.events, event(deps, "emergency_opened", [input.trigger, ...emergency.matchedRuleIds])],
  };
  deps.store.set(next);
  return next;
}

/** 緊急の確認画面で集めた追加の質問の答え・つらさの数字・観察の印を残す（確認中は何度でも上書きできる） */
export function recordEmergencyFollowUp(deps: ServiceDeps, id: string, followUp: EmergencyFollowUp): SessionRecord {
  const record = load(deps, id);
  const { index, event: open } = openEmergencyOf(record);
  if (followUp.scale !== null && !(Number.isInteger(followUp.scale) && followUp.scale >= 0 && followUp.scale <= 10)) {
    throw new SessionServiceError("INVALID_REQUEST", "つらさの数字は0〜10で入れてください");
  }
  assertKnownRuleIds(followUp.observedRuleIds);
  for (const [key, value] of Object.entries(followUp.answers)) {
    // 追加の質問の ID（EF01〜EF09）と、決まった選択肢の短い値だけを受け取る（自由な文を記録に入れない）
    if (!FOLLOW_UP_QUESTION_ID.test(key) || value.length > 40) {
      throw new SessionServiceError("INVALID_REQUEST", "追加の質問の答えの形が違います");
    }
  }
  const recorded: RecordedFollowUp = { ...followUp, at: deps.now().toISOString() };
  const emergencies = record.emergencies.map((e, i) => (i === index ? { ...open, followUps: [...open.followUps, recorded] } : e));
  const next: SessionRecord = {
    ...record,
    emergencies,
    events: [...record.events, event(deps, "emergency_follow_up", Object.keys(followUp.answers))],
  };
  deps.store.set(next);
  return next;
}

/**
 * 薬剤師の判断を残す。
 * - 「119番の案内を出す」→ 緊急終了
 * - 「緊急ではない」→ 確認に入る前の状態に戻る
 */
export function decideEmergency(deps: ServiceDeps, id: string, decision: EmergencyDecision): SessionRecord {
  const record = load(deps, id);
  const { index, event: open } = openEmergencyOf(record);
  const at = deps.now().toISOString();
  const decided: EmergencyEvent = { ...open, decision, decidedAt: at };
  const withDecision: SessionRecord = {
    ...record,
    emergencies: record.emergencies.map((e, i) => (i === index ? decided : e)),
    events: [...record.events, event(deps, "emergency_decided", [decision])],
  };
  const next = moveTo(deps, withDecision, decision === "show_119" ? "emergency_ended" : open.returnTo);
  deps.store.set(next);
  return next;
}

/**
 * 「119番の案内を出す」を、薬剤師が押し間違いとして取り消し、押す前の薬剤師の確認（緊急を確認中）に戻す
 * （11/6 依頼主の判断。押し間違いは「緊急ではない」という判断ではないので、問診には戻さない）。
 * - 取り消せるのは、緊急終了で、いちばん新しい緊急の判断が「119番の案内を出す」で、まだ取り消していないときだけ。
 * - もとの判断は消さず、取り消した時刻と履歴を足して残す（上書きしない）。
 * - 確認をやり直すため、同じ根拠（入力した文・当てはまった項目）で、判断前の緊急の記録を1つ足す。
 */
export function cancelEmergency119(deps: ServiceDeps, id: string): SessionRecord {
  const record = load(deps, id);
  const index = record.emergencies.length - 1;
  const last = record.emergencies[index];
  if (
    record.snapshot.status !== "emergency_ended" ||
    !last ||
    last.decision !== "show_119" ||
    last.cancelledAt !== null
  ) {
    throw new DomainRuleError("INVALID_TRANSITION", "取り消せる「119番の案内」がありません");
  }
  const snapshot = cancelEmergencyEnd(record.snapshot);
  const at = deps.now().toISOString();
  // 追加の答えは写さない（前の内容は前の記録に残っていて、次の判断のときに画面の内容をあらためて記録するため）
  const reopened: EmergencyEvent = { ...last, openedAt: at, followUps: [], decision: null, decidedAt: null, cancelledAt: null };
  const next: SessionRecord = {
    ...record,
    snapshot,
    emergencies: [...record.emergencies.map((e, i) => (i === index ? { ...e, cancelledAt: at } : e)), reopened],
    events: [
      ...record.events,
      event(deps, "emergency_cancelled", ["show_119"]),
      event(deps, "status_changed", [snapshot.status]),
    ],
  };
  deps.store.set(next);
  return next;
}
