import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError, type InterviewAnswers, type StockedDrugId } from "@moda/domain";

import {
  checkProcedureStep,
  chooseSaleDrugs,
  declineSale,
  japanDate,
  openPharmacistReview,
  pharmacistView,
  returnToDrugSelection,
} from "./pharmacist-service.ts";
import {
  SessionServiceError,
  answer,
  chooseDrugs,
  chooseRoute,
  createSession,
  getSession,
  type ServiceDeps,
  type SessionRecord,
} from "./session-service.ts";

// 禁忌の判定は docs/demo-data/contraindication-tests.md の ☑ の行（K01・K03）、
// 販売手順は docs/demo-data/sales-procedures.md の ☑ の行（S06・S13、手順の表 P01・P02 の備考）にそろえる。

const NOW = new Date("2026-11-06T10:00:00+09:00");

function testDeps(): ServiceDeps {
  const map = new Map<string, SessionRecord>();
  let n = 0;
  return {
    store: { get: (id) => map.get(id), set: (r) => void map.set(r.id, r) },
    now: () => NOW,
    newId: () => `s${(n += 1)}`,
  };
}

function assertError(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => (err instanceof DomainRuleError || err instanceof SessionServiceError) && err.code === code);
}

/** 30歳女性の、問題のない答え（表に書いていない項目の決まり） */
const fine: InterviewAnswers = {
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

/** 「ほしい薬がある」で薬を選び、その薬の項目まで答える（薬の選択まで進む） */
function answeredProduct(deps: ServiceDeps, drugs: StockedDrugId[], extra: InterviewAnswers = {}): string {
  const { id } = createSession(deps, "en");
  answer(deps, id, { age: 30, sex: "female" });
  chooseRoute(deps, id, "product");
  chooseDrugs(deps, id, drugs);
  answer(deps, id, { ...fine, ...extra });
  assert.equal(getSession(deps, id).snapshot.status, "drug_selection");
  return id;
}

describe("薬剤師の確認を始める", () => {
  it("問診を答え終えると、薬の選択から薬剤師の確認に進める", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["G"]);
    assert.equal(openPharmacistReview(deps, id).snapshot.status, "pharmacist_review");
  });

  it("問診の途中では、薬剤師の確認に進めない", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    answer(deps, id, { age: 30, sex: "female" });
    assertError(() => openPharmacistReview(deps, id), "INVALID_TRANSITION");
  });

  it("すでに確認中なら、もう一度開いても確認の記録を増やさない", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["G"]);
    openPharmacistReview(deps, id);
    assert.equal(openPharmacistReview(deps, id).pharmacistReviews?.length, 1);
  });

  it("選んだ薬ごとに、その薬のために聞いた項目と禁忌の判定を返す", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["G"]);
    const view = pharmacistView(openPharmacistReview(deps, id), NOW);
    const [drug] = view.drugs;
    assert.equal(drug?.drugId, "G");
    assert.ok(drug?.questionIds.includes("Q13"));
    assert.equal(drug?.judgment.verdict, "ok");
  });
});

describe("禁忌の薬はサーバーでも選べない（CLAUDE.md 絶対に守るルール4）", () => {
  it("K01：ぜんそくを起こしたことがある人に、C を販売する薬として選べず、記録も変わらない", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["C"], { asthmaHistory: "yes" });
    openPharmacistReview(deps, id);
    const before = getSession(deps, id);
    assertError(() => chooseSaleDrugs(deps, id, ["C"]), "CONTRAINDICATED_NOT_SELECTABLE");
    assert.deepEqual(getSession(deps, id), before);
  });

  it("K03：ぜんそくを起こしたことがある人でも、G（問題なし）は選べる", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["G"], { asthmaHistory: "yes" });
    openPharmacistReview(deps, id);
    assert.deepEqual(pharmacistView(chooseSaleDrugs(deps, id, ["G"]), NOW).saleDrugIds, ["G"]);
  });

  it("患者さんが選んでいない薬は選べない", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["G"]);
    openPharmacistReview(deps, id);
    assertError(() => chooseSaleDrugs(deps, id, ["J"]), "INVALID_REQUEST");
  });

  it("薬剤師の確認の前には、販売する薬を選べない", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["G"]);
    assertError(() => chooseSaleDrugs(deps, id, ["G"]), "INVALID_TRANSITION");
  });
});

