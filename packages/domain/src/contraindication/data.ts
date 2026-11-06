/**
 * 架空の薬と成分のデータ（docs/demo-data/drugs.md、11/4 薬剤師確認済み）。
 *
 * 判定は商品名ではなく、成分のフラグと、商品ごとの「してはいけないこと」（rules）で行う。
 * drugs.md を直したら、ここも同じように直す。表にない禁忌・注意をここに足さない。
 */

import type { ApplicationSite, Condition, CurrentMedication } from "./facts.ts";

// ---------------------------------------------------------------------------
// 成分
// ---------------------------------------------------------------------------

export const INGREDIENT_FLAGS = [
  "nsaid",
  "gi_damage",
  "abuse_prevention",
  "drowsiness",
  "antihistamine",
  "avoid_breastfeeding",
  "specially_guided",
  "avoid_breastfeeding_24h",
  "no_dialysis",
  "glaucoma_consult",
  "topical",
  "kampo",
  "licorice_edema_hypertension",
] as const;
export type IngredientFlag = (typeof INGREDIENT_FLAGS)[number];

export type IngredientId =
  | "N1"
  | "N2"
  | "P1"
  | "C1"
  | "E1"
  | "H2"
  | "S1"
  | "K1"
  | "L1"
  | "G1"
  | "G2"
  | "V1"
  | "T1"
  | "KP1"
  | "GZ1";

/** 成分の系統（「店にない商品」の照合に使う。drugs.md の「系統」の列。解熱鎮痛は NSAID系と非NSAID系で分ける） */
export const INGREDIENT_GROUPS = [
  "nsaid_analgesic",
  "non_nsaid_analgesic",
  "antitussive",
  "sympathomimetic",
  "antihistamine",
  "sedative",
  "caffeine",
  "emergency_contraceptive",
  "antacid",
  "ophthalmic_decongestant",
  "topical_analgesic",
  "kampo_herb",
  "licorice",
] as const;
export type IngredientGroup = (typeof INGREDIENT_GROUPS)[number];

export type Ingredient = {
  id: IngredientId;
  group: IngredientGroup;
  name: string;
  kind: string;
  flags: readonly IngredientFlag[];
};

export const INGREDIENTS: Readonly<Record<IngredientId, Ingredient>> = {
  N1: { id: "N1", group: "nsaid_analgesic", name: "架空成分 N1", kind: "解熱鎮痛（NSAID系・強め）", flags: ["nsaid", "gi_damage"] },
  N2: { id: "N2", group: "nsaid_analgesic", name: "架空成分 N2", kind: "解熱鎮痛（NSAID系）", flags: ["nsaid"] },
  P1: { id: "P1", group: "non_nsaid_analgesic", name: "架空成分 P1", kind: "解熱鎮痛（非NSAID系）", flags: [] },
  C1: {
    id: "C1", group: "antitussive",
    name: "架空成分 C1",
    kind: "鎮咳（麻薬性鎮咳成分の類）",
    flags: ["abuse_prevention", "drowsiness", "avoid_breastfeeding"],
  },
  E1: {
    id: "E1", group: "sympathomimetic",
    name: "架空成分 E1",
    kind: "気管支拡張・鼻づまり（交感神経刺激の類）",
    flags: ["abuse_prevention"],
  },
  H2: { id: "H2", group: "antihistamine", name: "架空成分 H2", kind: "抗ヒスタミン", flags: ["drowsiness", "antihistamine"] },
  S1: { id: "S1", group: "sedative", name: "架空成分 S1", kind: "鎮静", flags: ["drowsiness"] },
  K1: { id: "K1", group: "caffeine", name: "架空成分 K1", kind: "カフェインの類", flags: [] },
  L1: {
    id: "L1", group: "emergency_contraceptive",
    name: "架空成分 L1",
    kind: "緊急避妊（ホルモン系）",
    flags: ["specially_guided", "avoid_breastfeeding_24h"],
  },
  G1: { id: "G1", group: "antacid", name: "架空成分 G1", kind: "制酸（ナトリウム系）", flags: ["no_dialysis"] },
  G2: { id: "G2", group: "antacid", name: "架空成分 G2", kind: "制酸（マグネシウム系）", flags: [] },
  V1: { id: "V1", group: "ophthalmic_decongestant", name: "架空成分 V1", kind: "点眼・充血除去（血管収縮）", flags: ["glaucoma_consult"] },
  T1: { id: "T1", group: "topical_analgesic", name: "架空成分 T1", kind: "外用消炎鎮痛（サリチル酸系の類）", flags: ["topical"] },
  KP1: {
    id: "KP1", group: "kampo_herb",
    name: "架空生薬 KP1",
    kind: "漢方（かぜの初期向けの処方を構成する生薬の類）",
    flags: ["kampo"],
  },
  GZ1: {
    id: "GZ1", group: "licorice",
    name: "架空生薬 GZ1",
    kind: "カンゾウ（甘草）の類",
    flags: ["licorice_edema_hypertension"],
  },
};

