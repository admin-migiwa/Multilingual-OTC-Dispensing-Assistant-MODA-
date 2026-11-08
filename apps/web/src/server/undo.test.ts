import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError, type InterviewAnswers, type StockedDrugId } from "@moda/domain";

import { mockAiClient } from "./ai/mock.ts";
import { approveSale, cancelApproval, listSaleRecords } from "./approval.ts";
import {
  answerUnderstanding,
  backToCounseling,
  checkPostApprovalStep,
  completedStepsAfterApproval,
  createGuidance,
  printGuidance,
  proceedCheckout,
  resetUnderstanding,
  startCounseling,
} from "./guidance.ts";
import {
  cancelDecline,
  checkProcedureStep,
  chooseSaleDrugs,
  declineSale,
  openPharmacistReview,
  pharmacistView,
} from "./pharmacist-service.ts";
import { createPinVerifier } from "./pin.ts";
import { confirmOk } from "./confirm.test-helper.ts";
import { answer, chooseDrugs, chooseRoute, createSession, getSession, patientView, type ServiceDeps, type SessionRecord } from "./session-service.ts";

// 工程を戻す（11/7 依頼主の判断）の仕組みのテスト。CLAUDE.md の絶対に守るルール1（承認の前に販売の手続きに進めない）・
// ルール6（販売記録は上書きしない）を守ったまま戻せることを確かめる（薬剤師が確認した表の行ではない）。
// 販売手順は docs/demo-data/sales-procedures.md の ☑ の行（P02・S03）と同じ C の手順を使う。

const PINS = createPinVerifier("P1:1234");
const ai = mockAiClient();

/** 呼ぶたびに1秒進む時計（承認・取り消しの前後を時刻で分けるため） */
function testDeps(): ServiceDeps {
  const map = new Map<string, SessionRecord>();
  let n = 0;
  let t = new Date("2026-11-08T10:00:00+09:00").getTime();
  return {
    store: { get: (id) => map.get(id), set: (r) => void map.set(r.id, r), all: () => map.values() },
    now: () => new Date((t += 1000)),
    newId: () => `s${(n += 1)}`,
  };
}

function assertError(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => err instanceof DomainRuleError && err.code === code);
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

function reviewed(deps: ServiceDeps, drug: StockedDrugId): string {
  const { id } = createSession(deps, "en");
  answer(deps, id, { age: 30, sex: "female" });
  chooseRoute(deps, id, "product");
  chooseDrugs(deps, id, [drug]);
  confirmOk(deps, id, fine);
  answer(deps, id, fine);
  openPharmacistReview(deps, id);
  chooseSaleDrugs(deps, id, [drug]);
  checkProcedureStep(deps, id, "written_information_prepared", true);
  return id;
}

const approve = (deps: ServiceDeps, id: string) => approveSale(deps, PINS, id, { pharmacistId: "P1", pin: "1234" });

/** C を承認し、説明書を作って服薬指導を始め、書面の ✓ と理解の確認まで済ませる */
async function counseled(deps: ServiceDeps): Promise<string> {
  const id = reviewed(deps, "C");
  approve(deps, id);
  await createGuidance(deps, ai, id);
  startCounseling(deps, id);
  checkPostApprovalStep(deps, id, "written_information_handed", true);
  checkPostApprovalStep(deps, id, "legal_record", true);
  answerUnderstanding(deps, id, "understood");
  return id;
}

