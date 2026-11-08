import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError, assertActionAllowed, type InterviewAnswers, type StockedDrugId } from "@moda/domain";

import { approveSale, completedStepIdsOf, listSaleRecords } from "./approval.ts";
import {
  checkProcedureStep,
  chooseSaleDrugs,
  openPharmacistReview,
  overrideContraindication,
  returnToDrugSelection,
} from "./pharmacist-service.ts";
import { PIN_MAX_FAILURES, PinError, createPinVerifier } from "./pin.ts";
import { confirmOk } from "./confirm.test-helper.ts";
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

// 販売手順は docs/demo-data/sales-procedures.md の ☑ の行（手順の表 P02・P03・P06、テスト表 S01・S02・S04・S06）、
// 禁忌は contraindication-tests.md の ☑ の行（K01）にそろえる。PIN はテスト用の値（本物の PIN ではない）。

const NOW = new Date("2026-11-08T10:00:00+09:00");
const TEST_PINS = "P1:1234,P2:5678";

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
  assert.throws(
    fn,
    (err: unknown) => (err instanceof DomainRuleError || err instanceof SessionServiceError || err instanceof PinError) && err.code === code,
  );
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
  otherStorePurchase: "no",
  packageChoice: "small_one",
  purposeText: "cold",
};

/** 「ほしい薬がある」で薬を選んで答え、薬剤師の確認を開き、販売する薬に選ぶ */
function reviewing(deps: ServiceDeps, drugs: StockedDrugId[], extra: InterviewAnswers = {}): string {
  const { id } = createSession(deps, "en");
  answer(deps, id, { age: 30, sex: "female" });
  chooseRoute(deps, id, "product");
  chooseDrugs(deps, id, drugs);
  confirmOk(deps, id, { ...fine, ...extra });
  answer(deps, id, { ...fine, ...extra });
  openPharmacistReview(deps, id);
  return id;
}

const check = (deps: ServiceDeps, id: string, steps: string[]) => {
  for (const step of steps) checkProcedureStep(deps, id, step, true);
};

