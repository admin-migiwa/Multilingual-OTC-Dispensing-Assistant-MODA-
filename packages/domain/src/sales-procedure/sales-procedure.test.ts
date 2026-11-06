import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError } from "../errors.ts";
import type { SessionSnapshot } from "../session/state.ts";
import { SALES_PROCEDURE_VERSIONS, selectProcedureVersion, type SalesProcedureVersion } from "./data.ts";
import { checkQuantitySelection, classifyPackage, type DrugSelection, type ProcedureDrugInput } from "./quantity.ts";
import {
  assertApprovalAllowed,
  assertCheckoutAllowed,
  buildRequiredProcedure,
  canApprove,
  canProceedToCheckout,
  proceedToCheckout,
  type RequiredProcedure,
} from "./procedure.ts";

// テストは docs/demo-data/sales-procedures.md（薬剤師確認済み）の ☑ の行だけから作る。
// 薬の値は docs/demo-data/drugs.md と sales-procedures.md「架空の薬への当てはめ」の表から写す。
// 11/6 の薬剤師の判断（README の決定 12・13）は、P01・P04・Q-3・Q-4 のメモに書き足してある。

const A: ProcedureDrugInput = { id: "A", categories: ["specified_requires_guidance"], efficacyClass: "緊急避妊薬" };
const B: ProcedureDrugInput = {
  id: "B",
  categories: ["requires_guidance", "abuse_prevention"],
  efficacyClass: "かぜ薬（総合）",
  packageAmount: 12,
  maxDailyAmount: 6,
};
const C: ProcedureDrugInput = { id: "C", categories: ["first_class"], efficacyClass: "解熱鎮痛薬" };
const D: ProcedureDrugInput = { id: "D", categories: ["designated_second_class"], efficacyClass: "解熱鎮痛薬" };
const E_SMALL: ProcedureDrugInput = {
  id: "E-small",
  categories: ["designated_second_class", "abuse_prevention"],
  efficacyClass: "かぜ薬（総合）",
  packageAmount: 60,
  maxDailyAmount: 9,
};
const E_LARGE: ProcedureDrugInput = { ...E_SMALL, id: "E-large", packageAmount: 210 };
const H: ProcedureDrugInput = { id: "H", categories: ["third_class"], efficacyClass: "外用消炎鎮痛薬" };

const DEMO_DATE = "2026-11-08";
const ADULT = 30;
const MINOR = 17;

const version = selectProcedureVersion(DEMO_DATE);
const rules = version.quantityRules;

/** 第1類・要指導の手順（P01・P02） */
const FIRST_CLASS_STEPS = ["written_information_prepared", "written_information_handed", "understanding_check", "legal_record"];
/** E（指定第2類＋指定濫用防止）を小箱1個・18歳以上で選んだときの手順（P04・P05） */
const E_SMALL_ADULT_STEPS = [
  "abuse_other_store_purchase",
  "abuse_purpose",
  "abuse_written_information_prepared",
  "abuse_written_information_handed",
  "contraindication_check",
  "consultation_notice",
];

function build(selections: DrugSelection[], patientAge: number): RequiredProcedure {
  return buildRequiredProcedure({ selections, patientAge, date: DEMO_DATE });
}

function check(selections: DrugSelection[], patientAge: number) {
  return checkQuantitySelection({ selections, patientAge }, rules);
}

const ids = (procedure: RequiredProcedure): string[] => procedure.steps.map((s) => s.id);

/** 承認の前に必要な手順を、except 以外すべて済ませた状態 */
function doneBeforeApproval(procedure: RequiredProcedure, except: string[] = []): string[] {
  return procedure.steps.filter((s) => s.gate === "before_approval" && !except.includes(s.id)).map((s) => s.id);
}

/** すべての手順を、except 以外済ませた状態 */
function doneAll(procedure: RequiredProcedure, except: string[] = []): string[] {
  return procedure.steps.filter((s) => !except.includes(s.id)).map((s) => s.id);
}

function assertRuleError(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => err instanceof DomainRuleError && err.code === code);
}

