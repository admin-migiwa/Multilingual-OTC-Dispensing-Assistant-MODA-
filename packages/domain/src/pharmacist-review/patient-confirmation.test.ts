/**
 * 患者さんの薬の確認と個数のテスト。
 * - 個数：docs/demo-data/sales-procedures.md Q-6（☑ 11/8）と interview-items.md R02（☑）
 * - 承認の前の確かめ：11/8 依頼主（薬剤師）の判断（OK と個数がそろうまで承認しない。薬が変わったら前の OK は効かない。
 *   一部だけ売るときも確認をやり直す）
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError } from "../errors.ts";
import { selectProcedureVersion } from "../sales-procedure/data.ts";
import {
  assertPatientConfirmed,
  checkConfirmQuantities,
  currentPatientOk,
  quantityModeOf,
  type PatientDrugConfirmation,
} from "./patient-confirmation.ts";
import { saleSelectionsFor } from "./review.ts";

const rules = selectProcedureVersion("2026-11-08").quantityRules;

function ok(drugIds: PatientDrugConfirmation["drugIds"], quantities: PatientDrugConfirmation["quantities"], packageAnswer: PatientDrugConfirmation["packageAnswer"] = null): PatientDrugConfirmation {
  return { at: "2026-11-08T01:00:00.000Z", drugIds, choice: "ok", quantities, packageAnswer };
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof DomainRuleError) return error.code;
    throw error;
  }
  return undefined;
}

describe("個数の決め方（Q-6・R02）", () => {
  it("指定濫用防止医薬品でない薬（C）は個数を選ぶ、E は R02 の包装で選ぶ、A と B は1個に決まっている", () => {
    assert.equal(quantityModeOf("C", rules), "count");
    assert.equal(quantityModeOf("J", rules), "count");
    assert.equal(quantityModeOf("E", rules), "package");
    assert.equal(quantityModeOf("B", rules), "fixed");
    assert.equal(quantityModeOf("A", rules), "fixed");
    assert.deepEqual(rules.singleQuantityDrugIds, ["A"]);
  });

  it("ふつうの薬は1〜3個を選べる（上限は版のデータの値）", () => {
    assert.equal(rules.maxQuantityPerDrug, 3);
    for (const n of [1, 2, 3]) assert.deepEqual(checkConfirmQuantities(["C"], { C: n }, rules), { C: n });
  });

  it("ふつうの薬の0個・4個・小数・個数なしは受け取らない", () => {
    for (const q of [{ C: 0 }, { C: 4 }, { C: 1.5 }, {}]) {
      assert.equal(code(() => checkConfirmQuantities(["C"], q, rules)), "INVALID_QUANTITY");
    }
  });

  it("A と B は1個になり、2個は受け取らない", () => {
    assert.deepEqual(checkConfirmQuantities(["A"], {}, rules), { A: 1 });
    assert.deepEqual(checkConfirmQuantities(["B"], { B: 1 }, rules), { B: 1 });
    assert.equal(code(() => checkConfirmQuantities(["B"], { B: 2 }, rules)), "INVALID_QUANTITY");
  });

  it("E の個数はこの欄では受け取らない（R02 で選ぶ）。選んでいない薬の個数も受け取らない", () => {
    assert.deepEqual(checkConfirmQuantities(["E"], {}, rules), {});
    assert.equal(code(() => checkConfirmQuantities(["E"], { E: 2 }, rules)), "INVALID_QUANTITY");
    assert.equal(code(() => checkConfirmQuantities(["C"], { C: 1, D: 1 }, rules)), "INVALID_QUANTITY");
  });

  it("販売手順に渡す一覧に、確認で選んだ個数が入る", () => {
    const [selection] = saleSelectionsFor(["C"], {}, { C: 3 });
    assert.equal(selection?.quantity, 3);
  });
});

describe("承認の前の患者さんの確認", () => {
  it("確認がなければ承認できない", () => {
    assert.equal(code(() => assertPatientConfirmed([], ["C"], ["C"], {}, rules)), "PATIENT_NOT_CONFIRMED");
  });

  it("同じ薬で OK と個数があれば承認できる", () => {
    const confirmed = assertPatientConfirmed([ok(["C"], { C: 2 })], ["C"], ["C"], {}, rules);
    assert.deepEqual(confirmed.quantities, { C: 2 });
  });

  it("薬が変わったら、前の OK では承認できない", () => {
    assert.equal(code(() => assertPatientConfirmed([ok(["C"], { C: 1 })], ["D"], ["D"], {}, rules)), "PATIENT_NOT_CONFIRMED");
  });

  it("2つの薬で OK したあと、一部だけ売るときは確認をやり直す", () => {
    const list = [ok(["A", "J"], { A: 1, J: 1 })];
    assert.equal(code(() => assertPatientConfirmed(list, ["J"], ["A", "J"], {}, rules)), "PATIENT_NOT_CONFIRMED");
  });

  it("最後が「選びなおす」なら、その前の OK では承認できない。「相談したい」は OK を消さない", () => {
    const base = ok(["C"], { C: 1 });
    const reselect: PatientDrugConfirmation = { ...base, choice: "reselect", quantities: {} };
    const consult: PatientDrugConfirmation = { ...base, choice: "consult", quantities: {} };
    assert.equal(code(() => assertPatientConfirmed([base, reselect], ["C"], ["C"], {}, rules)), "PATIENT_NOT_CONFIRMED");
    assert.ok(currentPatientOk([base, consult], ["C"], {}, rules));
  });

  it("E は、OK のときの R02 の答えと今の答えが違えば承認できない", () => {
    const list = [ok(["E"], {}, { packageChoice: "small_one" })];
    assert.ok(currentPatientOk(list, ["E"], { packageChoice: "small_one" }, rules));
    assert.equal(currentPatientOk(list, ["E"], {}, rules), null);
    assert.equal(currentPatientOk(list, ["E"], { packageChoice: "large_one" }, rules), null);
  });

  it("上限を超える個数の OK は、今の版では有効にしない", () => {
    assert.equal(currentPatientOk([ok(["C"], { C: 4 })], ["C"], {}, rules), null);
  });
});