describe("PIN での承認と販売記録（T9a）", () => {
  it("S01：C（第1類）で書面の準備が済んでいなければ承認できず、販売記録はできない", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["C"]);
    chooseSaleDrugs(deps, id, ["C"]);
    const before = getSession(deps, id);
    assertError(() => approveSale(deps, createPinVerifier(TEST_PINS), id, { pharmacistId: "P1", pin: "1234" }), "PROCEDURE_INCOMPLETE_FOR_APPROVAL");
    assert.equal(getSession(deps, id), before);
    assert.equal(getSession(deps, id).saleRecord, undefined);
  });

  it("S02：C で書面の準備が済めば承認でき、同じ書き込みで販売記録（版1・理解の確認は未）ができる", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["C"]);
    chooseSaleDrugs(deps, id, ["C"]);
    check(deps, id, ["written_information_prepared"]);
    const record = approveSale(deps, createPinVerifier(TEST_PINS), id, { pharmacistId: "P1", pin: "1234" });
    assert.equal(record.snapshot.status, "approved");
    const sale = record.saleRecord;
    assert.equal(sale?.versions.length, 1);
    const v1 = sale?.versions[0];
    assert.equal(v1?.pharmacist.id, "P1");
    assert.deepEqual(v1?.items.map((i) => [i.drugId, i.quantity]), [["C", 1]]);
    assert.equal(v1?.understanding, "not_yet");
    assert.deepEqual(v1?.completedStepIds, ["written_information_prepared"]);
    assert.equal(record.pharmacistReviews?.at(-1)?.saleRecordId, sale?.id);
    assert.equal(record.events.at(-1)?.type, "approved");
    assert.deepEqual(listSaleRecords(deps.store.all()).map((s) => s.id), [sale?.id]);
  });

  it("承認の前は印刷できず、承認のあとは印刷できる（spec.md T9 の受け入れ条件。CLAUDE.md ルール1）", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["C"]);
    chooseSaleDrugs(deps, id, ["C"]);
    check(deps, id, ["written_information_prepared"]);
    assertError(() => assertActionAllowed(getSession(deps, id).snapshot.status, "print"), "NOT_APPROVED");
    approveSale(deps, createPinVerifier(TEST_PINS), id, { pharmacistId: "P1", pin: "1234" });
    assert.doesNotThrow(() => assertActionAllowed(getSession(deps, id).snapshot.status, "print"));
  });

  it("S04：A（特定要指導）で別紙書類の確認が済んでいなければ承認できない", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["A"]);
    chooseSaleDrugs(deps, id, ["A"]);
    check(deps, id, ["written_information_prepared"]);
    assertError(() => approveSale(deps, createPinVerifier(TEST_PINS), id, { pharmacistId: "P1", pin: "1234" }), "PROCEDURE_INCOMPLETE_FOR_APPROVAL");
  });

  it("S06：E の小箱1個（30歳）は、R01・R04 の確認と書面の準備・禁忌の確認・相談の表示が済めば承認でき、数量は小箱1個", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["E"]);
    chooseSaleDrugs(deps, id, ["E"]);
    check(deps, id, ["abuse_other_store_purchase", "abuse_purpose", "abuse_written_information_prepared", "contraindication_check", "consultation_notice"]);
    const record = approveSale(deps, createPinVerifier(TEST_PINS), id, { pharmacistId: "P2", pin: "5678" });
    assert.deepEqual(record.saleRecord?.versions[0]?.items.map((i) => [i.drugId, i.packageAmount, i.quantity]), [["E", 60, 1]]);
  });

  it("✓ を外した手順は済んだことにしない（最後の付け外しで決める）", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["C"]);
    chooseSaleDrugs(deps, id, ["C"]);
    check(deps, id, ["written_information_prepared"]);
    checkProcedureStep(deps, id, "written_information_prepared", false);
    const round = getSession(deps, id).pharmacistReviews?.at(-1);
    assert.deepEqual(round ? completedStepIdsOf(round) : null, []);
    assertError(() => approveSale(deps, createPinVerifier(TEST_PINS), id, { pharmacistId: "P1", pin: "1234" }), "PROCEDURE_INCOMPLETE_FOR_APPROVAL");
  });

  it("販売する薬を選んでいなければ承認できない", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["G"]);
    assertError(() => approveSale(deps, createPinVerifier(TEST_PINS), id, { pharmacistId: "P1", pin: "1234" }), "NO_DRUG_SELECTED");
  });

  it("承認は1回だけ（2回目は止まり、販売記録は増えない）", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["G"]);
    chooseSaleDrugs(deps, id, ["G"]);
    check(deps, id, ["contraindication_check"]);
    approveSale(deps, createPinVerifier(TEST_PINS), id, { pharmacistId: "P1", pin: "1234" });
    assertError(() => approveSale(deps, createPinVerifier(TEST_PINS), id, { pharmacistId: "P1", pin: "1234" }), "INVALID_TRANSITION");
    assert.equal(listSaleRecords(deps.store.all()).length, 1);
  });

  it("K01：禁忌の薬は販売する薬に選べないので、承認もできない（選択がないことで止まる）", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["C"], { asthmaHistory: "yes" });
    // 販売する薬の選択（chooseSaleDrugs）は禁忌で止まるので、選択がないまま承認しようとすると、選択がないことで止まる
    assertError(() => chooseSaleDrugs(deps, id, ["C"]), "CONTRAINDICATED_NOT_SELECTABLE");
    assertError(() => approveSale(deps, createPinVerifier(TEST_PINS), id, { pharmacistId: "P1", pin: "1234" }), "NO_DRUG_SELECTED");
  });
});

describe("薬剤師の PIN", () => {
  it("PIN が違えば承認できず、記録は変わらない", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["G"]);
    chooseSaleDrugs(deps, id, ["G"]);
    check(deps, id, ["contraindication_check"]);
    const before = getSession(deps, id);
    assertError(() => approveSale(deps, createPinVerifier(TEST_PINS), id, { pharmacistId: "P1", pin: "9999" }), "PIN_INVALID");
    assert.equal(getSession(deps, id), before);
  });

  it("PIN の設定がなければ、仮の PIN で通さずに止める", () => {
    assertError(() => createPinVerifier(undefined).verify("P1", "1234", NOW), "PIN_NOT_CONFIGURED");
  });

  it(`同じ薬剤師が続けて${PIN_MAX_FAILURES}回間違えたらロックし、正しい PIN でもしばらく使えない`, () => {
    const verifier = createPinVerifier(TEST_PINS);
    for (let i = 0; i < PIN_MAX_FAILURES - 1; i += 1) assertError(() => verifier.verify("P1", "0000", NOW), "PIN_INVALID");
    assertError(() => verifier.verify("P1", "0000", NOW), "PIN_LOCKED");
    assertError(() => verifier.verify("P1", "1234", NOW), "PIN_LOCKED");
    // ほかの薬剤師はロックされない
    assert.equal(verifier.verify("P2", "5678", NOW).id, "P2");
    // 時間がたてば使える
    assert.equal(verifier.verify("P1", "1234", new Date(NOW.getTime() + 6 * 60_000)).id, "P1");
  });

  it("一覧にいる薬剤師の PIN が設定にないときは、設定の誤りとして止め、失敗の回数に数えない", () => {
    const verifier = createPinVerifier("P1:1234");
    for (let i = 0; i < PIN_MAX_FAILURES + 1; i += 1) assertError(() => verifier.verify("P2", "5678", NOW), "PIN_NOT_CONFIGURED");
  });

  it("一覧にない薬剤師は止める", () => {
    assertError(() => createPinVerifier(TEST_PINS).verify("P9", "1234", NOW), "UNKNOWN_PHARMACIST");
  });
});