describe("施行日つきの版：日付を渡すと、その日に有効な版が選ばれる", () => {
  it("デモの日（2026-11-08）には 2026-05-01 施行版が選ばれる", () => {
    assert.equal(selectProcedureVersion("2026-11-08").effectiveFrom, "2026-05-01");
  });

  it("施行日の当日から、その版が有効になる", () => {
    assert.equal(selectProcedureVersion("2026-05-01").effectiveFrom, "2026-05-01");
  });

  it("施行日より前の日には有効な版がなく、推測で進めずにエラーで止まる", () => {
    assertRuleError(() => selectProcedureVersion("2026-04-30"), "NO_PROCEDURE_VERSION");
  });

  it("日付の形が正しくなければエラーで止まる", () => {
    assertRuleError(() => selectProcedureVersion("2026/11/08"), "INVALID_DATE");
  });

  it("暦にない日付（2026-13-45・2026-02-30）はエラーで止まる", () => {
    assertRuleError(() => selectProcedureVersion("2026-13-45"), "INVALID_DATE");
    assertRuleError(() => selectProcedureVersion("2026-02-30"), "INVALID_DATE");
  });

  it("新しい版が足されたら、その施行日からは新しい版が選ばれ、前日までは古い版のまま", () => {
    const base = SALES_PROCEDURE_VERSIONS[0];
    assert.ok(base);
    const newer: SalesProcedureVersion = { ...base, effectiveFrom: "2027-04-01" };
    const versions = [base, newer];
    assert.equal(selectProcedureVersion("2027-03-31", versions).effectiveFrom, "2026-05-01");
    assert.equal(selectProcedureVersion("2027-04-01", versions).effectiveFrom, "2027-04-01");
  });
});

describe("数量基準：包装の日数（包装の量 ÷ 1日の最大量）で小容量・大容量を判定する（Q-1・Q-2・Q-5）", () => {
  it("B（12錠・1日6錠）は2日分で、小容量（かぜ薬・7日分以下）", () => {
    const result = classifyPackage(B, rules);
    assert.equal(result.days, 2);
    assert.equal(result.smallMaxDays, 7);
    assert.equal(result.size, "small");
  });

  it("E 小箱（60錠・1日9錠）は約6.7日分で、小容量（かぜ薬・7日分以下）", () => {
    const result = classifyPackage(E_SMALL, rules);
    assert.equal(Math.round(result.days * 10) / 10, 6.7);
    assert.equal(result.smallMaxDays, 7);
    assert.equal(result.size, "small");
  });

  it("E 大箱（210錠・1日9錠）は約23日分で、大容量", () => {
    const result = classifyPackage(E_LARGE, rules);
    assert.equal(Math.round(result.days), 23);
    assert.equal(result.size, "large");
  });
});

describe("S01・S02：第1類（C）は書面の準備が済むまで承認できない", () => {
  const procedure = build([{ drug: C, quantity: 1 }], ADULT);

  it("S01：C を選ぶと、手順の一覧は第1類の手順（書面の準備・書面を渡す・理解の確認・法定項目の記録）と完全に一致する", () => {
    assert.deepEqual(new Set(ids(procedure)), new Set(FIRST_CLASS_STEPS));
  });

  it("S01：C を選び、書面の準備が済んでいないと承認できない", () => {
    const completed = doneBeforeApproval(procedure, ["written_information_prepared"]);
    assert.equal(canApprove(procedure, completed), false);
    assertRuleError(() => assertApprovalAllowed(procedure, completed), "PROCEDURE_INCOMPLETE_FOR_APPROVAL");
  });

  it("S02：C を選び、書面の準備が済んでいれば承認できる", () => {
    const completed = doneBeforeApproval(procedure);
    assert.ok(completed.includes("written_information_prepared"));
    assert.equal(canApprove(procedure, completed), true);
    assert.doesNotThrow(() => assertApprovalAllowed(procedure, completed));
  });
});

