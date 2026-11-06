/**
 * 問診の項目と、聞く条件・聞かない条件（docs/demo-data/interview-items.md、薬剤師確認済み）。
 *
 * - 次に聞く項目はサーバーが決める（CLAUDE.md 絶対に守るルール3）。画面や AI には決めさせない。
 * - 「基本の項目」は全員に、「薬ごとの項目」は選んだ薬が決まってから、その薬の判定に必要なものだけを聞く。
 * - 年齢・性別（Q01・Q02）を最初に聞く（11/6 依頼主の判断。docs/backlog.md C-05）。
 */

import { PREGNANCY_QUESTION_MIN_AGE, type InterviewFacts } from "../contraindication/facts.ts";
import type { StockedDrugId } from "../contraindication/data.ts";

/** 指定濫用防止医薬品を選んだときの追加の問診（R01〜R04）の答え */
export const PACKAGE_CHOICES = ["small_one", "large_one", "multiple"] as const;
export type PackageChoice = (typeof PACKAGE_CHOICES)[number];

export type AbusePreventionAnswers = {
  /** R01 ほかの店で同じような薬を最近買ったか */
  otherStorePurchase?: "yes" | "no";
  /** R02 買いたい個数・包装（E のとき） */
  packageChoice?: PackageChoice;
  /** R02 「複数個」のときの個数 */
  multipleCount?: number;
  /** R03 複数・大容量が必要な理由（自由入力） */
  reasonText?: string;
  /** R04 使う目的（症状）（自由入力） */
  purposeText?: string;
};

/** 問診で集めた答えのすべて */
export type InterviewAnswers = InterviewFacts & AbusePreventionAnswers;

export type QuestionId =
  | "Q01"
  | "Q02"
  | "Q03"
  | "Q03a"
  | "Q04"
  | "Q05"
  | "Q06"
  | "Q07"
  | "Q08"
  | "Q09"
  | "Q10"
  | "Q11"
  | "Q12"
  | "Q13"
  | "Q14"
  | "R01"
  | "R02"
  | "R03"
  | "R04";

/**
 * 問診の流れ（11/6 依頼主の判断。interview-items.md「聞く順番の考え方」）
 * - product：ほしい薬がある → 薬を選ぶ → 選んだ薬の判定に使う項目だけを聞く
 * - symptom：症状から探す → 基本の項目をすべて聞く → 薬剤師が候補を選ぶ
 * どちらの流れでも、年齢・性別（Q01・Q02）を最初に聞く。流れが決まるまでは、それ以外を聞かない。
 */
export type InterviewRoute = "product" | "symptom";

export interface InterviewSettings {
  /** 体重を聞く年齢の上限（未満）（Q05：15歳未満） */
  readonly weightQuestionBelowAge: number;
}

/**
 * 妊娠・授乳を聞く最低年齢は、禁忌判定と同じ値（PREGNANCY_QUESTION_MIN_AGE）を使い、ここでは変えられない。
 * 問診と判定で基準がずれると、判定に必要な答えを聞かないまま問診が終わってしまうため。
 */
export const DEFAULT_INTERVIEW_SETTINGS: InterviewSettings = {
  weightQuestionBelowAge: 15,
};

/** 聞くかどうかを決めるときに使う情報 */
export interface AskContext {
  readonly answers: InterviewAnswers;
  /** 選んだ薬（まだ決まっていなければ空） */
  readonly selectedDrugs: readonly StockedDrugId[];
  /** 問診の流れ（まだ決まっていなければ undefined） */
  readonly route: InterviewRoute | undefined;
  readonly settings: InterviewSettings;
}

export interface QuestionDefinition {
  readonly id: QuestionId;
  /**
   * attributes：年齢・性別（全員・最初に聞く）
   * basic：基本の項目（症状から探すときは全員、ほしい薬のときは選んだ薬の判定に使うものだけ）
   * drug：薬ごとの項目（選んだ薬が決まってから）
   */
  readonly stage: "attributes" | "basic" | "drug";
  /** この項目の答えを入れる場所（答えたかどうかの判定に使う） */
  readonly answerKeys: readonly (keyof InterviewAnswers)[];
  /** 聞く条件。false なら聞かない（答えがなくても問診は終えられる） */
  readonly askWhen: (ctx: AskContext) => boolean;
}

