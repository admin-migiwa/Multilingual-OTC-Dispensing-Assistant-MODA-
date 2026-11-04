/**
 * 問診で確定した事実（docs/demo-data/interview-items.md の Q01〜Q14）。
 *
 * - 値が入っていない項目は「まだ確認していない」とみなす（推測で埋めない。CLAUDE.md ルール7）。
 * - 男性・12歳未満には妊娠（Q03）と授乳（Q04）を聞かないので、入っていなくてよい。
 * - 自由に入力された文（処方薬の名前・その他の持病）は判定に使わず、薬剤師の画面に出すだけ。
 */

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
  | "Q06"
  | "Q07"
  | "Q08"
  | "Q09"
  | "Q10"
  | "Q11"
  | "Q12"
  | "Q13"
  | "Q14";
