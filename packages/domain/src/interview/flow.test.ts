/**
 * 問診の進め方のテスト。docs/demo-data/interview-items.md（薬剤師確認済み ☑）の
 * 「聞く条件」「聞かない条件」と「聞かない・聞き直すときの決まり」から作っている。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError } from "../errors.ts";
import type { StockedDrugId } from "../contraindication/data.ts";
import { judgeDrug } from "../contraindication/judge.ts";
import {
  applyAnswers,
  applyAnswersWithReport,
  assertInterviewComplete,
  isBasicInterviewComplete,
  isInterviewComplete,
  missingQuestions,
  nextQuestion,
  selectDrugs,
  chooseRoute,
  factsForJudgment,
  abusePreventionAnswers,
  type InterviewState,
} from "./flow.ts";
import type { InterviewAnswers, QuestionId } from "./items.ts";

/** 「症状から探す」流れ（基本の項目を全員に聞く。11/6 より前のテストはこの流れにあたる） */
const empty: InterviewState = { answers: {}, selectedDrugs: [], route: "symptom" };

/** 基本の項目の、問題のない答え（30歳女性。妊娠・授乳なし、持病・アレルギー・併用薬・運転なし） */
const basicOk: InterviewAnswers = {
  age: 30,
  sex: "female",
  pregnancy: "no",
  breastfeeding: "no",
  asthmaHistory: "no",
  conditions: [],
  drugAllergy: "no",
  currentMedications: [],
  drivingAfter: false,
};

const withAnswers = (answers: InterviewAnswers, selectedDrugs: StockedDrugId[] = []): InterviewState =>
  applyAnswers({ answers: {}, selectedDrugs, route: "symptom" }, answers);

function assertRuleError(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => err instanceof DomainRuleError && err.code === code);
}

/** 最後の質問まで、問題のない答えで1問ずつ進めて、聞かれた項目の順番を返す */
function walk(start: InterviewState, answerFor: (id: QuestionId) => InterviewAnswers): QuestionId[] {
  const asked: QuestionId[] = [];
  let state = start;
  for (let i = 0; i < 30; i += 1) {
    const id = nextQuestion(state);
    if (id === null) return asked;
    asked.push(id);
    state = applyAnswers(state, answerFor(id));
  }
  throw new Error("問診が終わりません");
}

const answerOf: Record<QuestionId, InterviewAnswers> = {
  Q01: { age: 30 },
  Q02: { sex: "female" },
  Q03: { pregnancy: "no" },
  Q03a: { dueWithin12Weeks: "no" },
  Q04: { breastfeeding: "no" },
  Q05: { weightKg: 30 },
  Q06: { asthmaHistory: "no" },
  Q07: { conditions: [] },
  Q08: { drugAllergy: "no" },
  Q09: { currentMedications: [] },
  Q10: { drivingAfter: false },
  Q11: { alcohol: false },
  Q12: { plannedDays: 3 },
  Q13: { softContactLens: false },
  Q14: { applicationSite: "normal" },
  R01: { otherStorePurchase: "no" },
  R02: { packageChoice: "small_one" },
  R03: { reasonText: "家族の分" },
  R04: { purposeText: "かぜ" },
};

describe("問診の順番：1問ずつ、年齢と性別から聞く", () => {
  it("最初に年齢（Q01）、次に性別（Q02）を聞く", () => {
    assert.equal(nextQuestion(empty), "Q01");
    assert.equal(nextQuestion(withAnswers({ age: 30 })), "Q02");
  });

  it("30歳女性で薬を選ぶ前は、基本の項目（Q01〜Q10 のうち聞くもの）だけを順に聞く", () => {
    assert.deepEqual(
      walk(empty, (id) => answerOf[id]),
      ["Q01", "Q02", "Q03", "Q04", "Q06", "Q07", "Q08", "Q09", "Q10"],
    );
  });

  it("基本の項目を聞き終えるまで、薬ごとの項目は聞かない", () => {
    const state = withAnswers({ age: 30, sex: "female" }, ["C"]);
    assert.equal(nextQuestion(state), "Q03");
  });
});