const always = (): boolean => true;
const selected = (...ids: StockedDrugId[]) => (ctx: AskContext): boolean =>
  ctx.selectedDrugs.some((id) => ids.includes(id));

/** 妊娠・授乳を聞く対象か：性別が男性以外、かつ12歳以上（Q03・Q04。禁忌判定と同じ基準） */
function asksPregnancyQuestions(ctx: AskContext): boolean {
  const { sex, age } = ctx.answers;
  if (sex === undefined || age === undefined) return false; // Q01・Q02 を先に聞くので、ここには来ない
  return sex !== "male" && age >= PREGNANCY_QUESTION_MIN_AGE;
}

/**
 * 項目の一覧（聞く順番もこの並び）。
 * 薬ごとの項目は、drugs.md の判定に使う薬を選んだときだけ聞く（interview-items.md の「聞く条件」）。
 */
export const QUESTIONS: readonly QuestionDefinition[] = [
  // --- 年齢・性別（全員）と基本の項目 ---
  { id: "Q01", stage: "attributes", answerKeys: ["age"], askWhen: always },
  { id: "Q02", stage: "attributes", answerKeys: ["sex"], askWhen: always },
  { id: "Q03", stage: "basic", answerKeys: ["pregnancy"], askWhen: asksPregnancyQuestions },
  {
    id: "Q03a",
    stage: "basic",
    answerKeys: ["dueWithin12Weeks"],
    askWhen: (ctx) => asksPregnancyQuestions(ctx) && ctx.answers.pregnancy === "pregnant",
  },
  { id: "Q04", stage: "basic", answerKeys: ["breastfeeding"], askWhen: asksPregnancyQuestions },
  {
    id: "Q05",
    stage: "basic",
    answerKeys: ["weightKg"],
    askWhen: (ctx) => ctx.answers.age !== undefined && ctx.answers.age < ctx.settings.weightQuestionBelowAge,
  },
  { id: "Q06", stage: "basic", answerKeys: ["asthmaHistory"], askWhen: always },
  { id: "Q07", stage: "basic", answerKeys: ["conditions"], askWhen: always },
  { id: "Q08", stage: "basic", answerKeys: ["drugAllergy"], askWhen: always },
  { id: "Q09", stage: "basic", answerKeys: ["currentMedications"], askWhen: always },
  { id: "Q10", stage: "basic", answerKeys: ["drivingAfter"], askWhen: always },
  // --- 薬ごとの項目（選んだ薬が決まってから） ---
  { id: "Q11", stage: "drug", answerKeys: ["alcohol"], askWhen: selected("C", "D", "E", "I") },
  { id: "Q12", stage: "drug", answerKeys: ["plannedDays"], askWhen: selected("B", "F") },
  { id: "Q13", stage: "drug", answerKeys: ["softContactLens"], askWhen: selected("G") },
  { id: "Q14", stage: "drug", answerKeys: ["applicationSite"], askWhen: selected("H") },
  // --- 指定濫用防止医薬品を選んだときの追加の問診（B・E） ---
  { id: "R01", stage: "drug", answerKeys: ["otherStorePurchase"], askWhen: selected("B", "E") },
  { id: "R02", stage: "drug", answerKeys: ["packageChoice"], askWhen: selected("E") },
  {
    id: "R03",
    stage: "drug",
    answerKeys: ["reasonText"],
    askWhen: (ctx) =>
      selected("E")(ctx) && (ctx.answers.packageChoice === "large_one" || ctx.answers.packageChoice === "multiple"),
  },
  { id: "R04", stage: "drug", answerKeys: ["purposeText"], askWhen: selected("B", "E") },
];

export function findQuestion(id: QuestionId): QuestionDefinition {
  const found = QUESTIONS.find((q) => q.id === id);
  if (!found) {
    // 型で守られているので通常は起きない。起きたら設定の誤りなので止める（ルール7）。
    throw new Error(`問診の項目 ${id} が見つかりません`);
  }
  return found;
}