describe("S03：理解の確認などは承認の条件ではなく、会計案内の前に終わっている必要がある（No.25、決定 5・13）", () => {
  const procedure = build([{ drug: C, quantity: 1 }], ADULT);
  const completed = doneAll(procedure, ["understanding_check"]);

  it("理解の確認が済んでいなくても承認はできる", () => {
    assert.equal(canApprove(procedure, completed), true);
  });

  it("S03：承認の後、理解の確認が済んでいないと会計案内に進めない", () => {
    assert.equal(canProceedToCheckout(procedure, completed), false);
    assertRuleError(() => assertCheckoutAllowed(procedure, completed), "PROCEDURE_INCOMPLETE_FOR_CHECKOUT");
  });

  it("法定項目の記録が済んでいなくても承認はできるが、会計案内には進めない（P01 メモ）", () => {
    const withoutRecord = doneAll(procedure, ["legal_record"]);
    assert.equal(canApprove(procedure, withoutRecord), true);
    assert.equal(canProceedToCheckout(procedure, withoutRecord), false);
  });

  it("書面を渡す（印刷して渡す）のは承認の後でよいが、渡していないと会計案内に進めない（P01 メモ・決定 13）", () => {
    const withoutHanding = doneAll(procedure, ["written_information_handed"]);
    assert.equal(canApprove(procedure, withoutHanding), true);
    assert.equal(canProceedToCheckout(procedure, withoutHanding), false);
  });

  it("すべての手順が済めば会計案内に進める", () => {
    assert.doesNotThrow(() => assertCheckoutAllowed(procedure, doneAll(procedure)));
  });
});

describe("S04・S05：特定要指導（A）は要指導の手順に加えて、別紙書類と薬剤師の前での服用を確認する（P03）", () => {
  const procedure = build([{ drug: A, quantity: 1 }], ADULT);

  it("S04：A を選ぶと、手順の一覧は要指導の手順＋別紙書類の確認＋薬剤師の前での服用の確認と完全に一致する", () => {
    assert.deepEqual(new Set(ids(procedure)), new Set([...FIRST_CLASS_STEPS, "separate_document_check", "witnessed_dosing"]));
  });

  it("S04：A を選び、別紙書類の確認が済んでいないと承認できない", () => {
    const completed = doneBeforeApproval(procedure, ["separate_document_check"]);
    assert.equal(canApprove(procedure, completed), false);
    assertRuleError(() => assertApprovalAllowed(procedure, completed), "PROCEDURE_INCOMPLETE_FOR_APPROVAL");
  });

  it("S05：A を選び、薬剤師の前での服用の確認が済んでいなくても承認はできる", () => {
    const completed = doneAll(procedure, ["witnessed_dosing"]);
    assert.equal(canApprove(procedure, completed), true);
  });

  it("S05：A を選び、薬剤師の前での服用の確認が済んでいないと会計案内に進めない", () => {
    const completed = doneAll(procedure, ["witnessed_dosing"]);
    assert.equal(canProceedToCheckout(procedure, completed), false);
    assertRuleError(() => assertCheckoutAllowed(procedure, completed), "PROCEDURE_INCOMPLETE_FOR_CHECKOUT");
  });
});

describe("会計案内へ進む関所（S03・S05）：手順がすべて済むまで服薬指導から会計案内に進めない", () => {
  const procedure = build([{ drug: A, quantity: 1 }], ADULT);
  const counseling: SessionSnapshot = { status: "counseling", understandingConfirmed: true };

  it("S05：薬剤師の前での服用の確認が済んでいないと、服薬指導から会計案内に進めない", () => {
    assertRuleError(
      () => proceedToCheckout(counseling, procedure, doneAll(procedure, ["witnessed_dosing"])),
      "PROCEDURE_INCOMPLETE_FOR_CHECKOUT",
    );
  });

  it("S03：理解の確認が手順として済んでいないと、服薬指導から会計案内に進めない", () => {
    assertRuleError(
      () => proceedToCheckout(counseling, procedure, doneAll(procedure, ["understanding_check"])),
      "PROCEDURE_INCOMPLETE_FOR_CHECKOUT",
    );
  });

  it("S03：手順が済んでいても、状態の側で理解の確認が済んでいなければ会計案内に進めない", () => {
    assertRuleError(
      () => proceedToCheckout({ status: "counseling", understandingConfirmed: false }, procedure, doneAll(procedure)),
      "UNDERSTANDING_NOT_CONFIRMED",
    );
  });

  it("承認の直後（服薬指導の前）からは、手順が済んでいても会計案内に進めない", () => {
    assertRuleError(
      () => proceedToCheckout({ status: "approved", understandingConfirmed: true }, procedure, doneAll(procedure)),
      "INVALID_TRANSITION",
    );
  });

  it("すべての手順が済めば、服薬指導から会計案内に進める", () => {
    assert.equal(proceedToCheckout(counseling, procedure, doneAll(procedure)).status, "checkout");
  });
});

