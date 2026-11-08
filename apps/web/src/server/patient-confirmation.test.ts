import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError, type InterviewAnswers, type StockedDrugId } from "@moda/domain";

import { approveSale, cancelApproval } from "./approval.ts";
import { confirmDrugChoice } from "./patient-confirmation.ts";
import {
  checkProcedureStep,
  chooseCandidateDrugs,
  chooseSaleDrugs,
  openPharmacistReview,
  pharmacistView,
} from "./pharmacist-service.ts";
import { createPinVerifier } from "./pin.ts";
import {
  SessionServiceError,
  answer,
  chooseDrugs,
  chooseRoute,
  createSession,
  getSession,
  patientView,
  type ServiceDeps,
  type SessionRecord,
} from "./session-service.ts";
import { confirmOk } from "./confirm.test-helper.ts";

// 患者さんの薬の確認と個数（11/8 依頼主＝薬剤師の判断）。個数は sales-procedures.md Q-6（☑）、
// 販売手順は S02（C は書面の準備）、禁忌のない答えは contraindication-tests.md の決まりどおり「問題のない答え」。

const NOW = new Date("2026-11-08T10:00:00+09:00");
const PINS = createPinVerifier("P1:1234");

function testDeps(): ServiceDeps {
  const map = new Map<string, SessionRecord>();
  let n = 0;
  return {
    store: { get: (id) => map.get(id), set: (r) => void map.set(r.id, r), all: () => map.values() },
    now: () => NOW,
    newId: () => `s${(n += 1)}`,
  };
}

function assertError(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => (err instanceof DomainRuleError || err instanceof SessionServiceError) && err.code === code);
}

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

/** 「ほしい薬がある」で薬を選ぶ（患者さんの確認の手前） */
function chosen(deps: ServiceDeps, drugs: StockedDrugId[]): string {
  const { id } = createSession(deps, "en");
  answer(deps, id, { age: 30, sex: "female" });
  chooseRoute(deps, id, "product");
  chooseDrugs(deps, id, drugs);
  return id;
}

const approve = (deps: ServiceDeps, id: string) => approveSale(deps, PINS, id, { pharmacistId: "P1", pin: "1234" });

