/**
 * 候補の薬・代わりの薬の「仮の判定」と選び方（backlog C-03・C-11）のテスト。
 * docs/demo-data/contraindication-tests.md の ☑ の行（K01・K03・K25・K28・K45・K46・K47）と、
 * interview-items.md の ☑ の「聞く条件」（Q03・Q04・Q13）から作る。
 * 表に書いていない答えは、表の決まりどおり「問題のない答え」（30歳女性など）とする。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError } from "../errors.ts";
import { judgeDrug, judgeDrugWithKnownFacts } from "../contraindication/judge.ts";
import { applyAnswers, nextQuestion, type InterviewState } from "../interview/flow.ts";
import type { InterviewAnswers } from "../interview/items.ts";
import { isKnownContraindicated, previewCandidates, selectCandidateDrugs } from "./candidates.ts";

/** 基本の項目の、問題のない答え（30歳女性） */
const BASIC: InterviewAnswers = {
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

/** 11歳の女性の基本の答え（12歳未満なので、A を選ぶまで妊娠・授乳は聞かない。体重 Q05 は15歳未満に聞く） */

const CHILD11: InterviewAnswers = {
  age: 11,
  sex: "female",
  weightKg: 30,
  asthmaHistory: "no",
  conditions: [],
  drugAllergy: "no",
  currentMedications: [],
  drivingAfter: false,
};

/** 「症状から探す」で基本の項目まで答えた状態（薬はまだ選んでいない） */
function symptomState(answers: InterviewAnswers): InterviewState {
  return applyAnswers({ answers: {}, selectedDrugs: [], route: "symptom" }, answers);
}

function assertRuleError(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => err instanceof DomainRuleError && err.code === code);
}

describe("候補の薬の仮の判定", () => {
  it("K28：ぜんそく歴が「わからない」でかぜの薬を探すと、B・E は禁忌と分かり後ろに、J が先頭に来る", () => {
    const state = symptomState({ ...BASIC, asthmaHistory: "unknown" });
    const previews = previewCandidates(state, ["B", "E", "J"]);
    assert.deepEqual(
      previews.map((p) => p.drugId),
      ["J", "B", "E"],
    );
    const [j, b, e] = previews;
    assert.equal(j?.status, "judged");
    assert.equal(j?.status === "judged" ? j.judgment.verdict : null, "ok");
    // B・E の項目（日数・個数など）はまだ聞いていないが、ぜんそく歴で禁忌と分かる
    assert.equal(b?.status, "needs_questions");
    assert.equal(b && isKnownContraindicated(b), true);
    assert.equal(e && isKnownContraindicated(e), true);
  });

  it("K01・K03：ぜんそくを起こしたことがあると、C は禁忌と分かり、G は「ソフトコンタクトレンズ（Q13）を聞く」になる（問題なしとは出さない）", () => {
    const state = symptomState({ ...BASIC, asthmaHistory: "yes" });
    const [g, c] = previewCandidates(state, ["C", "G"]);
    assert.equal(g?.drugId, "G");
    assert.equal(g?.status, "needs_questions");
    assert.deepEqual(g?.status === "needs_questions" ? g.questionIds : null, ["Q13"]);
    assert.deepEqual(g?.status === "needs_questions" ? g.knownReasons : null, []);
    assert.equal(c?.drugId, "C");
    assert.equal(c && isKnownContraindicated(c), true);
  });

  it("K45・C-11：「症状から探す」で11歳の女性に A を出すと、妊娠（Q03）・授乳（Q04）を聞く候補になる（答えが足りないエラーで止まらない）", () => {
    const state = symptomState(CHILD11);
    const [a] = previewCandidates(state, ["A"]);
    assert.equal(a?.status, "needs_questions");
    assert.deepEqual(a?.status === "needs_questions" ? a.questionIds : null, ["Q03", "Q04"]);
  });

  it("K25：その薬の項目をすべて答えたあとの結果は、judgeDrug と同じ", () => {
    const facts = { ...BASIC, alcohol: false };
    const known = judgeDrugWithKnownFacts("E", facts);
    // 指定濫用防止の追加の問診（R01〜R04）は禁忌判定には使わないので、判定に足りない項目はない
    assert.deepEqual(known.missingItemIds, []);
    assert.deepEqual(known.knownReasons, judgeDrug("E", facts).reasons);
    assert.equal(judgeDrug("E", facts).verdict, "ok");
  });

  it("年齢・性別がないときは、仮の判定でも止める（妊娠・授乳の条件を黙って飛ばさない）", () => {
    assertRuleError(() => judgeDrugWithKnownFacts("A", { asthmaHistory: "no" }), "FACT_MISSING");
  });
});

describe("候補の薬を選んで、その薬の項目を聞く問診に戻す", () => {
  it("K03：G を選ぶと、次にソフトコンタクトレンズ（Q13）を聞く", () => {
    const state = selectCandidateDrugs(symptomState({ ...BASIC, asthmaHistory: "yes" }), ["G"]);
    assert.deepEqual(state.selectedDrugs, ["G"]);
    assert.equal(nextQuestion(state), "Q13");
  });

  // 11/7 依頼主の判断で、前は「選べない」だったのを「選べる（販売には解除が要る）」に変えた
  it("K01：いまの答えで禁忌と分かっている C も、候補としては選べ、その薬の項目（Q11）を聞く", () => {
    const state = selectCandidateDrugs(symptomState({ ...BASIC, asthmaHistory: "yes" }), ["C"]);
    assert.deepEqual(state.selectedDrugs, ["C"]);
    assert.equal(nextQuestion(state), "Q11");
  });

  it("1つも選ばなければ止める", () => {
    assertRuleError(() => selectCandidateDrugs(symptomState(BASIC), []), "NO_DRUG_SELECTED");
  });

  it("K45・K46・C-11：11歳の女性に薬剤師が A を選ぶと、妊娠・授乳を聞き、その答えで判定する", () => {
    const start = symptomState(CHILD11);
    const chosen = selectCandidateDrugs(start, ["A"]);
    assert.equal(nextQuestion(chosen), "Q03");
    const maybe = applyAnswers(chosen, { pregnancy: "maybe", breastfeeding: "no" });
    assert.equal(nextQuestion(maybe), null);
    assert.equal(judgeDrug("A", maybe.answers).verdict, "contraindicated"); // K45
    const not = applyAnswers(chosen, { pregnancy: "no", breastfeeding: "no" });
    assert.equal(judgeDrug("A", not.answers).verdict, "ok"); // K46
  });

  it("K47・K51：A と J を一緒に選んで妊娠していると答えた11歳の女性は、薬剤師が J だけに選び直しても、その答えを J の判定に使い続ける（J は注意）", () => {
    const start = symptomState(CHILD11);
    const both = applyAnswers(selectCandidateDrugs(start, ["A", "J"]), { pregnancy: "pregnant", dueWithin12Weeks: "no", breastfeeding: "no" });
    assert.equal(judgeDrug("J", both.answers).verdict, "caution"); // K47
    const onlyJ = selectCandidateDrugs(both, ["J"]);
    assert.equal(onlyJ.answers.pregnancy, "pregnant");
    assert.equal(nextQuestion(onlyJ), null); // J だけなら12歳未満には聞かないので、聞き直さない
    assert.equal(judgeDrug("J", onlyJ.answers).verdict, "caution"); // K51
  });
});
