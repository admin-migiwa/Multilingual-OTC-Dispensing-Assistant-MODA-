/**
 * 問診の進め方（1問1答）。次に聞く項目を決め、答えを受け取り、問診が終わったかを判定する。
 *
 * - 次に聞く項目はここで決める。画面や AI には決めさせない（CLAUDE.md 絶対に守るルール3）。
 * - 答えは決められた形かを確かめ、外れていたら止める（ルール7・8）。推測で読み替えない。
 * - 必要な項目がそろうまで問診を終えない（ルール3）。
 */

import { DomainRuleError } from "../errors.ts";
import { INTEGER_ANSWER_RANGES, assertValidFacts, isIntegerInRange, type InterviewFacts } from "../contraindication/facts.ts";
import type { StockedDrugId } from "../contraindication/data.ts";
import { findStockedDrug, questionsUsedByDrug } from "../contraindication/judge.ts";
import {
  DEFAULT_INTERVIEW_SETTINGS,
  type AbusePreventionAnswers,
  PACKAGE_CHOICES,
  QUESTIONS,
  findQuestion,
  type AskContext,
  type InterviewAnswers,
  type InterviewRoute,
  type InterviewSettings,
  type QuestionDefinition,
  type QuestionId,
} from "./items.ts";

export interface InterviewState {
  readonly answers: InterviewAnswers;
  readonly selectedDrugs: readonly StockedDrugId[];
  /** 問診の流れ（ほしい薬がある／症状から探す）。決まるまでは年齢・性別だけを聞く */
  readonly route?: InterviewRoute;
  /**
   * 前に選んでいて、選び直しで外れた薬（11/7 依頼主の判断。backlog C-17）。
   * その薬のために聞いた答えは、選び直しても消さずに残し、判定に使い続ける（例：A のために聞いた妊娠の答えを、J だけに選び直したあとも J の判定に使う。K47 の考え方）。
   * 次に聞く項目は、いま選んでいる薬だけで決める（外れた薬の項目を聞き直さない）
   */
  readonly pastDrugs?: readonly StockedDrugId[];
}

/** いま選んでいる薬と、前に選んでいた薬（答えを残すかを決めるときに使う） */
function drugsWithPast(state: InterviewState): StockedDrugId[] {
  return [...new Set([...state.selectedDrugs, ...(state.pastDrugs ?? [])])];
}

function contextOf(state: InterviewState, settings: InterviewSettings): AskContext {
  return { answers: state.answers, selectedDrugs: state.selectedDrugs, route: state.route, settings };
}

/**
 * その項目を、いま聞く必要があるか。
 * - 年齢・性別と薬ごとの項目：それぞれの聞く条件のとおり
 * - 基本の項目：症状から探すときは聞く条件のとおり（全員）。ほしい薬のときは、選んだ薬の禁忌判定に使う項目だけ
 *   （体重 Q05 は用量の確認に使うので、15歳未満には聞く。いま飲んでいる薬 Q09 は、薬を選んだあとに必ず聞く）。
 *   流れが決まるまでは聞かない
 */
export function isAsked(question: QuestionDefinition, ctx: AskContext): boolean {
  if (!question.askWhen(ctx)) return false;
  if (question.stage !== "basic") return true;
  if (ctx.route === "symptom") return true;
  if (ctx.route === "product") {
    if (question.id === "Q05") return true;
    // いま飲んでいる薬（Q09）は、選んだ薬の判定に使わなくても、薬を選んだ人には必ず聞く
    // （在日の方の処方薬を薬剤師が見て飲み合わせを判断するため。判定には使わない。
    //   11/6 依頼主の判断。docs/demo-data/contraindication-tests.md K39）
    if (question.id === "Q09") return ctx.selectedDrugs.length > 0;
    return ctx.selectedDrugs.some((drug) => (questionsUsedByDrug(drug) as ReadonlySet<string>).has(question.id));
  }
  return false;
}

function isAnswered(question: QuestionDefinition, answers: InterviewAnswers): boolean {
  return question.answerKeys.every((key) => answers[key] !== undefined);
}

/**
 * まだ答えていない、聞く必要のある項目を、聞く順番で返す。
 * stage を指定すると、その段階の項目だけを返す。
 */
