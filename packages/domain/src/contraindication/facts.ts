/**
 * 問診で確定した事実（docs/demo-data/interview-items.md の Q01〜Q14）。
 *
 * - 値が入っていない項目は「まだ確認していない」とみなす（推測で埋めない。CLAUDE.md ルール7）。
 * - 男性・12歳未満には妊娠（Q03）と授乳（Q04）を聞かないので、入っていなくてよい（12歳未満でも、A を判定するときは要る。C-11）。
 * - 自由に入力された文（処方薬の名前・その他の持病）は判定に使わず、薬剤師の画面に出すだけ。
 */

import { DomainRuleError } from "../errors.ts";

/**
 * 妊娠・授乳（Q03・Q04）を聞く最低年齢（interview-items.md：12歳以上）。
 * 問診（どの項目を聞くか）と禁忌判定（妊娠を確かめる対象か）の両方がこの値を使う。2か所で別の値にしないこと。
 * 表には「設定で変えられる」とあるが、ハッカソン版では固定（docs/backlog.md M-04）。
 */
export const PREGNANCY_QUESTION_MIN_AGE = 12;

export const SEXES = ["male", "female", "other", "no_answer"] as const;
export type Sex = (typeof SEXES)[number];

/** Q03 妊娠：妊娠している／妊娠しているかもしれない／していない／該当しない */
export const PREGNANCY_ANSWERS = ["pregnant", "maybe", "no", "not_applicable"] as const;
export type PregnancyAnswer = (typeof PREGNANCY_ANSWERS)[number];

/** はい／いいえ／わからない */
export const YES_NO_UNKNOWN = ["yes", "no", "unknown"] as const;
export type YesNoUnknown = (typeof YES_NO_UNKNOWN)[number];

/** Q04 授乳中：はい／いいえ／該当しない */
export const BREASTFEEDING_ANSWERS = ["yes", "no", "not_applicable"] as const;
export type BreastfeedingAnswer = (typeof BREASTFEEDING_ANSWERS)[number];

/** Q07 治療中の病気（「なし」は空の配列。「その他」は otherConditionText） */
export const CONDITIONS = [
  "gastric_ulcer",
  "liver",
  "kidney",
  "heart",
  "hypertension",
  "glaucoma",
  "dialysis",
] as const;
export type Condition = (typeof CONDITIONS)[number];

/** Q09 いま飲んでいる薬（「なし」は空の配列） */
export const CURRENT_MEDICATIONS = [
  "cold",
  "analgesic",
  "antihistamine",
  "kampo",
  "prescription",
  "other",
] as const;
export type CurrentMedication = (typeof CURRENT_MEDICATIONS)[number];

/** Q14 貼る場所 */
export const APPLICATION_SITES = ["normal", "eye_or_mucosa", "eczema_or_wound"] as const;
export type ApplicationSite = (typeof APPLICATION_SITES)[number];

export type InterviewFacts = {
  /** Q01 年齢（歳） */
  age?: number;
  /** Q02 性別 */
  sex?: Sex;
  /** Q03 妊娠 */
  pregnancy?: PregnancyAnswer;
  /** Q03a 出産予定日まで12週以内か（Q03 で「妊娠している」のときだけ） */
  dueWithin12Weeks?: YesNoUnknown;
  /** Q04 授乳中 */
  breastfeeding?: BreastfeedingAnswer;
  /** Q05 体重（kg）。ハッカソン版の判定には使わない */
  weightKg?: number;
  /** Q06 ぜんそくを起こしたことがあるか */
  asthmaHistory?: YesNoUnknown;
  /** Q07 治療中の病気（なしは []） */
  conditions?: readonly Condition[];
  /** Q07 「その他」の自由入力。判定には使わない */
  otherConditionText?: string;
  /** Q08 薬でアレルギーが出たことがあるか */
  drugAllergy?: YesNoUnknown;
  /** Q08 アレルギーが出た薬の名前（「はい」のときだけ）。判定には使わず、薬剤師の画面に出す（interview-items.md Q08。backlog S-11） */
  allergyDrugNames?: readonly string[];
  /** Q09 いま飲んでいる薬（なしは []） */
  currentMedications?: readonly CurrentMedication[];
  /** Q09 処方薬の名前。判定には使わず、薬剤師の画面に出す（K39） */
  prescriptionDrugNames?: readonly string[];
  /** Q10 薬を飲んだあとに運転する予定 */
  drivingAfter?: boolean;
  /** Q11 飲む前後にお酒を飲む予定 */
  alcohol?: boolean;
  /** Q12 飲む予定の日数 */
  plannedDays?: number;
  /** Q13 ソフトコンタクトレンズをつけているか */
  softContactLens?: boolean;
  /** Q14 貼る場所 */
  applicationSite?: ApplicationSite;
};

/** 問診の項目 ID（理由にどの項目によるかを示すため） */
export type InterviewItemId =
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
  | "Q14";