describe("承認を取り消す（11/7 依頼主の判断）", () => {
  it("服薬指導の途中で承認を取り消すと、薬剤師の確認に戻り、販売記録には「取り消し」の版が足される（前の版は変わらない）", async () => {
    const deps = testDeps();
    const id = await counseled(deps);
    const before = getSession(deps, id).saleRecord;
    const after = cancelApproval(deps, id);
    assert.equal(after.snapshot.status, "pharmacist_review");
    assert.equal(after.snapshot.understandingConfirmed, false);
    assert.equal(after.saleRecord?.id, before?.id);
    assert.deepEqual(after.saleRecord?.versions.slice(0, -1), before?.versions);
    assert.equal(after.saleRecord?.versions.at(-1)?.reason, "approval_cancelled");
    assert.ok(after.events.some((e) => e.type === "approval_cancelled"));
  });

  it("取り消したあとは、もう一度承認するまで印刷・服薬指導・会計案内に進めない（ルール1）", async () => {
    const deps = testDeps();
    const id = await counseled(deps);
    cancelApproval(deps, id);
    assertError(() => printGuidance(deps, id), "NOT_APPROVED");
    assertError(() => startCounseling(deps, id), "NOT_APPROVED");
    assertError(() => proceedCheckout(deps, id), "NOT_APPROVED");
    assertError(() => cancelApproval(deps, id), "INVALID_TRANSITION");
    // 薬剤師の画面には、承認のあとの欄を出さない
    assert.equal(pharmacistView(getSession(deps, id), new Date()).afterApproval, null);
  });

  it("もう一度承認すると、同じ販売記録に「もう一度の承認」の版を足す。前の承認・取り消しの版は残り、記録の一覧は1件のまま", async () => {
    const deps = testDeps();
    const id = await counseled(deps);
    const cancelled = cancelApproval(deps, id).saleRecord;
    chooseSaleDrugs(deps, id, ["C"]);
    checkProcedureStep(deps, id, "written_information_prepared", true);
    const again = approve(deps, id);
    assert.equal(again.snapshot.status, "approved");
    assert.equal(again.saleRecord?.id, cancelled?.id);
    assert.deepEqual(again.saleRecord?.versions.slice(0, -1), cancelled?.versions);
    const latest = again.saleRecord?.versions.at(-1);
    assert.equal(latest?.reason, "reapproved");
    assert.equal(latest?.understanding, "not_yet");
    assert.equal(listSaleRecords(deps.store.all()).length, 1);
  });

  it("もう一度承認したあとは、前の承認のあとの ✓ と理解の確認を使わない（やり直すまで会計案内に進めない）", async () => {
    const deps = testDeps();
    const id = await counseled(deps);
    cancelApproval(deps, id);
    chooseSaleDrugs(deps, id, ["C"]);
    checkProcedureStep(deps, id, "written_information_prepared", true);
    approve(deps, id);
    await createGuidance(deps, ai, id);
    startCounseling(deps, id);
    const done = completedStepsAfterApproval(getSession(deps, id));
    assert.ok(!done.includes("written_information_handed"));
    assert.ok(!done.includes("understanding_check"));
    assertError(() => proceedCheckout(deps, id), "PROCEDURE_INCOMPLETE_FOR_CHECKOUT");
  });

  it("取り消す前に印刷していても、もう一度承認して作った説明書は「印刷済み」にならない", async () => {
    const deps = testDeps();
    const id = await counseled(deps);
    printGuidance(deps, id);
    cancelApproval(deps, id);
    chooseSaleDrugs(deps, id, ["C"]);
    checkProcedureStep(deps, id, "written_information_prepared", true);
    approve(deps, id);
    await createGuidance(deps, ai, id);
    startCounseling(deps, id);
    const record = getSession(deps, id);
    assert.equal(patientView(record).guidance?.printed, false);
    assert.equal(pharmacistView(record, new Date()).afterApproval?.printed, false);
    printGuidance(deps, id);
    assert.equal(patientView(getSession(deps, id)).guidance?.printed, true);
  });
});

describe("理解の確認をやり直す・会計案内から説明に戻る（11/7 依頼主の判断）", () => {
  it("理解の確認をやり直すと、販売記録に「やり直し」の版を足し、会計案内に進めなくなる。もう一度「わかった」で進める", async () => {
    const deps = testDeps();
    const id = await counseled(deps);
    const versions = getSession(deps, id).saleRecord?.versions.length ?? 0;
    const reset = resetUnderstanding(deps, id);
    assert.equal(reset.snapshot.understandingConfirmed, false);
    assert.equal(reset.saleRecord?.versions.length, versions + 1);
    assert.equal(reset.saleRecord?.versions.at(-1)?.reason, "understanding_reset");
    assert.equal(patientView(reset).understandingConfirmed, false);
    assertError(() => proceedCheckout(deps, id), "PROCEDURE_INCOMPLETE_FOR_CHECKOUT");
    answerUnderstanding(deps, id, "understood");
    assert.equal(proceedCheckout(deps, id).snapshot.status, "checkout");
  });

  it("会計案内から説明に戻ると服薬指導の状態になり、販売記録は変わらない。もう一度会計案内に進める", async () => {
    const deps = testDeps();
    const id = await counseled(deps);
    proceedCheckout(deps, id);
    const before = getSession(deps, id).saleRecord;
    const back = backToCounseling(deps, id);
    assert.equal(back.snapshot.status, "counseling");
    assert.deepEqual(back.saleRecord, before);
    assert.equal(proceedCheckout(deps, id).snapshot.status, "checkout");
  });
});

describe("「販売しない」を取り消す（11/7 依頼主の判断）", () => {
  it("取り消すと薬剤師の確認に戻り、前の確認（販売しない理由）は閉じたまま残る。そのまま承認できる", () => {
    const deps = testDeps();
    const id = reviewed(deps, "C");
    declineSale(deps, id, "押し間違い");
    const back = cancelDecline(deps, id);
    assert.equal(back.snapshot.status, "pharmacist_review");
    const rounds = back.pharmacistReviews ?? [];
    assert.equal(rounds.length, 2);
    assert.equal(rounds[0]?.declinedReason, "押し間違い");
    assert.equal(rounds[1]?.closedAt, null);
    chooseSaleDrugs(deps, id, ["C"]);
    checkProcedureStep(deps, id, "written_information_prepared", true);
    assert.equal(approve(deps, id).snapshot.status, "approved");
  });
});