export function missingQuestions(
  state: InterviewState,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
  stage?: QuestionDefinition["stage"],
): QuestionId[] {
  const ctx = contextOf(state, settings);
  const result: QuestionId[] = [];
  for (const question of QUESTIONS) {
    if (stage !== undefined && question.stage !== stage) continue;
    // 聞く条件は、それより前の答えで決まる（例：Q03 は Q01・Q02 の答えが出るまで「聞かない」と判定される）。
    // Q01・Q02 は必ず聞くので、先に答えがそろうまで問診は終わらない
    if (!isAsked(question, ctx)) continue;
    if (!isAnswered(question, state.answers)) result.push(question.id);
  }
  return result;
}

/**
 * 次に聞く項目。聞く項目がもうなければ null。
 * 年齢・性別 → 基本の項目 → 薬ごとの項目 の順に聞く。
 */
export function nextQuestion(
  state: InterviewState,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): QuestionId | null {
  const attributes = missingQuestions(state, settings, "attributes");
  if (attributes.length > 0) return attributes[0] ?? null;
  const basic = missingQuestions(state, settings, "basic");
  if (basic.length > 0) return basic[0] ?? null;
  const drug = missingQuestions(state, settings, "drug");
  return drug[0] ?? null;
}

/** 年齢・性別を答え終えたか（問診の流れを選べるか） */
export function areAttributesComplete(
  state: InterviewState,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): boolean {
  return missingQuestions(state, settings, "attributes").length === 0;
}

/**
 * 薬の選択に進めるか。流れが決まっていて、年齢・性別と、いま聞く基本の項目を答え終えていること
 * （ほしい薬の流れでは、薬を選ぶ前に聞く基本の項目はないので、年齢・性別を答えれば進める）。
 */
export function isBasicInterviewComplete(
  state: InterviewState,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): boolean {
  return (
    state.route !== undefined &&
    missingQuestions(state, settings, "attributes").length === 0 &&
    missingQuestions(state, settings, "basic").length === 0
  );
}

/**
 * 問診が終わったか。選んだ薬の判定に使う項目まで、すべて答え終えていること。
 * 薬がまだ選ばれていなければ、終わっていない（薬ごとの項目が決まらないため）。
 */
export function isInterviewComplete(
  state: InterviewState,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): boolean {
  return state.route !== undefined && state.selectedDrugs.length > 0 && missingQuestions(state, settings).length === 0;
}

/** 問診が終わっていなければ止める（薬剤師の確認に進む前などに呼ぶ） */
export function assertInterviewComplete(
  state: InterviewState,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): void {
  if (state.route === undefined) {
    throw new DomainRuleError("ROUTE_NOT_CHOSEN", "問診の流れ（ほしい薬／症状から）が決まっていないので、問診を終えられません");
  }
  if (state.selectedDrugs.length === 0) {
    throw new DomainRuleError("NO_DRUG_SELECTED", "薬が選ばれていないので、問診を終えられません");
  }
  const missing = missingQuestions(state, settings);
  if (missing.length > 0) {
    throw new DomainRuleError("INTERVIEW_INCOMPLETE", `問診がまだ終わっていません（残り：${missing.join("・")}）`);
  }
}

// ---------------------------------------------------------------------------
// 答えを受け取る
// ---------------------------------------------------------------------------

function assertValidAbuseAnswers(answers: InterviewAnswers): void {
  const fail = (itemId: QuestionId): never => {
    // message に答えの中身を入れない（項目 ID だけ。ルール9）
    throw new DomainRuleError("FACT_INVALID", `問診の ${itemId} の答えが決められた形ではありません`);
  };
  const { otherStorePurchase, packageChoice, multipleCount, reasonText, purposeText } = answers;
  if (otherStorePurchase !== undefined && otherStorePurchase !== "yes" && otherStorePurchase !== "no") fail("R01");
  if (packageChoice !== undefined && !(PACKAGE_CHOICES as readonly string[]).includes(packageChoice)) fail("R02");
  if (multipleCount !== undefined) {
    // 「複数個」は2個以上。上限は買いたい個数の範囲（99個。backlog J-07・C-13）
    if (!isIntegerInRange(multipleCount, { min: 2, max: INTEGER_ANSWER_RANGES.packageCount.max })) fail("R02");
    if (packageChoice !== "multiple") fail("R02");
  }
  if (packageChoice === "multiple" && multipleCount === undefined) fail("R02");
  if (reasonText !== undefined && (typeof reasonText !== "string" || reasonText.trim() === "")) fail("R03");
  if (purposeText !== undefined && (typeof purposeText !== "string" || purposeText.trim() === "")) fail("R04");
}

