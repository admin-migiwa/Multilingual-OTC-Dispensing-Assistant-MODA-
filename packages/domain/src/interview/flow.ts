/**
 * 問診の進め方（1問1答）。次に聞く項目を決め、答えを受け取り、問診が終わったかを判定する。
 *
 * - 次に聞く項目はここで決める。画面や AI には決めさせない（CLAUDE.md 絶対に守るルール3）。
 * - 答えは決められた形かを確かめ、外れていたら止める（ルール7・8）。推測で読み替えない。
 * - 必要な項目がそろうまで問診を終えない（ルール3）。
 */

import { DomainRuleError } from "../errors.ts";
import { assertValidFacts } from "../contraindication/facts.ts";
import type { StockedDrugId } from "../contraindication/data.ts";
import {
  DEFAULT_INTERVIEW_SETTINGS,
  PACKAGE_CHOICES,
  QUESTIONS,
  findQuestion,
  type AskContext,
  type InterviewAnswers,
  type InterviewSettings,
  type QuestionDefinition,
  type QuestionId,
} from "./items.ts";

export interface InterviewState {
  readonly answers: InterviewAnswers;
  readonly selectedDrugs: readonly StockedDrugId[];
}

function contextOf(state: InterviewState, settings: InterviewSettings): AskContext {
  return { answers: state.answers, selectedDrugs: state.selectedDrugs, settings };
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
    if (!question.askWhen(ctx)) continue;
    if (!isAnswered(question, state.answers)) result.push(question.id);
  }
  return result;
}

/**
 * 次に聞く項目。聞く項目がもうなければ null。
 * 基本の項目をすべて聞き終えるまで、薬ごとの項目は聞かない。
 */
export function nextQuestion(
  state: InterviewState,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): QuestionId | null {
  const basic = missingQuestions(state, settings, "basic");
  if (basic.length > 0) return basic[0] ?? null;
  const drug = missingQuestions(state, settings, "drug");
  return drug[0] ?? null;
}

/** 基本の項目をすべて答え終えたか（薬の選択に進めるか） */
export function isBasicInterviewComplete(
  state: InterviewState,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): boolean {
  return missingQuestions(state, settings, "basic").length === 0;
}

/**
 * 問診が終わったか。選んだ薬の判定に使う項目まで、すべて答え終えていること。
 * 薬がまだ選ばれていなければ、終わっていない（薬ごとの項目が決まらないため）。
 */
export function isInterviewComplete(
  state: InterviewState,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): boolean {
  return state.selectedDrugs.length > 0 && missingQuestions(state, settings).length === 0;
}

/** 問診が終わっていなければ止める（薬剤師の確認に進む前などに呼ぶ） */
export function assertInterviewComplete(
  state: InterviewState,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): void {
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
    if (!Number.isInteger(multipleCount) || multipleCount < 2) fail("R02");
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
  // 前の項目の変化が後ろの項目の条件に効くので、変化がなくなるまでくり返す
  for (let round = 0; round < QUESTIONS.length; round += 1) {
    const ctx: AskContext = { answers, selectedDrugs: state.selectedDrugs, settings };
    let changed = false;
    for (const question of QUESTIONS) {
      if (question.askWhen(ctx)) continue;
      for (const key of question.answerKeys) {
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
 * - 決められた形でない答えは DomainRuleError で止める。呼び出す側は同じ質問をもう一度出す。
 * - 聞く条件に当てはまらない項目への答えは受け取らない（例：男性への妊娠の答え）。
 */
export function applyAnswers(
  state: InterviewState,
  newAnswers: InterviewAnswers,
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): InterviewState {
  const merged: InterviewAnswers = { ...state.answers, ...newAnswers };
  assertValidAnswers(merged);

  const next: InterviewState = { ...state, answers: dropAnswersNoLongerAsked({ ...state, answers: merged }, settings) };

  // 聞く条件に当てはまらない項目への答えは、消されて残らない。受け取ったつもりにならないよう止める
  for (const key of Object.keys(newAnswers) as (keyof InterviewAnswers)[]) {
    if (newAnswers[key] !== undefined && next.answers[key] === undefined) {
      const owner = QUESTIONS.find((q) => q.answerKeys.includes(key));
      throw new DomainRuleError(
        "QUESTION_NOT_ASKED",
        `問診の ${owner?.id ?? key} は、この患者さんには聞かない項目です`,
      );
    }
  }
  return next;
}

/** 選んだ薬を変える。聞く必要がなくなった薬ごとの項目の答えは消す */
export function selectDrugs(
  state: InterviewState,
  drugs: readonly StockedDrugId[],
  settings: InterviewSettings = DEFAULT_INTERVIEW_SETTINGS,
): InterviewState {
  const next: InterviewState = { ...state, selectedDrugs: [...new Set(drugs)] };
  return { ...next, answers: dropAnswersNoLongerAsked(next, settings) };
}

export { findQuestion };
