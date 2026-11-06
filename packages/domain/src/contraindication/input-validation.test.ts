/**
 * 決められた形でない答え・成分では、推測で判定を続けずエラーで止まることのテスト（CLAUDE.md ルール7・8）。
 * 医療の正解（禁忌かどうか）を決めるテストではない。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError } from "../errors.ts";
import type { InterviewFacts } from "./facts.ts";
import { doseForAge, judgeDrug, rankCandidates } from "./judge.ts";
import { matchStockedDrugs, type ShownDrug } from "./match.ts";

const BASE: InterviewFacts = {
  age: 30,
  sex: "female",
  pregnancy: "no",
  breastfeeding: "no",
  asthmaHistory: "no",
  conditions: [],
  drugAllergy: "no",
  currentMedications: [],
  drivingAfter: false,
  alcohol: false,
  plannedDays: 1,
  softContactLens: false,
  applicationSite: "normal",
};

/** 型では書けない「おかしな値」を入れるため、わざと型を外す */
const withRaw = (overrides: Record<string, unknown>): InterviewFacts =>
  ({ ...BASE, ...overrides }) as unknown as InterviewFacts;

function assertRuleError(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => err instanceof DomainRuleError && err.code === code);
}

describe("問診の答えが決められた形でないときは判定せずに止まる", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["年齢が数でない（NaN）", { age: Number.NaN }],
    ["年齢がマイナス", { age: -1 }],
    ["年齢が無限大", { age: Number.POSITIVE_INFINITY }],
    ["年齢が文字", { age: "30" }],
    ["ぜんそく歴が選択肢にない文字（Yes）", { asthmaHistory: "Yes" }],
    ["性別が選択肢にない文字", { sex: "F" }],
    ["妊娠が選択肢にない文字", { pregnancy: "yes" }],
    ["治療中の病気に一覧にない項目がある", { conditions: ["cancer"] }],
    ["治療中の病気が一覧の形でない", { conditions: "liver" }],
    ["いま飲んでいる薬に一覧にない項目がある", { currentMedications: ["sleeping_pill"] }],
    ["運転の予定が「はい・いいえ」でない", { drivingAfter: "yes" }],
    ["飲む予定の日数が数でない（NaN）", { plannedDays: Number.NaN }],
    ["飲む予定の日数がマイナス", { plannedDays: -3 }],
    ["貼る場所が選択肢にない", { applicationSite: "face" }],
    ["値が null", { asthmaHistory: null }],
    ["知らない項目がある", { favoriteColor: "blue" }],
  ];

  for (const [name, overrides] of cases) {
    it(`${name}ときは FACT_INVALID で止まる`, () => {
      assertRuleError(() => judgeDrug("C", withRaw(overrides)), "FACT_INVALID");
    });
  }

  it("候補の並べ替えでも、おかしな答えなら止まる", () => {
    assertRuleError(() => rankCandidates(["B", "E", "J"], withRaw({ asthmaHistory: "Yes" })), "FACT_INVALID");
  });

  it("年齢別の用量でも、年齢がおかしければ止まる", () => {
    assertRuleError(() => doseForAge("F", Number.NaN), "FACT_INVALID");
    assertRuleError(() => doseForAge("F", -1), "FACT_INVALID");
  });

  it("判定に使う答えがまだないときは FACT_MISSING で止まる", () => {
    const facts: InterviewFacts = { ...BASE };
    delete facts.asthmaHistory;
    assertRuleError(() => judgeDrug("C", facts), "FACT_MISSING");
  });
});

describe("見せられた薬の成分が照合に使えない形のときは止まる", () => {
  const shown = (overrides: Record<string, unknown>): ShownDrug =>
    ({ ingredients: ["N2"], hasUnlistedIngredients: false, category: "解熱鎮痛薬", ...overrides }) as unknown as ShownDrug;

  it("成分が1つもないときは SHOWN_DRUG_INVALID で止まる（全部の薬が候補に出ない）", () => {
    assertRuleError(() => matchStockedDrugs(shown({ ingredients: [] })), "SHOWN_DRUG_INVALID");
  });

  it("成分が1つもなく「ほか」があるだけのときも止まる", () => {
    assertRuleError(
      () => matchStockedDrugs(shown({ ingredients: [], hasUnlistedIngredients: true })),
      "SHOWN_DRUG_INVALID",
    );
  });

  it("成分辞書にない記号があるときは SHOWN_DRUG_INVALID で止まる", () => {
    assertRuleError(() => matchStockedDrugs(shown({ ingredients: ["N2", "ZZ9"] })), "SHOWN_DRUG_INVALID");
  });
});