describe("妊娠・授乳（Q03・Q04）を聞く条件", () => {
  it("男性には妊娠（Q03）・授乳（Q04）を聞かない", () => {
    const asked = walk(empty, (id) => (id === "Q02" ? { sex: "male" } : answerOf[id]));
    assert.ok(!asked.includes("Q03"));
    assert.ok(!asked.includes("Q04"));
  });

  for (const sex of ["female", "other", "no_answer"] as const) {
    it(`性別が「${sex}」の12歳以上には、妊娠（Q03）と授乳（Q04）を聞く`, () => {
      const asked = walk(empty, (id) => (id === "Q02" ? { sex } : id === "Q01" ? { age: 12 } : answerOf[id]));
      assert.ok(asked.includes("Q03"));
      assert.ok(asked.includes("Q04"));
    });
  }

  it("12歳未満には妊娠（Q03）・授乳（Q04）を聞かない", () => {
    const asked = walk(empty, (id) => (id === "Q01" ? { age: 11 } : answerOf[id]));
    assert.ok(!asked.includes("Q03"));
    assert.ok(!asked.includes("Q04"));
  });

  it("12歳未満でも、選んだ薬に A があるときは妊娠（Q03）・授乳（Q04）を聞く（11/6 薬剤師の判断。backlog J-01）", () => {
    const state: InterviewState = { answers: { age: 11, sex: "female" }, selectedDrugs: ["A"], route: "product" };
    const asked = walk(state, (id) => answerOf[id]);
    assert.ok(asked.includes("Q03"));
    assert.ok(asked.includes("Q04"));
  });

  it("12歳未満で A 以外の薬を選んだときは、妊娠（Q03）・授乳（Q04）を聞かない", () => {
    const state: InterviewState = { answers: { age: 11, sex: "female" }, selectedDrugs: ["J"], route: "product" };
    const asked = walk(state, (id) => answerOf[id]);
    assert.ok(!asked.includes("Q03"));
    assert.ok(!asked.includes("Q04"));
  });

  it("12歳未満の男性には、A を選んでも妊娠（Q03）・授乳（Q04）を聞かない", () => {
    const state: InterviewState = { answers: { age: 11, sex: "male" }, selectedDrugs: ["A"], route: "product" };
    const asked = walk(state, (id) => answerOf[id]);
    assert.ok(!asked.includes("Q03"));
    assert.ok(!asked.includes("Q04"));
  });

  it("K45：11歳女性が A を選び、妊娠を「かもしれない」と答えると、問診を終えたあとの判定で A は禁忌になる", () => {
    const start: InterviewState = { answers: { age: 11, sex: "female" }, selectedDrugs: ["A"], route: "product" };
    let state = start;
    for (let i = 0; i < 30; i += 1) {
      const id = nextQuestion(state);
      if (id === null) break;
      state = applyAnswers(state, id === "Q03" ? { pregnancy: "maybe" } : answerOf[id]);
    }
    assert.equal(judgeDrug("A", factsForJudgment(state)).verdict, "contraindicated");
  });

  it("K47：11歳女性が A と J を選び、妊娠を「している」と答えると、問診を終えたあとの判定で J は注意になる", () => {
    let state: InterviewState = { answers: { age: 11, sex: "female" }, selectedDrugs: ["A", "J"], route: "product" };
    for (let i = 0; i < 30; i += 1) {
      const id = nextQuestion(state);
      if (id === null) break;
      state = applyAnswers(state, id === "Q03" ? { pregnancy: "pregnant" } : answerOf[id]);
    }
    assert.equal(judgeDrug("J", factsForJudgment(state)).verdict, "caution");
  });

  it("男性への妊娠の答えは記録に残さない（サーバー側で除外する）", () => {
    const male = withAnswers({ age: 30, sex: "male" });
    const result = applyAnswersWithReport(male, { pregnancy: "no" });
    assert.equal(result.state.answers.pregnancy, undefined);
    assert.deepEqual(result.ignored, ["Q03"]);
  });

  it("聞かない項目への答えが混じっても、ほかの答えは受け取る（11/6 の判断）", () => {
    const result = applyAnswersWithReport(empty, { age: 30, sex: "male", pregnancy: "not_applicable", asthmaHistory: "no" });
    assert.equal(result.state.answers.age, 30);
    assert.equal(result.state.answers.sex, "male");
    assert.equal(result.state.answers.asthmaHistory, "no");
    assert.equal(result.state.answers.pregnancy, undefined);
    assert.deepEqual(result.ignored, ["Q03"]);
  });

  it("薬を選ぶ前の、薬ごとの項目への答えは捨てて、ほかの答えは受け取る", () => {
    const result = applyAnswersWithReport(withAnswers({ age: 30, sex: "female" }), { asthmaHistory: "no", alcohol: false });
    assert.equal(result.state.answers.asthmaHistory, "no");
    assert.equal(result.state.answers.alcohol, undefined);
    assert.deepEqual(result.ignored, ["Q11"]);
  });

  it("問診の項目にない答えは、捨てずに止める", () => {
    assertRuleError(
      () => applyAnswers(empty, { age: 30, favoriteColor: "blue" } as unknown as InterviewAnswers),
      "FACT_INVALID",
    );
  });
});