// 禁忌の解除（T9b。CLAUDE.md ルール4・design.md「禁忌の判定と解除」・11/7 依頼主の判断）。
// 禁忌になる場面は contraindication-tests.md の ☑ の行（K01：ぜんそくで C、K11：解熱鎮痛薬を飲んでいて C）を使う
describe("禁忌の解除（T9b）", () => {
  const override = (deps: ServiceDeps, id: string, extra: Partial<{ pin: string; reasonCode: string; reasonText: string | null; drugId: string }> = {}) =>
    overrideContraindication(deps, createPinVerifier(TEST_PINS), id, {
      drugId: "C",
      pharmacistId: "P1",
      pin: "1234",
      reasonCode: "switching_not_combined",
      reasonText: null,
      ...extra,
    });

  it("K11：解熱鎮痛薬を飲んでいて禁忌の C も、薬剤師が「切り替えるため併用しない」で解除すれば、販売する薬に選んで承認でき、販売記録に解除の理由が残る", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["C"], { currentMedications: ["analgesic"] });
    assertError(() => chooseSaleDrugs(deps, id, ["C"]), "CONTRAINDICATED_NOT_SELECTABLE");
    const record = override(deps, id);
    assert.equal(record.events.at(-1)?.type, "contraindication_overridden");
    assert.deepEqual(record.events.at(-1)?.detail, ["C", "switching_not_combined", "P1"]);
    chooseSaleDrugs(deps, id, ["C"]);
    check(deps, id, ["written_information_prepared"]);
    const approved = approveSale(deps, createPinVerifier(TEST_PINS), id, { pharmacistId: "P2", pin: "5678" });
    const overrides = approved.saleRecord?.versions[0]?.overrides ?? [];
    assert.equal(overrides.length, 1);
    assert.equal(overrides[0]?.reasonCode, "switching_not_combined");
    assert.equal(overrides[0]?.pharmacist.id, "P1");
    assert.ok((overrides[0]?.judgedReasons.length ?? 0) > 0);
  });

  it("K01：PIN が違えば解除できず、記録は変わらない", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["C"], { asthmaHistory: "yes" });
    const before = getSession(deps, id);
    assertError(() => override(deps, id, { pin: "0000" }), "PIN_INVALID");
    assert.equal(getSession(deps, id), before);
  });

  it("K01：「その他」は理由の文がなければ解除できない", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["C"], { asthmaHistory: "yes" });
    assertError(() => override(deps, id, { reasonCode: "other", reasonText: " " }), "OVERRIDE_REASON_INVALID");
    assert.equal(override(deps, id, { reasonCode: "other", reasonText: "医師に確認した" }).pharmacistReviews?.at(-1)?.overrides?.[0]?.reasonText, "医師に確認した");
  });

  it("禁忌ではない薬は解除しない", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["G"]);
    assertError(() => override(deps, id, { drugId: "G" }), "NOT_CONTRAINDICATED");
  });

  it("K01：解除はその確認の中だけ。「戻る」で確認を閉じて開き直すと、もう一度解除しないと選べない", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["C"], { asthmaHistory: "yes" });
    override(deps, id, { reasonCode: "confirmed_not_applicable" });
    returnToDrugSelection(deps, id);
    openPharmacistReview(deps, id);
    assertError(() => chooseSaleDrugs(deps, id, ["C"]), "CONTRAINDICATED_NOT_SELECTABLE");
  });

  it("解除の自由記述は、履歴（events）に入れない", () => {
    const deps = testDeps();
    const id = reviewing(deps, ["C"], { asthmaHistory: "yes" });
    const record = override(deps, id, { reasonCode: "other", reasonText: "SECRET-NOTE" });
    assert.equal(JSON.stringify(record.events).includes("SECRET-NOTE"), false);
  });
});