// ---------------------------------------------------------------------------
// 答えの値の確かめ（CLAUDE.md ルール7・8：決められた形でない値では判定を続けない）
// ---------------------------------------------------------------------------

type Check = (value: unknown) => boolean;

const oneOf =
  (choices: readonly string[]): Check =>
  (v) =>
    typeof v === "string" && choices.includes(v);
const listOf =
  (choices: readonly string[]): Check =>
  (v) =>
    Array.isArray(v) && v.every((x) => typeof x === "string" && choices.includes(x));
const nonNegativeNumber: Check = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * 数字で答える項目のうち、整数で決まった範囲だけを受け取る項目（interview-items.md「聞かない・聞き直すときの決まり」。
 * 11/6 薬剤師の判断。打ち間違いを止めるための広い範囲で、判定の基準ではない。backlog J-07・C-13）。
 * 体重（Q05）と、ほかの店で買った個数（R01）はまだ決めていない（backlog J-16）ので、ここに入れない。
 */
export const INTEGER_ANSWER_RANGES = {
  /** 年齢（Q01）：0〜120歳 */
  age: { min: 0, max: 120 },
  /** 飲む予定の日数（Q12）：1〜365日 */
  plannedDays: { min: 1, max: 365 },
  /** 買いたい個数（R02）：1〜99個（「複数個」は2個以上なので、2〜99） */
  packageCount: { min: 1, max: 99 },
} as const;

/** 整数で、min 以上 max 以下か */
export function isIntegerInRange(v: unknown, range: { readonly min: number; readonly max: number }): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= range.min && v <= range.max;
}

const integerIn =
  (range: { readonly min: number; readonly max: number }): Check =>
  (v) =>
    isIntegerInRange(v, range);
const isBoolean: Check = (v) => typeof v === "boolean";
const isString: Check = (v) => typeof v === "string";
const stringList: Check = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

const FACT_CHECKS: Readonly<Record<keyof InterviewFacts, { itemId: InterviewItemId; check: Check }>> = {
  age: { itemId: "Q01", check: integerIn(INTEGER_ANSWER_RANGES.age) },
  sex: { itemId: "Q02", check: oneOf(SEXES) },
  pregnancy: { itemId: "Q03", check: oneOf(PREGNANCY_ANSWERS) },
  dueWithin12Weeks: { itemId: "Q03a", check: oneOf(YES_NO_UNKNOWN) },
  breastfeeding: { itemId: "Q04", check: oneOf(BREASTFEEDING_ANSWERS) },
  weightKg: { itemId: "Q05", check: nonNegativeNumber },
  asthmaHistory: { itemId: "Q06", check: oneOf(YES_NO_UNKNOWN) },
  conditions: { itemId: "Q07", check: listOf(CONDITIONS) },
  otherConditionText: { itemId: "Q07", check: isString },
  drugAllergy: { itemId: "Q08", check: oneOf(YES_NO_UNKNOWN) },
  allergyDrugNames: { itemId: "Q08", check: stringList },
  currentMedications: { itemId: "Q09", check: listOf(CURRENT_MEDICATIONS) },
  prescriptionDrugNames: { itemId: "Q09", check: stringList },
  drivingAfter: { itemId: "Q10", check: isBoolean },
  alcohol: { itemId: "Q11", check: isBoolean },
  plannedDays: { itemId: "Q12", check: integerIn(INTEGER_ANSWER_RANGES.plannedDays) },
  softContactLens: { itemId: "Q13", check: isBoolean },
  applicationSite: { itemId: "Q14", check: oneOf(APPLICATION_SITES) },
};

/**
 * 入っている答えが、決められた選択肢・範囲に収まっているかを確かめる。
 * 外れていたら DomainRuleError("FACT_INVALID") で止める（推測で読み替えない）。
 * 年齢・日数は INTEGER_ANSWER_RANGES の範囲の整数、体重は0以上の有限の数。まだ答えていない項目（値なし）はここでは確かめない。
 */
export function assertValidFacts(facts: InterviewFacts): void {
  for (const [key, value] of Object.entries(facts)) {
    if (value === undefined) continue;
    const rule = Object.hasOwn(FACT_CHECKS, key) ? FACT_CHECKS[key as keyof InterviewFacts] : undefined;
    if (!rule) {
      throw new DomainRuleError("FACT_INVALID", `問診の答えに知らない項目があります（${key}）`);
    }
    if (!rule.check(value)) {
      // message に答えの中身（健康情報）を入れない（項目 ID だけ）
      throw new DomainRuleError("FACT_INVALID", `問診の ${rule.itemId} の答えが決められた形ではありません`);
    }
  }
  // アレルギーが出た薬の名前は、Q08 で「はい」と答えたときだけ（「いいえ」「わからない」と一緒に名前が残らないように）
  if (facts.allergyDrugNames !== undefined && facts.drugAllergy !== "yes") {
    throw new DomainRuleError("FACT_INVALID", "問診の Q08 の答えが決められた形ではありません");
  }
}
