/**
 * R02 の時点で18歳未満の大容量・複数個を選べなくする（backlog M-12）のテスト。
 * docs/demo-data/sales-procedures.md の ☑ の行（S06・S07・S08・S09・S10・S11）と、「架空の薬への当てはめ」（E の小箱・大箱 ☑）から作る。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { selectProcedureVersion } from "../sales-procedure/data.ts";
import { checkPackageAnswer, packageChoiceOptions } from "./package-options.ts";

const rules = selectProcedureVersion("2026-11-08").quantityRules;

describe("R02 の時点の個数・包装の制限（M-12）", () => {
  it("S09：17歳に E の大箱1個は選べず、「大容量の包装を販売できません」の注意文を出す", () => {
    assert.deepEqual(checkPackageAnswer(["E"], { packageChoice: "large_one" }, 17, rules), {
      allowed: false,
      notice: "minor_large_package",
    });
  });

  it("S10：17歳に E の小箱2個は選べず、「1個まで販売できます」の注意文を出す", () => {
    assert.deepEqual(checkPackageAnswer(["E"], { packageChoice: "multiple", multipleCount: 2 }, 17, rules), {
      allowed: false,
      notice: "minor_multiple_packages",
    });
  });

  it("S11：17歳に E の小箱1個は選べる", () => {
    assert.deepEqual(checkPackageAnswer(["E"], { packageChoice: "small_one" }, 17, rules), { allowed: true, notice: null });
  });

  it("S06・S07・S08：30歳なら小箱1個・大箱1個・小箱3個のどれも選べる", () => {
    assert.equal(checkPackageAnswer(["E"], { packageChoice: "small_one" }, 30, rules).allowed, true);
    assert.equal(checkPackageAnswer(["E"], { packageChoice: "large_one" }, 30, rules).allowed, true);
    assert.equal(checkPackageAnswer(["E"], { packageChoice: "multiple", multipleCount: 3 }, 30, rules).allowed, true);
  });

  it("S09・S10・S11：17歳の R02 では小箱1個だけを選べ、注意文を2つとも出す", () => {
    assert.deepEqual(packageChoiceOptions(["E"], 17, rules), {
      allowed: ["small_one"],
      notices: ["minor_large_package", "minor_multiple_packages"],
    });
  });

  it("S06〜S08：30歳の R02 では、どれも選べて注意文は出さない", () => {
    assert.deepEqual(packageChoiceOptions(["E"], 30, rules), { allowed: ["small_one", "large_one", "multiple"], notices: [] });
  });
});