describe("販売手順のチェック（✓）は記録に足していく", () => {
  it("S13：D を選ぶと、禁忌の確認と相談を促す表示の2つがチェックリストに出る", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["D"]);
    openPharmacistReview(deps, id);
    const view = pharmacistView(chooseSaleDrugs(deps, id, ["D"]), NOW);
    assert.deepEqual(view.procedure?.steps.map((s) => [s.id, s.checked]), [
      ["contraindication_check", false],
      ["consultation_notice", false],
    ]);
  });

  it("✓ を付けて外すと、今の表示は外れた状態で、付けた記録と外した記録の両方が残る", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["D"]);
    openPharmacistReview(deps, id);
    chooseSaleDrugs(deps, id, ["D"]);
    assert.equal(
      pharmacistView(checkProcedureStep(deps, id, "contraindication_check", true), NOW).procedure?.steps[0]?.checked,
      true,
    );
    const view = pharmacistView(checkProcedureStep(deps, id, "contraindication_check", false), NOW);
    assert.equal(view.procedure?.steps[0]?.checked, false);
    assert.deepEqual(view.checkHistory.map((c) => c.checked), [true, false]);
  });

  it("S06：E 小箱1個・30歳では、他店での購入状況（R01）と使用目的（R04）の確認がチェックリストに出る", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["E"], { otherStorePurchase: "no", packageChoice: "small_one", purposeText: "cold" });
    openPharmacistReview(deps, id);
    const steps = pharmacistView(chooseSaleDrugs(deps, id, ["E"]), NOW).procedure?.steps.map((s) => s.id) ?? [];
    assert.ok(steps.includes("abuse_other_store_purchase"));
    assert.ok(steps.includes("abuse_purpose"));
    assert.ok(!steps.includes("abuse_reason"));
  });

  it("今の販売手順にない手順や、薬を選ぶ前のチェックは受け付けない", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["D"]);
    openPharmacistReview(deps, id);
    assertError(() => checkProcedureStep(deps, id, "contraindication_check", true), "NO_DRUG_SELECTED");
    chooseSaleDrugs(deps, id, ["D"]);
    assertError(() => checkProcedureStep(deps, id, "legal_record", true), "INVALID_REQUEST");
  });

  it("P01・P02 の備考（②③は承認の後）：「理解の確認」「法定項目の記録」には、承認の前の確認中は ✓ を付けられない（まだ起きていないことを記録しない）", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["G", "C"]);
    openPharmacistReview(deps, id);
    chooseSaleDrugs(deps, id, ["C"]);
    assertError(() => checkProcedureStep(deps, id, "understanding_check", true), "STEP_NOT_YET_AVAILABLE");
    assertError(() => checkProcedureStep(deps, id, "legal_record", true), "STEP_NOT_YET_AVAILABLE");
  });

  it("P01・P02 の備考（承認の前に必要なのは「書面の準備」だけ）：C の「書面の準備」には、確認中に ✓ を付けられる", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["C"]);
    openPharmacistReview(deps, id);
    chooseSaleDrugs(deps, id, ["C"]);
    const view = pharmacistView(checkProcedureStep(deps, id, "written_information_prepared", true), NOW);
    assert.equal(view.procedure?.steps.find((s) => s.id === "written_information_prepared")?.checked, true);
  });

  it("販売する薬を選び直すと、チェックはやり直しになる（前のチェックの記録は消さない）", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["D", "G"]);
    openPharmacistReview(deps, id);
    chooseSaleDrugs(deps, id, ["D"]);
    checkProcedureStep(deps, id, "contraindication_check", true);
    const record = chooseSaleDrugs(deps, id, ["G"]);
    assert.equal(pharmacistView(record, NOW).procedure?.steps[0]?.checked, false);
    assert.equal(record.pharmacistReviews?.[0]?.stepChecks.length, 1);
  });

  it("履歴には手順の ID だけを残し、答えの中身は入れない", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["D"]);
    openPharmacistReview(deps, id);
    chooseSaleDrugs(deps, id, ["D"]);
    const record = checkProcedureStep(deps, id, "contraindication_check", true);
    assert.deepEqual(record.events.at(-1)?.detail, ["contraindication_check", "checked"]);
  });
});

describe("戻る・販売しない", () => {
  it("「戻る」で薬の選択に戻り、もう一度開くと新しい確認として始まる（前の確認の記録は残す）", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["D"]);
    openPharmacistReview(deps, id);
    chooseSaleDrugs(deps, id, ["D"]);
    assert.equal(returnToDrugSelection(deps, id).snapshot.status, "drug_selection");
    const reopened = openPharmacistReview(deps, id);
    assert.equal(reopened.pharmacistReviews?.length, 2);
    assert.notEqual(reopened.pharmacistReviews?.[0]?.closedAt, null);
    assert.deepEqual(pharmacistView(reopened, NOW).saleDrugIds, []);
  });

  it("「販売しない」は理由がないと押せず、理由を入れると販売しないで終わる", () => {
    const deps = testDeps();
    const id = answeredProduct(deps, ["G"]);
    openPharmacistReview(deps, id);
    assertError(() => declineSale(deps, id, "  "), "INVALID_REQUEST");
    const record = declineSale(deps, id, "受診をすすめる");
    assert.equal(record.snapshot.status, "declined");
    assert.equal(pharmacistView(record, NOW).declinedReason, "受診をすすめる");
    // 履歴には理由の文を入れない
    assert.deepEqual(record.events.at(-1)?.detail, []);
    assertError(() => answer(deps, id, { alcohol: true }), "SESSION_ALREADY_ENDED");
  });
});

describe("販売手順の版を選ぶ日付", () => {
  it("日本時間の朝（UTC ではまだ前日）でも、店頭の日付を使う", () => {
    assert.equal(japanDate(new Date("2026-11-06T08:00:00+09:00")), "2026-11-06");
  });
});