// ---------------------------------------------------------------------------
// 効き目の分類（同効分類）
// ---------------------------------------------------------------------------

export const EFFICACY_CATEGORIES = [
  "かぜ薬（総合）",
  "かぜ薬（漢方）",
  "解熱鎮痛薬",
  "胃腸薬（制酸）",
  "点眼薬",
  "外用消炎鎮痛薬",
  "緊急避妊薬",
] as const;
export type EfficacyCategory = (typeof EFFICACY_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// 商品ごとの「してはいけないこと」と注意
// ---------------------------------------------------------------------------

export type RuleVerdict = "contraindicated" | "caution";

/**
 * どの問診の答えで当てはまるか。判定のしかたは judge.ts にだけ書く。
 * 種類を足すときは judge.ts の evaluate も足す。
 */
export type RuleCondition =
  | { kind: "age_under"; years: number }
  | { kind: "male" }
  /** 妊娠している、またはしているかもしれない */
  | { kind: "pregnant" }
  /** 出産予定日まで12週以内（妊娠していて Q03a が「はい」） */
  | { kind: "due_within_12_weeks" }
  /** 妊娠中で、出産予定日まで12週より前（妊娠していて Q03a が「いいえ」） */
  | { kind: "pregnant_before_12_weeks" }
  | { kind: "breastfeeding" }
  | { kind: "asthma" }
  | { kind: "condition"; any: readonly Condition[] }
  | { kind: "drug_allergy" }
  | { kind: "taking"; any: readonly CurrentMedication[] }
  | { kind: "driving" }
  | { kind: "alcohol" }
  /** 飲む予定の日数が days を超える */
  | { kind: "planned_days_over"; days: number }
  | { kind: "soft_contact_lens" }
  | { kind: "application_site"; site: ApplicationSite };

/** 理由の根拠（どの成分・フラグによるか、商品の記載によるか） */
export type RuleBasis = {
  ingredients?: readonly IngredientId[];
  flags?: readonly IngredientFlag[];
  /** 成分ではなく商品（参考にした添付文書）の記載による */
  productLabel?: true;
};

export type ProductRule = {
  /** 理由の種類（画面やテストで使う安定した名前） */
  code: string;
  condition: RuleCondition;
  verdict: RuleVerdict;
  /** 薬剤師の画面に出す理由（日本語） */
  label: string;
  basis: RuleBasis;
};

// ---------------------------------------------------------------------------
// 取扱薬
// ---------------------------------------------------------------------------

export type StockedDrugId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";

export type DoseByAge = {
  /** この年齢以上（歳） */
  minAge: number;
  /** この年齢未満（歳）。上限なしは null */
  maxAgeExclusive: number | null;
  /** 1回量。服用しない年齢は null */
  dose: string | null;
};

export type StockedDrug = {
  id: StockedDrugId;
  name: string;
  /** 区分（販売手順は T5 の sales-procedure が持つ。ここでは表示用） */
  classification: string;
  category: EfficacyCategory;
  ingredients: readonly IngredientId[];
  /** 表に「ほか」と書かれていて、成分の全部はわからない */
  hasUnlistedIngredients: boolean;
  usage: string;
  packages: string;
  /** 服用できない年齢（この年齢未満）。制限なしは null */
  minAge: number | null;
  /** 年齢別の用法・用量の表（ある薬だけ） */
  doseByAge?: readonly DoseByAge[];
  /**
   * この薬を選んだときは、12歳未満でも妊娠（Q03）・授乳（Q04）を聞き、判定に使う（ある薬だけ）。
   * interview-items.md の Q03・Q04「選んだ薬に A があるときは年齢を問わない」（11/6 薬剤師の判断。backlog J-01・C-11）
   */
  pregnancyQuestionsAtAnyAge?: true;
  rules: readonly ProductRule[];
};

const NSAID_ASTHMA = (ingredient: IngredientId): ProductRule => ({
  code: "ASTHMA",
  condition: { kind: "asthma" },
  verdict: "contraindicated",
  label: "ぜんそく（NSAID系の成分）",
  basis: { ingredients: [ingredient], flags: ["nsaid"] },
});

const NSAID_DUE_WITHIN_12_WEEKS = (ingredient: IngredientId): ProductRule => ({
  code: "DUE_WITHIN_12_WEEKS",
  condition: { kind: "due_within_12_weeks" },
  verdict: "contraindicated",
  label: "出産予定日まで12週以内",
  basis: { ingredients: [ingredient], flags: ["nsaid"] },
});

const NSAID_PREGNANT_BEFORE_12_WEEKS = (ingredient: IngredientId): ProductRule => ({
  code: "PREGNANT_CONSULT",
  condition: { kind: "pregnant_before_12_weeks" },
  verdict: "caution",
  label: "妊娠中（相談）",
  basis: { ingredients: [ingredient], flags: ["nsaid"] },
});

const AGE_UNDER = (years: number): ProductRule => ({
  code: "AGE_UNDER",
  condition: { kind: "age_under", years },
  verdict: "contraindicated",
  label: `${years}歳未満`,
  basis: { productLabel: true },
});

const ALCOHOL: ProductRule = {
  code: "ALCOHOL",
  condition: { kind: "alcohol" },
  verdict: "caution",
  label: "飲酒",
  basis: { productLabel: true },
};

const DRIVING = (ingredients: readonly IngredientId[]): ProductRule => ({
  code: "DRIVING",
  condition: { kind: "driving" },
  verdict: "caution",
  label: "眠くなる成分（運転しない）",
  basis: { ingredients, flags: ["drowsiness"] },
});

const MEDICATION_NAMES: Readonly<Partial<Record<CurrentMedication, string>>> = {
  analgesic: "解熱鎮痛薬",
  cold: "かぜ薬",
  antihistamine: "抗ヒスタミン薬",
};

/**
 * ほかの薬との併用（禁忌）。飲んでいる薬の種類ごとに1つずつ規則を作り、
 * 理由の文は当てはまった種類だけを出す（例：解熱鎮痛薬を飲んでいる → 「ほかの解熱鎮痛薬との併用」）。
 */
const TAKING = (meds: readonly CurrentMedication[]): ProductRule[] =>
  meds.map((med) => ({
    code: "CONCURRENT_USE",
    condition: { kind: "taking", any: [med] },
    verdict: "contraindicated",
    label: `ほかの${MEDICATION_NAMES[med] ?? med}との併用`,
    basis: { productLabel: true },
  }));

const CONDITION_NAMES: Readonly<Record<Condition, string>> = {
  gastric_ulcer: "胃潰瘍",
  liver: "肝臓病",
  kidney: "腎臓病",
  heart: "心臓病",
  hypertension: "高血圧",
  glaucoma: "緑内障",
  dialysis: "透析",
};

export const STOCKED_DRUGS: readonly StockedDrug[] = [
  {
    id: "A",
    name: "モダレスキュー錠（架空）",
    classification: "特定要指導",
    category: "緊急避妊薬",
    ingredients: ["L1"],
    hasUnlistedIngredients: false,
    usage: "1回1錠を1回だけ。薬剤師の前で服用",
    packages: "1錠",
    minAge: null,
    pregnancyQuestionsAtAnyAge: true,
    rules: [
      {
        code: "PREGNANT",
        condition: { kind: "pregnant" },
        verdict: "contraindicated",
        label: "妊娠",
        basis: { productLabel: true },
      },
      {
        code: "MALE",
        condition: { kind: "male" },
        verdict: "contraindicated",
        label: "男性",
        basis: { productLabel: true },
      },
      {
        code: "CONDITION",
        condition: { kind: "condition", any: ["liver"] },
        verdict: "contraindicated",
        label: "肝臓病で治療中",
        basis: { productLabel: true },
      },
      {
        code: "DRUG_ALLERGY",
        condition: { kind: "drug_allergy" },
        verdict: "contraindicated",
        label: "薬でアレルギーを起こしたことがある",
        basis: { productLabel: true },
      },
      {
        code: "BREASTFEEDING",
        condition: { kind: "breastfeeding" },
        verdict: "caution",
        label: "服用後24時間は授乳を避ける",
        basis: { ingredients: ["L1"], flags: ["avoid_breastfeeding_24h"] },
      },
    ],
  },
  {
    id: "B",
    name: "モダかぜプロ錠（架空）",
    classification: "要指導＋指定濫用防止",
    category: "かぜ薬（総合）",
    ingredients: ["N1", "C1", "E1", "H2"],
    hasUnlistedIngredients: false,
    usage: "1回2錠、1日3回",
    packages: "12錠（2日分）",
    minAge: 15,
    rules: [
      AGE_UNDER(15),
      NSAID_ASTHMA("N1"),
      NSAID_DUE_WITHIN_12_WEEKS("N1"),
      NSAID_PREGNANT_BEFORE_12_WEEKS("N1"),
      ...TAKING(["cold", "analgesic"]),
      {
        code: "BREASTFEEDING",
        condition: { kind: "breastfeeding" },
        verdict: "contraindicated",
        label: "授乳中（C1）",
        basis: { ingredients: ["C1"], flags: ["avoid_breastfeeding"] },
      },
      DRIVING(["C1", "H2"]),
      {
        code: "LONG_TERM_USE",
        condition: { kind: "planned_days_over", days: 5 },
        verdict: "caution",
        label: "5日を超えて飲む予定",
        basis: { productLabel: true },
      },
    ],
  },
  {
    id: "C",
    name: "モダペインS錠（架空）",
    classification: "第1類",
    category: "解熱鎮痛薬",
    ingredients: ["N1"],
    hasUnlistedIngredients: false,
    usage: "1回1錠、1日2回まで（症状により3回）",
    packages: "12錠",
    minAge: 15,
    rules: [
      AGE_UNDER(15),
      NSAID_ASTHMA("N1"),
      NSAID_DUE_WITHIN_12_WEEKS("N1"),
      NSAID_PREGNANT_BEFORE_12_WEEKS("N1"),
      // drugs.md の「胃潰瘍・肝臓病・腎臓病・心臓病で治療中」。理由の文は当てはまった病気だけを出す
      ...(["gastric_ulcer", "liver", "kidney", "heart"] as const).map(
        (c): ProductRule => ({
          code: "CONDITION",
          condition: { kind: "condition", any: [c] },
          verdict: "contraindicated",
          label: `${CONDITION_NAMES[c]}で治療中`,
          basis: { ingredients: ["N1"], flags: ["gi_damage"] },
        }),
      ),
      ...TAKING(["analgesic"]),
      ALCOHOL,
    ],
  },
  {
    id: "D",
    name: "モダペインA錠（架空）",
    classification: "指定第2類",
    category: "解熱鎮痛薬",
    ingredients: ["N2", "S1", "K1"],
    hasUnlistedIngredients: false,
    usage: "1回2錠、1日3回まで",
    packages: "24錠",
    minAge: 15,
    rules: [
      AGE_UNDER(15),
      NSAID_ASTHMA("N2"),
      NSAID_DUE_WITHIN_12_WEEKS("N2"),
      NSAID_PREGNANT_BEFORE_12_WEEKS("N2"),
      ...TAKING(["analgesic", "cold"]),
      DRIVING(["S1"]),
      ALCOHOL,
    ],
  },
  {
    id: "E",
    name: "モダかぜゴールド錠（架空）",
    classification: "指定第2類＋指定濫用防止",
    category: "かぜ薬（総合）",
    ingredients: ["P1", "C1", "E1", "H2"],
    hasUnlistedIngredients: false,
    usage: "1回3錠、1日3回",
    packages: "小箱 60錠（約6日分）／大箱 210錠（約23日分）",
    minAge: 12,
    rules: [
      AGE_UNDER(12),
      {
        code: "ASTHMA",
        condition: { kind: "asthma" },
        verdict: "contraindicated",
        label: "ぜんそく（商品の記載）",
        basis: { productLabel: true },
      },
      ...TAKING(["cold", "antihistamine"]),
      {
        code: "BREASTFEEDING",
        condition: { kind: "breastfeeding" },
        verdict: "contraindicated",
        label: "授乳中（C1）",
        basis: { ingredients: ["C1"], flags: ["avoid_breastfeeding"] },
      },
      DRIVING(["C1", "H2"]),
      ALCOHOL,
    ],
  },
  {
    id: "F",
    name: "モダいぐすり散（架空）",
    classification: "第2類",
    category: "胃腸薬（制酸）",
    ingredients: ["G1"],
    hasUnlistedIngredients: true,
    usage: "1日3回。1回量は年齢による",
    packages: "24包",
    minAge: 5,
    doseByAge: [
      { minAge: 15, maxAgeExclusive: null, dose: "1包" },
      { minAge: 11, maxAgeExclusive: 15, dose: "2/3包" },
      { minAge: 8, maxAgeExclusive: 11, dose: "1/2包" },
      { minAge: 5, maxAgeExclusive: 8, dose: "1/3包" },
      { minAge: 0, maxAgeExclusive: 5, dose: null },
    ],
    rules: [
      AGE_UNDER(5),
      {
        code: "CONDITION",
        condition: { kind: "condition", any: ["dialysis"] },
        verdict: "contraindicated",
        label: "透析療法中",
        basis: { ingredients: ["G1"], flags: ["no_dialysis"] },
      },
      {
        // 14日は11/5 薬剤師の判断（一般的な長期連用の目安「2週間〜1か月」の短い方）
        code: "LONG_TERM_USE",
        condition: { kind: "planned_days_over", days: 14 },
        verdict: "caution",
        label: "14日を超えて飲む予定",
        basis: { productLabel: true },
      },
    ],
  },
  {
    id: "G",
    name: "モダアイクリア（架空）",
    classification: "第2類",
    category: "点眼薬",
    ingredients: ["V1"],
    hasUnlistedIngredients: true,
    usage: "1回1〜2滴、1日5〜6回",
    packages: "12mL",
    minAge: null,
    rules: [
      {
        code: "SOFT_CONTACT_LENS",
        condition: { kind: "soft_contact_lens" },
        verdict: "caution",
        label: "コンタクトを外して使う",
        basis: { productLabel: true },
      },
      {
        code: "CONDITION",
        condition: { kind: "condition", any: ["glaucoma"] },
        verdict: "caution",
        label: "緑内障（相談）",
        basis: { ingredients: ["V1"], flags: ["glaucoma_consult"] },
      },
    ],
  },
  {
    id: "H",
    name: "モダシップ（架空）",
    classification: "第3類",
    category: "外用消炎鎮痛薬",
    ingredients: ["T1"],
    hasUnlistedIngredients: true,
    usage: "1日数回、患部に貼る",
    packages: "40枚",
    minAge: null,
    rules: [
      {
        code: "APPLICATION_SITE",
        condition: { kind: "application_site", site: "eye_or_mucosa" },
        verdict: "caution",
        label: "目の周り・粘膜には使わない",
        basis: { ingredients: ["T1"], flags: ["topical"] },
      },
      {
        code: "APPLICATION_SITE",
        condition: { kind: "application_site", site: "eczema_or_wound" },
        verdict: "caution",
        label: "湿疹・かぶれ・傷口には使わない",
        basis: { ingredients: ["T1"], flags: ["topical"] },
      },
    ],
  },
  {
    id: "I",
    name: "モダねつさまし錠（架空）",
    classification: "第2類",
    category: "解熱鎮痛薬",
    ingredients: ["P1"],
    hasUnlistedIngredients: false,
    usage: "1回1錠、1日3回まで",
    packages: "20錠",
    minAge: 15,
    rules: [
      AGE_UNDER(15),
      ...TAKING(["analgesic", "cold"]),
      {
        code: "ASTHMA",
        condition: { kind: "asthma" },
        verdict: "contraindicated",
        label: "ぜんそく（解熱鎮痛薬）",
        basis: { productLabel: true },
      },
      {
        code: "CONDITION",
        condition: { kind: "condition", any: ["liver"] },
        verdict: "caution",
        label: "肝臓病で治療中（相談）",
        basis: { ingredients: ["P1"] },
      },
      ALCOHOL,
    ],
  },
  {
    id: "J",
    name: "モダ漢方かぜ顆粒（架空）",
    classification: "第2類",
    category: "かぜ薬（漢方）",
    ingredients: ["KP1", "GZ1"],
    hasUnlistedIngredients: false,
    usage: "1日3回、食前または食間。1回量は年齢による",
    packages: "12包",
    minAge: 2,
    doseByAge: [
      { minAge: 15, maxAgeExclusive: null, dose: "1包" },
      { minAge: 7, maxAgeExclusive: 15, dose: "2/3包" },
      { minAge: 4, maxAgeExclusive: 7, dose: "1/2包" },
      { minAge: 2, maxAgeExclusive: 4, dose: "1/3包" },
      { minAge: 0, maxAgeExclusive: 2, dose: null },
    ],
    rules: [
      AGE_UNDER(2),
      {
        // 表の「むくみがある」は問診で聞かず、必要そうな人には薬剤師がチャットで確認する（11/5）
        code: "CONDITION",
        condition: { kind: "condition", any: ["hypertension", "heart", "kidney"] },
        verdict: "caution",
        label: "カンゾウの類（むくみ・高血圧）",
        basis: { ingredients: ["GZ1"], flags: ["licorice_edema_hypertension"] },
      },
      {
        code: "PREGNANT_CONSULT",
        condition: { kind: "pregnant" },
        verdict: "caution",
        label: "妊娠中（相談）",
        basis: { ingredients: ["KP1"], flags: ["kampo"] },
      },
      {
        code: "CONCURRENT_USE",
        condition: { kind: "taking", any: ["kampo"] },
        verdict: "caution",
        label: "生薬の重なり",
        basis: { ingredients: ["KP1"], flags: ["kampo"] },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// 取扱外の薬（「店にない商品」のデモ用）
// ---------------------------------------------------------------------------

export type UnstockedDrug = {
  id: string;
  name: string;
  classification: string;
  category: EfficacyCategory;
  ingredients: readonly IngredientId[];
  hasUnlistedIngredients: boolean;
};

export const UNSTOCKED_DRUGS: readonly UnstockedDrug[] = [
  {
    id: "X1",
    name: "モダかぜナイト錠（架空）",
    classification: "要指導＋指定濫用防止",
    category: "かぜ薬（総合）",
    ingredients: ["N1", "C1", "E1", "H2"],
    hasUnlistedIngredients: false,
  },
  {
    id: "X2",
    name: "モダペインライト錠（架空）",
    classification: "指定第2類",
    category: "解熱鎮痛薬",
    ingredients: ["N2"],
    hasUnlistedIngredients: false,
  },
  {
    id: "X3",
    name: "モダいぐすりマグ散（架空）",
    classification: "第2類",
    category: "胃腸薬（制酸）",
    ingredients: ["G2"],
    hasUnlistedIngredients: false,
  },
];