describe("出産予定日（Q03a）を聞く条件", () => {
  it("妊娠（Q03）で「妊娠している」と答えたときだけ聞く", () => {
    const state = withAnswers({ age: 30, sex: "female", pregnancy: "pregnant" });
    assert.equal(nextQuestion(state), "Q03a");
  });

  for (const pregnancy of ["maybe", "no", "not_applicable"] as const) {
    it(`妊娠（Q03）が「${pregnancy}」なら出産予定日（Q03a）は聞かない`, () => {
      const state = withAnswers({ age: 30, sex: "female", pregnancy });
      assert.ok(!missingQuestions(state).includes("Q03a"));
    });
  }
});

describe("体重（Q05）を聞く条件", () => {
  it("15歳未満には体重を聞く", () => {
    const asked = walk(empty, (id) => (id === "Q01" ? { age: 14 } : answerOf[id]));
    assert.ok(asked.includes("Q05"));
  });

  it("15歳以上には体重を聞かない", () => {
    const asked = walk(empty, (id) => (id === "Q01" ? { age: 15 } : answerOf[id]));
    assert.ok(!asked.includes("Q05"));
  });
});

describe("薬ごとの項目（Q11〜Q14）を聞く条件", () => {
  const cases: { drug: StockedDrugId; asks: QuestionId[]; notAsks: QuestionId[] }[] = [
    { drug: "C", asks: ["Q11"], notAsks: ["Q12", "Q13", "Q14"] },
    { drug: "D", asks: ["Q11"], notAsks: ["Q12", "Q13", "Q14"] },
    { drug: "I", asks: ["Q11"], notAsks: ["Q12", "Q13", "Q14"] },
    { drug: "B", asks: ["Q12"], notAsks: ["Q11", "Q13", "Q14"] },
    { drug: "F", asks: ["Q12"], notAsks: ["Q11", "Q13", "Q14"] },
    { drug: "G", asks: ["Q13"], notAsks: ["Q11", "Q12", "Q14"] },
    { drug: "H", asks: ["Q14"], notAsks: ["Q11", "Q12", "Q13"] },
    { drug: "E", asks: ["Q11"], notAsks: ["Q12", "Q13", "Q14"] },
  ];
  for (const { drug, asks, notAsks } of cases) {
    it(`薬 ${drug} を選ぶと ${asks.join("・")} を聞き、${notAsks.join("・")} は聞かない`, () => {
      const missing = missingQuestions(withAnswers(basicOk, [drug]));
      for (const id of asks) assert.ok(missing.includes(id), id);
      for (const id of notAsks) assert.ok(!missing.includes(id), id);
    });
  }

  it("薬を選ぶ前は、薬ごとの項目を聞かない", () => {
    assert.deepEqual(missingQuestions(withAnswers(basicOk)), []);
  });
});