const ABUSE_ANSWER_KEYS = ["otherStorePurchase", "packageChoice", "multipleCount", "reasonText", "purposeText"] as const;

/** 答え全体が決められた形か（問診 Q01〜Q14 と R01〜R04） */
export function assertValidAnswers(answers: InterviewAnswers): void {
  const facts: InterviewAnswers = { ...answers };
  for (const key of ABUSE_ANSWER_KEYS) delete facts[key];
  assertValidFacts(facts);
  assertValidAbuseAnswers(answers);
}

/**
 * 前の答えが変わって聞く必要がなくなった項目の答えを消す。
 * 例：性別を「男性」に直したら、妊娠・授乳の答えを残さない。妊娠を「していない」に直したら、出産予定日の答えを消す。
 * （「間違えました」で直したときに、古い答えで判定しないため。interview-items.md「聞かない・聞き直すときの決まり」）
 */
function dropAnswersNoLongerAsked(state: InterviewState, settings: InterviewSettings): InterviewAnswers {
  let answers: InterviewAnswers = { ...state.answers };
  // 前に選んでいた薬のために聞いた答えは、薬を選び直しても消さない（11/7 依頼主の判断。C-17）。
  // 答えの訂正（例：性別を男性に直した）で、どの薬でも聞かなくなった答えは消す
  const drugs = drugsWithPast(state);
  // 前の項目の変化が後ろの項目の条件に効くので、変化がなくなるまでくり返す
  for (let round = 0; round < QUESTIONS.length; round += 1) {
    const ctx: AskContext = { answers, selectedDrugs: drugs, route: state.route, settings };
    let changed = false;
    for (const question of QUESTIONS) {
      if (isAsked(question, ctx)) continue;
      for (const key of [...question.answerKeys, ...(question.optionalKeys ?? [])]) {
        if (answers[key] !== undefined) {
          answers = { ...answers };
          delete answers[key];
          changed = true;
        }
      }
    }
    // 「複数個」以外になったら個数を消す
    if (answers.packageChoice !== "multiple" && answers.multipleCount !== undefined) {
      answers = { ...answers };
      delete answers.multipleCount;
      changed = true;
    }
    if (!changed) break;
  }
  return answers;
}

/**
 * 答えを受け取り、新しい問診の状態を返す。
 *
 * - 一度に複数の項目に答えてもよい（当てはまる項目をすべて確認済みにする）。
 * - すでに答えた項目に答え直すと、上書きする（訂正。「前の答えをやり直す」）。
 * - 決められた形でない答え（聞く項目への答え）は DomainRuleError で止める。呼び出す側は同じ質問をもう一度出す。
 * - 聞く条件に当てはまらない項目への答え（例：男性への妊娠の答え）は、捨てて記録に残さず、ほかの答えは受け取る
 *   （11/6 依頼主の判断。docs/backlog.md J-06。患者さんはほかのことも一緒に答えることが多いため）。
 * - 問診の項目にない答え（知らない項目）は止める。
 */
export function applyAnswers(
  state: InterviewState,
  newAnswers: InterviewAnswers,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): InterviewState {
  return applyAnswersWithReport(state, newAnswers, settings).state;
}

export interface ApplyAnswersResult {
  readonly state: InterviewState;
  /** 聞かない項目への答えだったので捨てた項目（履歴に種類だけを残すため。中身は返さない） */
  readonly ignored: readonly QuestionId[];
}