describe("患者さんの薬の確認（11/8 依頼主の判断）", () => {
  it("薬を選ぶと、患者さんが確かめるまで質問を出さず、答えも受け取らず、薬剤師の確認も開けない", () => {
    const deps = testDeps();
    const id = chosen(deps, ["C"]);
    const view = patientView(getSession(deps, id), NOW);
    assert.equal(view.nextQuestion, null);
    assert.deepEqual(view.drugConfirmation, {
      drugs: [{ drugId: "C", name: view.drugConfirmation?.drugs[0]?.name, mode: "count", contraindicated: false }],
      maxQuantity: 3,
    });
    const before = getSession(deps, id);
    assertError(() => answer(deps, id, fine), "PATIENT_NOT_CONFIRMED");
    assert.equal(getSession(deps, id), before);
  });

  it("Q-6：ふつうの薬は1〜3個を選べ、4個は受け取らない。OK すると質問に進む", () => {
    const deps = testDeps();
    const id = chosen(deps, ["C"]);
    assertError(() => confirmDrugChoice(deps, id, { choice: "ok", quantities: { C: 4 } }), "INVALID_QUANTITY");
    assertError(() => confirmDrugChoice(deps, id, { choice: "ok", quantities: {} }), "INVALID_QUANTITY");
    const record = confirmDrugChoice(deps, id, { choice: "ok", quantities: { C: 3 } });
    assert.equal(patientView(record, NOW).drugConfirmation, null);
    assert.notEqual(patientView(record, NOW).nextQuestion, null);
  });

  it("OK と個数は、販売記録の品目の個数になる（承認と同じ書き込み）", () => {
    const deps = testDeps();
    const id = chosen(deps, ["C"]);
    confirmOk(deps, id, {}, { C: 2 });
    answer(deps, id, fine);
    openPharmacistReview(deps, id);
    chooseSaleDrugs(deps, id, ["C"]);
    checkProcedureStep(deps, id, "written_information_prepared", true);
    const record = approve(deps, id);
    assert.deepEqual(record.saleRecord?.versions[0]?.items.map((i) => [i.drugId, i.quantity]), [["C", 2]]);
  });

  it("2つの薬で OK したあと、薬剤師が1つだけを販売する薬に選ぶと承認できない（確認のやり直しが要る）", () => {
    const deps = testDeps();
    const id = chosen(deps, ["C", "G"]);
    confirmOk(deps, id);
    answer(deps, id, fine);
    openPharmacistReview(deps, id);
    chooseSaleDrugs(deps, id, ["C"]);
    checkProcedureStep(deps, id, "written_information_prepared", true);
    const before = getSession(deps, id);
    assertError(() => approve(deps, id), "PATIENT_NOT_CONFIRMED");
    assert.equal(getSession(deps, id), before);
    assert.equal(getSession(deps, id).saleRecord, undefined);
  });

  it("薬剤師が候補から別の薬に選び直すと、前の OK は効かず、患者さんがもう一度確かめる", () => {
    const deps = testDeps();
    const id = chosen(deps, ["C"]);
    confirmOk(deps, id);
    answer(deps, id, fine);
    openPharmacistReview(deps, id);
    // I は C と同じ項目（飲酒）で判定できるので、問診に戻らずに薬の選択になる
    const record = chooseCandidateDrugs(deps, id, ["I"]);
    assert.equal(record.snapshot.status, "drug_selection");
    assert.notEqual(patientView(record, NOW).drugConfirmation, null);
    assertError(() => openPharmacistReview(deps, id), "PATIENT_NOT_CONFIRMED");
    assert.equal(pharmacistView(getSession(deps, id), NOW).patientOk, null);
  });

  it("「相談したい」は記録に足すだけで、状態も選んだ薬も変えない", () => {
    const deps = testDeps();
    const id = chosen(deps, ["C"]);
    const before = getSession(deps, id);
    const record = confirmDrugChoice(deps, id, { choice: "consult" });
    assert.equal(record.snapshot.status, before.snapshot.status);
    assert.deepEqual(record.interview.selectedDrugs, ["C"]);
    assert.equal(record.drugConfirmations?.at(-1)?.choice, "consult");
    assert.notEqual(patientView(record, NOW).drugConfirmation, null);
  });

  it("「ほしい薬がある」で「薬を選びなおす」と、選んだ薬を外して患者さんの薬の選択に戻る", () => {
    const deps = testDeps();
    const id = chosen(deps, ["C"]);
    const record = confirmDrugChoice(deps, id, { choice: "reselect" });
    assert.equal(record.snapshot.status, "drug_selection");
    assert.deepEqual(record.interview.selectedDrugs, []);
    assert.equal(patientView(record, NOW).drugConfirmation, null);
    assert.deepEqual(record.drugConfirmations?.map((c) => c.choice), ["reselect"]);
  });

  it("「症状から探す」で「薬を選びなおす」と、薬剤師の確認を開いて薬剤師が選び直す", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    answer(deps, id, { age: 30, sex: "female" });
    chooseRoute(deps, id, "symptom", "headache");
    answer(deps, id, fine);
    openPharmacistReview(deps, id);
    chooseCandidateDrugs(deps, id, ["G"]);
    const record = confirmDrugChoice(deps, id, { choice: "reselect" });
    assert.equal(record.snapshot.status, "pharmacist_review");
    assert.deepEqual(record.interview.selectedDrugs, []);
    assert.equal(record.pharmacistReviews?.at(-1)?.closedAt, null);
  });

  it("承認を取り消したあとも、同じ薬なら OK のままで、もう一度承認できる", () => {
    const deps = testDeps();
    const id = chosen(deps, ["C"]);
    confirmOk(deps, id, {}, { C: 2 });
    answer(deps, id, fine);
    openPharmacistReview(deps, id);
    chooseSaleDrugs(deps, id, ["C"]);
    checkProcedureStep(deps, id, "written_information_prepared", true);
    approve(deps, id);
    cancelApproval(deps, id);
    chooseSaleDrugs(deps, id, ["C"]);
    checkProcedureStep(deps, id, "written_information_prepared", true);
    const record = approve(deps, id);
    assert.deepEqual(record.saleRecord?.versions.at(-1)?.items.map((i) => [i.drugId, i.quantity]), [["C", 2]]);
  });

  it("確認の画面以外の状態（薬剤師の確認中）では、薬の確認を受け付けない", () => {
    const deps = testDeps();
    const id = chosen(deps, ["C"]);
    confirmOk(deps, id);
    answer(deps, id, fine);
    openPharmacistReview(deps, id);
    assertError(() => confirmDrugChoice(deps, id, { choice: "ok", quantities: { C: 1 } }), "INVALID_TRANSITION");
  });

  it("履歴には、選んだもの・薬の記号・個数だけを残す", () => {
    const deps = testDeps();
    const id = chosen(deps, ["C"]);
    const record = confirmOk(deps, id, {}, { C: 2 });
    assert.deepEqual(record.events.find((e) => e.type === "patient_drug_confirmed")?.detail, ["ok", "C:2"]);
  });

  it("E は、確認の画面で選んだ包装が問診 R02 の答えになり、R02 をもう一度聞かない", () => {
    const deps = testDeps();
    const id = chosen(deps, ["E"]);
    const record = confirmDrugChoice(deps, id, { choice: "ok", quantities: {}, packageChoice: "small_one" });
    assert.equal(record.interview.answers.packageChoice, "small_one");
    answer(deps, id, { ...fine, otherStorePurchase: "no", purposeText: "cold" });
    const view = patientView(getSession(deps, id), NOW);
    assert.equal(view.status, "drug_selection");
    assert.equal(view.interviewComplete, true);
  });
});