describe("指定濫用防止医薬品を選んだときの追加の問診（R01〜R04）", () => {
  it("B を選ぶと R01（ほかの店での購入）と R04（使う目的）を聞き、R02（個数）は聞かない", () => {
    const missing = missingQuestions(withAnswers(basicOk, ["B"]));
    assert.ok(missing.includes("R01"));
    assert.ok(missing.includes("R04"));
    assert.ok(!missing.includes("R02"));
  });

  it("E を選ぶと R01・R02・R04 を聞く", () => {
    const missing = missingQuestions(withAnswers(basicOk, ["E"]));
    for (const id of ["R01", "R02", "R04"] as const) assert.ok(missing.includes(id), id);
  });

  it("R02 で小箱1個なら、理由（R03）は聞かない", () => {
    const state = withAnswers({ ...basicOk, packageChoice: "small_one" }, ["E"]);
    assert.ok(!missingQuestions(state).includes("R03"));
  });

  for (const answer of [{ packageChoice: "large_one" }, { packageChoice: "multiple", multipleCount: 2 }] as const) {
    it(`R02 で「${answer.packageChoice}」なら、理由（R03）を聞く`, () => {
      const state = withAnswers({ ...basicOk, ...answer }, ["E"]);
      assert.ok(missingQuestions(state).includes("R03"));
    });
  }

  it("B・E 以外の薬では、追加の問診（R01〜R04）を聞かない", () => {
    const missing = missingQuestions(withAnswers(basicOk, ["C", "G"]));
    for (const id of ["R01", "R02", "R03", "R04"] as const) assert.ok(!missing.includes(id), id);
  });
});

describe("数字の答えは整数で、決まった範囲だけを受け取る（interview-items.md。11/6 の判断。backlog J-07・C-13）", () => {
  const start: InterviewState = { answers: {}, selectedDrugs: [], route: "symptom" };
  const forDays = (): InterviewState => withAnswers({ ...basicOk }, ["F"]);
  const forCount = (): InterviewState => withAnswers({ ...basicOk, alcohol: false, otherStorePurchase: "no" }, ["E"]);

  for (const age of [0, 120]) {
    it(`年齢（Q01）の ${age} 歳は受け取る（範囲の端）`, () => {
      assert.equal(applyAnswers(start, { age }).answers.age, age);
    });
  }
  for (const age of [121, 30.5, -1]) {
    it(`年齢（Q01）の ${age} は受け取らず、同じ質問をもう一度する`, () => {
      assertRuleError(() => applyAnswers(start, { age }), "FACT_INVALID");
      assert.equal(nextQuestion(start), "Q01");
    });
  }

  for (const plannedDays of [1, 365]) {
    it(`飲む予定の日数（Q12）の ${plannedDays} 日は受け取る（範囲の端）`, () => {
      assert.equal(applyAnswers(forDays(), { plannedDays }).answers.plannedDays, plannedDays);
    });
  }
  for (const plannedDays of [0, 366, 2.5]) {
    it(`飲む予定の日数（Q12）の ${plannedDays} は受け取らず、同じ質問をもう一度する`, () => {
      const state = forDays();
      const before = nextQuestion(state);
      assertRuleError(() => applyAnswers(state, { plannedDays }), "FACT_INVALID");
      assert.equal(before, "Q12");
    });
  }

  it("買いたい個数（R02）の「複数個」で 99 個は受け取る（範囲の端）", () => {
    assert.equal(applyAnswers(forCount(), { packageChoice: "multiple", multipleCount: 99 }).answers.multipleCount, 99);
  });
  for (const multipleCount of [100, 2.5]) {
    it(`買いたい個数（R02）の「複数個」で ${multipleCount} 個は受け取らず、同じ質問をもう一度する`, () => {
      const state = forCount();
      assert.equal(nextQuestion(state), "R02");
      assertRuleError(() => applyAnswers(state, { packageChoice: "multiple", multipleCount }), "FACT_INVALID");
    });
  }
});