/** applyAnswers と同じ。あわせて、捨てた答えの項目 ID を返す */
export function applyAnswersWithReport(
  state: InterviewState,
  newAnswers: InterviewAnswers,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): ApplyAnswersResult {
  const merged: InterviewAnswers = { ...state.answers };
  // 項目に答え直したら、その項目に付いてくる答え（「その他」の文・薬の名前）も前のものを消す。
  // 新しい答えに含まれていなければ残さない（古い文が新しい答えと一緒に記録に残らないように）
  for (const question of QUESTIONS) {
    if (!question.optionalKeys) continue;
    if (!question.answerKeys.some((key) => newAnswers[key] !== undefined)) continue;
    for (const key of question.optionalKeys) delete merged[key];
  }
  Object.assign(merged, newAnswers);
  // 先に「聞く必要がなくなった答え」と「聞かない項目への答え」を消してから形を確かめる。
  // 例：R02 を「複数個・3個」から「小箱1個」に直したとき、古い個数が残って形の誤りにならないように
  const next: InterviewState = { ...state, answers: dropAnswersNoLongerAsked({ ...state, answers: merged }, settings) };
  assertValidAnswers(next.answers);

  const ignored = new Set<QuestionId>();
  for (const key of Object.keys(newAnswers) as (keyof InterviewAnswers)[]) {
    if (newAnswers[key] !== undefined && next.answers[key] === undefined) {
      const owner = QUESTIONS.find((q) => q.answerKeys.includes(key) || (q.optionalKeys ?? []).includes(key));
      if (owner) ignored.add(owner.id);
    }
  }
  return { state: next, ignored: [...ignored] };
}

/**
 * 問診の流れを選ぶ（ほしい薬がある／症状から探す）。年齢・性別を答えてから選ぶ。
 * 選び直しもできる（聞く必要がなくなった答えは消す）。
 */
export function chooseRoute(
  state: InterviewState,
  route: InterviewRoute,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): InterviewState {
  if (route !== "product" && route !== "symptom") {
    throw new DomainRuleError("INVALID_ROUTE", "問診の流れの形が違います");
  }
  if (!areAttributesComplete(state, settings)) {
    throw new DomainRuleError("ATTRIBUTES_INCOMPLETE", "年齢と性別を答えてから、問診の流れを選びます");
  }
  const next: InterviewState = { ...state, route };
  return { ...next, answers: dropAnswersNoLongerAsked(next, settings) };
}

/** 選んだ薬を変える。聞く必要がなくなった薬ごとの項目の答えは消す。取扱薬にない記号は止める */
export function selectDrugs(
  state: InterviewState,
  drugs: readonly StockedDrugId[],
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): InterviewState {
  for (const id of drugs) findStockedDrug(id); // 取扱薬にない記号なら UNKNOWN_DRUG で止まる
  const selected = [...new Set(drugs)];
  // 外れた薬を「前に選んでいた薬」に足す（また選んだ薬は外す）
  const pastDrugs = drugsWithPast(state).filter((id) => !selected.includes(id));
  const next: InterviewState = { ...state, selectedDrugs: selected, pastDrugs };
  return { ...next, answers: dropAnswersNoLongerAsked(next, settings) };
}

/**
 * 禁忌判定（judgeDrug など）に渡す答えだけを取り出す。
 * 指定濫用防止の追加の問診（R01〜R04）は販売手順で使うもので、禁忌判定の答えには含めない
 * （含めると、判定の側で「知らない項目」として止まる）。
 */
export function factsForJudgment(state: InterviewState): InterviewFacts {
  const facts: InterviewAnswers = { ...state.answers };
  for (const key of ABUSE_ANSWER_KEYS) delete facts[key];
  return facts;
}

/** 指定濫用防止の追加の問診（R01〜R04）の答えだけを取り出す（販売手順で使う） */
export function abusePreventionAnswers(state: InterviewState): AbusePreventionAnswers {
  const { otherStorePurchase, packageChoice, multipleCount, reasonText, purposeText } = state.answers;
  const result: AbusePreventionAnswers = {};
  if (otherStorePurchase !== undefined) result.otherStorePurchase = otherStorePurchase;
  if (packageChoice !== undefined) result.packageChoice = packageChoice;
  if (multipleCount !== undefined) result.multipleCount = multipleCount;
  if (reasonText !== undefined) result.reasonText = reasonText;
  if (purposeText !== undefined) result.purposeText = purposeText;
  return result;
}

/**
 * 前に選んでいた薬のために聞いて残っている答えの項目（いま選んでいる薬では聞かない項目。聞く順番）。
 * 薬剤師の画面で「前に選んだ薬のために聞いた答え（判定に使う）」として出すため（C-17）
 */
export function keptQuestionsFromPastDrugs(
  state: InterviewState,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): QuestionId[] {
  const now = contextOf(state, settings);
  const past: AskContext = { ...now, selectedDrugs: drugsWithPast(state) };
  return QUESTIONS.filter((q) => !isAsked(q, now) && isAsked(q, past) && q.answerKeys.some((k) => state.answers[k] !== undefined)).map(
    (q) => q.id,
  );
}

export { findQuestion };