describe("S06〜S08：指定濫用防止（E）の確認項目（18歳以上）", () => {
  it("S06：E 小箱を1個・30歳なら、手順の一覧は R01・R04・濫用の危険の書面・禁忌の確認・相談を促す表示と完全に一致する", () => {
    const procedure = build([{ drug: E_SMALL, quantity: 1 }], ADULT);
    assert.deepEqual(new Set(ids(procedure)), new Set(E_SMALL_ADULT_STEPS));
  });

  it("S06：E 小箱を1個・30歳で、R01・R04 を含む確認項目が済めば承認できる", () => {
    const procedure = build([{ drug: E_SMALL, quantity: 1 }], ADULT);
    assert.doesNotThrow(() => assertApprovalAllowed(procedure, doneBeforeApproval(procedure)));
  });

  it("S06：E 小箱を1個・30歳で、他店での購入状況（R01）の確認が済んでいないと承認できない", () => {
    const procedure = build([{ drug: E_SMALL, quantity: 1 }], ADULT);
    assert.equal(canApprove(procedure, doneBeforeApproval(procedure, ["abuse_other_store_purchase"])), false);
  });

  it("S06：E 小箱を1個・30歳で、使用目的（R04）の確認が済んでいないと承認できない", () => {
    const procedure = build([{ drug: E_SMALL, quantity: 1 }], ADULT);
    assert.equal(canApprove(procedure, doneBeforeApproval(procedure, ["abuse_purpose"])), false);
  });

  it("濫用の危険についての書面は、準備が済むまで承認できず、渡すまで会計案内に進めない（P04 メモ・決定 13）", () => {
    const procedure = build([{ drug: E_SMALL, quantity: 1 }], ADULT);
    assert.equal(canApprove(procedure, doneBeforeApproval(procedure, ["abuse_written_information_prepared"])), false);
    const withoutHanding = doneAll(procedure, ["abuse_written_information_handed"]);
    assert.equal(canApprove(procedure, withoutHanding), true);
    assert.equal(canProceedToCheckout(procedure, withoutHanding), false);
  });

  const reasonCases: [string, DrugSelection[]][] = [
    ["S07：E 大箱を1個・30歳", [{ drug: E_LARGE, quantity: 1 }]],
    ["S08：E 小箱を3個・30歳", [{ drug: E_SMALL, quantity: 3 }]],
    ["Q-4（決定 12）：E 小箱を1個ずつ2件に分けて・30歳", [{ drug: E_SMALL, quantity: 1 }, { drug: E_SMALL, quantity: 1 }]],
    ["Q-4（決定 12）：B と E 小箱を1個ずつ・30歳", [{ drug: B, quantity: 1 }, { drug: E_SMALL, quantity: 1 }]],
  ];
  for (const [name, selections] of reasonCases) {
    it(`${name}は、薬の選択の時点では選べて、理由（R03）の確認と記録が必要になる`, () => {
      const result = check(selections, ADULT);
      assert.equal(result.allowed, true);
      assert.equal(result.requiresReason, true);
      assert.ok(ids(build(selections, ADULT)).includes("abuse_reason"));
    });

    it(`${name}で、理由（R03）の確認と記録が済んでいないと承認できない`, () => {
      const procedure = build(selections, ADULT);
      assert.equal(canApprove(procedure, doneBeforeApproval(procedure, ["abuse_reason"])), false);
    });

    it(`${name}で、理由（R03）の確認と記録が済めば承認できる`, () => {
      const procedure = build(selections, ADULT);
      assert.doesNotThrow(() => assertApprovalAllowed(procedure, doneBeforeApproval(procedure)));
    });
  }
});