describe("必要な項目がそろうまで問診を終えない", () => {
  it("薬を選ぶ前は、問診を終えられない", () => {
    assert.equal(isBasicInterviewComplete(withAnswers(basicOk)), true);
    assert.equal(isInterviewComplete(withAnswers(basicOk)), false);
    assertRuleError(() => assertInterviewComplete(withAnswers(basicOk)), "NO_DRUG_SELECTED");
  });

  it("選んだ薬の項目が残っていると、問診を終えられない", () => {
    const state = withAnswers(basicOk, ["C"]);
    assert.equal(isInterviewComplete(state), false);
    assertRuleError(() => assertInterviewComplete(state), "INTERVIEW_INCOMPLETE");
  });

  it("選んだ薬の項目までそろうと、問診を終えられる", () => {
    const state = withAnswers({ ...basicOk, alcohol: false }, ["C"]);
    assert.equal(isInterviewComplete(state), true);
    assert.doesNotThrow(() => assertInterviewComplete(state));
  });
});

describe("答えの受け取り方（聞かない・聞き直すときの決まり）", () => {
  it("一度に複数の項目に答えたら、当てはまる項目をすべて確認済みにする", () => {
    const state = applyAnswers(empty, { age: 30, sex: "female", asthmaHistory: "no" });
    assert.equal(nextQuestion(state), "Q03");
    assert.ok(!missingQuestions(state).includes("Q06"));
  });

  it("決められた形でない答えは受け取らない（推測で進めず、同じ質問をもう一度出す）", () => {
    assertRuleError(() => applyAnswers(empty, { age: Number.NaN }), "FACT_INVALID");
    assertRuleError(
      () => applyAnswers(withAnswers({ age: 30 }), { sex: "unknown" as unknown as "male" }),
      "FACT_INVALID",
    );
    // 受け取らなかったので、次に聞く項目は変わらない
    assert.equal(nextQuestion(empty), "Q01");
  });

  it("答え直すと上書きされる（訂正を受け付ける）", () => {
    const state = applyAnswers(withAnswers({ age: 30, sex: "female", asthmaHistory: "no" }), { asthmaHistory: "yes" });
    assert.equal(state.answers.asthmaHistory, "yes");
  });

  it("性別を「男性」に直したら、妊娠・授乳の答えは残さない", () => {
    const female = withAnswers({ age: 30, sex: "female", pregnancy: "pregnant", dueWithin12Weeks: "no", breastfeeding: "no" });
    const male = applyAnswers(female, { sex: "male" });
    assert.equal(male.answers.pregnancy, undefined);
    assert.equal(male.answers.dueWithin12Weeks, undefined);
    assert.equal(male.answers.breastfeeding, undefined);
  });

  it("妊娠を「していない」に直したら、出産予定日（Q03a）の答えは残さない", () => {
    const pregnant = withAnswers({ age: 30, sex: "female", pregnancy: "pregnant", dueWithin12Weeks: "yes" });
    const corrected = applyAnswers(pregnant, { pregnancy: "no" });
    assert.equal(corrected.answers.dueWithin12Weeks, undefined);
  });

  it("薬を選び直して聞く必要がなくなった項目の答えは残さない", () => {
    const withC = withAnswers({ ...basicOk, alcohol: true }, ["C"]);
    const toG = selectDrugs(withC, ["G"]);
    assert.equal(toG.answers.alcohol, undefined);
    assert.deepEqual(missingQuestions(toG), ["Q13"]);
  });
});

describe("問診と禁忌判定のつながり", () => {
  const allDrugs: StockedDrugId[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  const people: { label: string; age: number; sex: "male" | "female" | "other" | "no_answer" }[] = [
    { label: "30歳女性", age: 30, sex: "female" },
    { label: "30歳男性", age: 30, sex: "male" },
    { label: "12歳（性別：答えない）", age: 12, sex: "no_answer" },
    { label: "11歳女性", age: 11, sex: "female" },
    { label: "14歳（性別：その他）", age: 14, sex: "other" },
  ];

  for (const drug of allDrugs) {
    for (const person of people) {
      it(`${person.label}が薬 ${drug} を選んで問診を最後まで答えたら、その薬の禁忌判定がエラーで止まらない`, () => {
        let state = selectDrugs(empty, [drug]);
        for (let i = 0; i < 30; i += 1) {
          const id = nextQuestion(state);
          if (id === null) break;
          const answer = id === "Q01" ? { age: person.age } : id === "Q02" ? { sex: person.sex } : answerOf[id];
          state = applyAnswers(state, answer);
        }
        assert.equal(isInterviewComplete(state), true);
        assert.doesNotThrow(() => judgeDrug(drug, factsForJudgment(state)));
      });
    }
  }

  it("禁忌判定に渡す答えには、指定濫用防止の追加の問診（R01〜R04）を含めない", () => {
    const state = withAnswers({ ...basicOk, alcohol: false, otherStorePurchase: "no", packageChoice: "small_one", purposeText: "かぜ" }, ["E"]);
    const facts = factsForJudgment(state);
    assert.equal("otherStorePurchase" in facts, false);
    assert.equal("packageChoice" in facts, false);
    assert.deepEqual(abusePreventionAnswers(state), { otherStorePurchase: "no", packageChoice: "small_one", purposeText: "かぜ" });
  });
});

describe("訂正で聞く条件が変わるとき", () => {
  it("R02 を「複数個（3個）」から「小箱1個」に直せる。個数と理由（R03）の答えは残さない", () => {
    const multiple = withAnswers({ ...basicOk, packageChoice: "multiple", multipleCount: 3, reasonText: "家族の分" }, ["E"]);
    const corrected = applyAnswers(multiple, { packageChoice: "small_one" });
    assert.equal(corrected.answers.packageChoice, "small_one");
    assert.equal(corrected.answers.multipleCount, undefined);
    assert.equal(corrected.answers.reasonText, undefined);
  });

  it("R02 の「複数個」は、個数と一緒でなければ受け取らない", () => {
    const state = withAnswers(basicOk, ["E"]);
    assertRuleError(() => applyAnswers(state, { packageChoice: "multiple" }), "FACT_INVALID");
  });

  it("年齢を30歳から10歳に直したら、妊娠・授乳の答えは残さず、体重（Q05）を聞く", () => {
    const adult = withAnswers(basicOk);
    const child = applyAnswers(adult, { age: 10 });
    assert.equal(child.answers.pregnancy, undefined);
    assert.equal(child.answers.breastfeeding, undefined);
    assert.equal(nextQuestion(child), "Q05");
  });

  it("年齢を10歳から15歳に直したら、体重の答えは残さず、妊娠（Q03）を聞く", () => {
    const child = withAnswers({ age: 10, sex: "female", weightKg: 30 });
    const teen = applyAnswers(child, { age: 15 });
    assert.equal(teen.answers.weightKg, undefined);
    assert.equal(nextQuestion(teen), "Q03");
  });
});

describe("選んだ薬の確かめ", () => {
  it("取扱薬にない記号は選べない", () => {
    assertRuleError(() => selectDrugs(empty, ["Z" as StockedDrugId]), "UNKNOWN_DRUG");
  });
});

describe("問診の流れ：ほしい薬がある／症状から探す（11/6 の判断）", () => {
  const noRoute: InterviewState = { answers: {}, selectedDrugs: [] };
  const attributes: InterviewAnswers = { age: 30, sex: "female" };

  it("流れが決まるまでは、年齢・性別だけを聞く", () => {
    const state = applyAnswers(noRoute, attributes);
    assert.equal(nextQuestion(state), null);
    assert.equal(isBasicInterviewComplete(state), false);
  });

  it("年齢・性別を答える前は、流れを選べない", () => {
    assertRuleError(() => chooseRoute(noRoute, "product"), "ATTRIBUTES_INCOMPLETE");
  });

  it("「症状から探す」では、基本の項目をすべて聞く", () => {
    const state = chooseRoute(applyAnswers(noRoute, attributes), "symptom");
    assert.deepEqual(missingQuestions(state), ["Q03", "Q04", "Q06", "Q07", "Q08", "Q09", "Q10"]);
  });

  it("「ほしい薬がある」では、薬を選ぶ前に聞く基本の項目はなく、すぐに薬の選択に進める", () => {
    const state = chooseRoute(applyAnswers(noRoute, attributes), "product");
    assert.equal(nextQuestion(state), null);
    assert.equal(isBasicInterviewComplete(state), true);
  });

  // 聞く項目は、drugs.md（薬剤師確認済み）の各薬の「してはいけないことと注意」の行から決まる
  // いま飲んでいる薬（Q09）は、判定に使わなくても、どの薬を選んでも聞く（11/6 依頼主の判断。contraindication-tests.md K39）
  const productCases: { drug: StockedDrugId; asks: QuestionId[] }[] = [
    { drug: "G", asks: ["Q07", "Q09", "Q13"] }, // 緑内障（相談）・ソフトコンタクト
    { drug: "H", asks: ["Q09", "Q14"] }, // 貼る場所
    { drug: "F", asks: ["Q07", "Q09", "Q12"] }, // 透析・長く続けて飲む
    { drug: "A", asks: ["Q03", "Q04", "Q07", "Q08", "Q09"] }, // 妊娠・授乳・肝臓病・アレルギー歴
  ];
  for (const { drug, asks } of productCases) {
    it(`「ほしい薬がある」で薬 ${drug} を選んだ30歳女性には、${asks.join("・")} だけを聞く`, () => {
      const state = selectDrugs(chooseRoute(applyAnswers(noRoute, attributes), "product"), [drug]);
      assert.deepEqual(missingQuestions(state), asks);
    });
  }

  it("「ほしい薬がある」で薬を選ぶと、判定に使わない薬でも、いま飲んでいる薬（Q09・処方薬）を聞く（K39）", () => {
    // 貼り薬 H の判定には Q09 を使わないが、薬剤師が処方薬との飲み合わせを判断するために聞く
    const state = selectDrugs(chooseRoute(applyAnswers(noRoute, attributes), "product"), ["H"]);
    assert.equal(nextQuestion(state), "Q09");
  });

  it("「ほしい薬がある」では、薬を選ぶ前はいま飲んでいる薬（Q09）を聞かない（薬を選んでから聞く）", () => {
    const state = chooseRoute(applyAnswers(noRoute, attributes), "product");
    assert.ok(!missingQuestions(state).includes("Q09"));
  });

  it("「ほしい薬がある」で薬を選び直しても、いま飲んでいる薬（Q09）の答えは消えない", () => {
    let state = selectDrugs(chooseRoute(applyAnswers(noRoute, attributes), "product"), ["H"]);
    state = applyAnswers(state, { currentMedications: [] });
    state = selectDrugs(state, ["G"]);
    assert.deepEqual(state.answers.currentMedications, []);
  });

  it("「ほしい薬がある」でも、15歳未満には体重（Q05）を聞く（用量の確認のため）", () => {
    const state = selectDrugs(chooseRoute(applyAnswers(noRoute, { age: 10, sex: "male" }), "product"), ["G"]);
    assert.ok(missingQuestions(state).includes("Q05"));
  });

  it("「ほしい薬がある」から「症状から探す」に選び直すと、残りの基本の項目を聞く", () => {
    const product = chooseRoute(applyAnswers(noRoute, attributes), "product");
    const symptom = chooseRoute(product, "symptom");
    assert.equal(nextQuestion(symptom), "Q03");
  });

  it("流れが決まっていなければ、問診を終えられない", () => {
    const state = selectDrugs(applyAnswers(noRoute, attributes), ["H"]);
    assertRuleError(() => assertInterviewComplete(state), "ROUTE_NOT_CHOSEN");
  });

  const allDrugs: StockedDrugId[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  const people: { label: string; age: number; sex: "male" | "female" | "other" | "no_answer" }[] = [
    { label: "30歳女性", age: 30, sex: "female" },
    { label: "30歳男性", age: 30, sex: "male" },
    { label: "12歳（性別：答えない）", age: 12, sex: "no_answer" },
    { label: "11歳女性", age: 11, sex: "female" },
  ];
  for (const drug of allDrugs) {
    for (const person of people) {
      it(`「ほしい薬がある」で${person.label}が薬 ${drug} を選んで問診を最後まで答えたら、禁忌判定がエラーで止まらない`, () => {
        let state = applyAnswers(noRoute, { age: person.age, sex: person.sex });
        state = selectDrugs(chooseRoute(state, "product"), [drug]);
        for (let i = 0; i < 30; i += 1) {
          const id = nextQuestion(state);
          if (id === null) break;
          state = applyAnswers(state, answerOf[id]);
        }
        assert.equal(isInterviewComplete(state), true);
        assert.doesNotThrow(() => judgeDrug(drug, factsForJudgment(state)));
      });
    }
  }
});

describe("「その他」の文・薬の名前の扱い（No.14 のレビュー）", () => {
  const symptom30: InterviewState = applyAnswers(empty, { age: 30, sex: "female" });

  it("治療中の病気（Q07）を答え直して「その他」を外したら、前の「その他」の文は残らない", () => {
    let state = applyAnswers(symptom30, { conditions: [], otherConditionText: "持病の名前" });
    state = applyAnswers(state, { conditions: ["liver"] });
    assert.deepEqual(state.answers.conditions, ["liver"]);
    assert.equal(state.answers.otherConditionText, undefined);
  });

  it("「症状から探す」から「ほしい薬がある」に選び直して治療中の病気（Q07）を聞かなくなったら、「その他」の文も消える", () => {
    let state = applyAnswers(symptom30, { conditions: [], otherConditionText: "持病の名前" });
    state = selectDrugs(chooseRoute(state, "product"), ["H"]); // 貼り薬 H の判定には Q07 を使わない
    assert.equal(state.answers.conditions, undefined);
    assert.equal(state.answers.otherConditionText, undefined);
  });

  it("いま飲んでいる薬（Q09）を答え直したら、前に入れた薬の名前は残らない", () => {
    let state = applyAnswers(symptom30, { currentMedications: ["prescription"], prescriptionDrugNames: ["薬の名前"] });
    state = applyAnswers(state, { currentMedications: [] });
    assert.deepEqual(state.answers.currentMedications, []);
    assert.equal(state.answers.prescriptionDrugNames, undefined);
  });

  it("いま飲んでいる薬（Q09）で「その他」だけを選んで名前を入れたとき、名前は消えない", () => {
    const state = applyAnswers(symptom30, { currentMedications: ["other"], prescriptionDrugNames: ["薬の名前"] });
    assert.deepEqual(state.answers.prescriptionDrugNames, ["薬の名前"]);
  });

  it("ほかの項目に答えても、いま飲んでいる薬（Q09）の名前は消えない", () => {
    let state = applyAnswers(symptom30, { currentMedications: ["prescription"], prescriptionDrugNames: ["薬の名前"] });
    state = applyAnswers(state, { drivingAfter: false });
    assert.deepEqual(state.answers.prescriptionDrugNames, ["薬の名前"]);
  });
});