describe("S09〜S11：18歳未満は大容量・複数個を薬の選択の時点で選べない（Q-3、決定 7・12）", () => {
  it("S09：E 大箱を1個・17歳は、薬の選択の時点で選べず、大容量の注意文を出す", () => {
    const result = check([{ drug: E_LARGE, quantity: 1 }], MINOR);
    assert.equal(result.allowed, false);
    assert.deepEqual(result.largePackageDrugIds, ["E-large"]);
    assert.equal(result.notice, "minor_large_package");
    assert.equal(rules.noticeTextJa.minor_large_package, "18歳未満の方には大容量の包装を販売できません");
  });

  it("S09：E 大箱・17歳の組み合わせが承認の処理に届いても、サーバー側でエラーで止める", () => {
    assertRuleError(() => build([{ drug: E_LARGE, quantity: 1 }], MINOR), "QUANTITY_NOT_ALLOWED");
  });

  it("S10：E 小箱を2個・17歳は、薬の選択の時点で2個目を選べず、1個までの注意文を出す", () => {
    const result = check([{ drug: E_SMALL, quantity: 2 }], MINOR);
    assert.equal(result.allowed, false);
    assert.equal(result.maxAbusePreventionTotal, 1);
    assert.equal(result.notice, "minor_multiple_packages");
    assert.equal(rules.noticeTextJa.minor_multiple_packages, "18歳未満の方には1個まで販売できます");
  });

  it("S10：E 小箱2個・17歳の組み合わせが承認の処理に届いても、サーバー側でエラーで止める", () => {
    assertRuleError(() => build([{ drug: E_SMALL, quantity: 2 }], MINOR), "QUANTITY_NOT_ALLOWED");
  });

  const splitCases: [string, DrugSelection[]][] = [
    ["E 小箱を1個ずつ2件に分けて・17歳", [{ drug: E_SMALL, quantity: 1 }, { drug: E_SMALL, quantity: 1 }]],
    ["B と E 小箱を1個ずつ・17歳", [{ drug: B, quantity: 1 }, { drug: E_SMALL, quantity: 1 }]],
  ];
  for (const [name, selections] of splitCases) {
    it(`Q-3（決定 12）：${name}は、合わせて2個なので選べず、1個までの注意文を出す`, () => {
      const result = check(selections, MINOR);
      assert.equal(result.allowed, false);
      assert.equal(result.abusePreventionTotal, 2);
      assert.equal(result.notice, "minor_multiple_packages");
    });

    it(`Q-3（決定 12）：${name}の組み合わせが承認の処理に届いても、サーバー側でエラーで止める`, () => {
      assertRuleError(() => build(selections, MINOR), "QUANTITY_NOT_ALLOWED");
    });
  }

  it("S11：E 小箱を1個・17歳は選べて、手順の一覧は S06 の手順＋別紙での氏名確認と完全に一致する", () => {
    assert.equal(check([{ drug: E_SMALL, quantity: 1 }], MINOR).allowed, true);
    const procedure = build([{ drug: E_SMALL, quantity: 1 }], MINOR);
    assert.deepEqual(new Set(ids(procedure)), new Set([...E_SMALL_ADULT_STEPS, "minor_name_sheet"]));
  });

  it("S11：E 小箱1個・17歳で、別紙の氏名確認と別紙番号の入力が済んでいないと承認できない", () => {
    const procedure = build([{ drug: E_SMALL, quantity: 1 }], MINOR);
    assert.equal(canApprove(procedure, doneBeforeApproval(procedure, ["minor_name_sheet"])), false);
  });

  it("S11：E 小箱1個・17歳で、別紙の氏名確認と別紙番号の入力が済めば承認できる", () => {
    const procedure = build([{ drug: E_SMALL, quantity: 1 }], MINOR);
    assert.doesNotThrow(() => assertApprovalAllowed(procedure, doneBeforeApproval(procedure)));
  });
});

describe("S12・S13：区分の組み合わせから手順の一覧を作る", () => {
  it("S12：C（第1類）と H（第3類）を一緒に選ぶと、第1類の手順と第3類の手順を合わせた一覧になる", () => {
    const procedure = build(
      [
        { drug: C, quantity: 1 },
        { drug: H, quantity: 1 },
      ],
      ADULT,
    );
    assert.deepEqual(new Set(ids(procedure)), new Set([...FIRST_CLASS_STEPS, "contraindication_check"]));
    assert.deepEqual(new Set(procedure.steps.flatMap((s) => s.ruleIds)), new Set(["P02", "P07"]));
  });

  it("S13：D（指定第2類）を選ぶと、禁忌の確認と相談を促す表示が出る", () => {
    const procedure = build([{ drug: D, quantity: 1 }], ADULT);
    assert.deepEqual(new Set(ids(procedure)), new Set(["contraindication_check", "consultation_notice"]));
  });
});
