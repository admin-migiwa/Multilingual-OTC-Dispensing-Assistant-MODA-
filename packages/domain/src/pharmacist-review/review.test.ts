/**
 * 薬剤師の確認画面（T8a）のルールのテスト。表の ☑ の行だけから作る。
 * - 販売手順：docs/demo-data/sales-procedures.md（「架空の薬への当てはめ」と S 行）
 * - 禁忌の薬は選べない：docs/demo-data/contraindication-tests.md（K 行）
 * - 聞く項目：docs/demo-data/interview-items.md（Q13・Q14・Q09 の「聞く条件」）
 * 表に書いていない答えは、contraindication-tests.md の決まりどおり「問題のない答え」（30歳女性など）とする。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError } from "../errors.ts";
import type { InterviewFacts } from "../contraindication/facts.ts";
import { judgeDrugs } from "../contraindication/judge.ts";
import { selectProcedureVersion } from "../sales-procedure/data.ts";
import { buildRequiredProcedure } from "../sales-procedure/procedure.ts";
import { classifyPackage } from "../sales-procedure/quantity.ts";
import type { AbusePreventionAnswers } from "../interview/items.ts";
import { assertSaleSelectable, questionsAskedForDrug, saleSelectionsFor } from "./review.ts";

const DEMO_DATE = "2026-11-08";
const rules = selectProcedureVersion(DEMO_DATE).quantityRules;

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

function stepIds(drugIds: Parameters<typeof saleSelectionsFor>[0], abuse: AbusePreventionAnswers, age: number): string[] {
  return buildRequiredProcedure({ selections: saleSelectionsFor(drugIds, abuse), patientAge: age, date: DEMO_DATE }).steps.map(
    (s) => s.id,
  );
}

describe("架空の薬への当てはめ（包装の大きさ）", () => {
  it("B モダかぜプロ錠 12錠は小容量", () => {
    const [selection] = saleSelectionsFor(["B"], {});
    assert.ok(selection);
    assert.equal(classifyPackage(selection.drug, rules).size, "small");
  });

  it("E 小箱 60錠は小容量", () => {
    const [selection] = saleSelectionsFor(["E"], { packageChoice: "small_one" });
    assert.ok(selection);
    assert.equal(classifyPackage(selection.drug, rules).size, "small");
  });

  it("E 大箱 210錠は大容量", () => {
    const [selection] = saleSelectionsFor(["E"], { packageChoice: "large_one" });
    assert.ok(selection);
    assert.equal(classifyPackage(selection.drug, rules).size, "large");
  });
});

describe("選んだ薬と R02 の答えから販売手順を作る（sales-procedures.md の S 行）", () => {
  it("S06：E 小箱を1個・30歳では、指定濫用防止の確認（R01・R04）が要り、理由（R03）は要らない", () => {
    const ids = stepIds(["E"], { packageChoice: "small_one" }, 30);
    assert.ok(ids.includes("abuse_other_store_purchase"));
    assert.ok(ids.includes("abuse_purpose"));
    assert.ok(!ids.includes("abuse_reason"));
  });

  it("S07：E 大箱を1個・30歳では、理由（R03）の確認と記録が要る", () => {
    assert.ok(stepIds(["E"], { packageChoice: "large_one" }, 30).includes("abuse_reason"));
  });

  it("S08：E を複数個（3個）・30歳では、理由（R03）の確認と記録が要る", () => {
    assert.ok(stepIds(["E"], { packageChoice: "multiple", multipleCount: 3 }, 30).includes("abuse_reason"));
  });

  it("S09：E 大箱を1個・17歳は、販売手順を作らずに止める（選べない組み合わせ）", () => {
    assert.throws(
      () => stepIds(["E"], { packageChoice: "large_one" }, 17),
      (error: unknown) => error instanceof DomainRuleError && error.code === "QUANTITY_NOT_ALLOWED",
    );
  });

  it("S11：E 小箱を1個・17歳では、別紙での氏名の確認が要る", () => {
    assert.ok(stepIds(["E"], { packageChoice: "small_one" }, 17).includes("minor_name_sheet"));
  });

  it("S12：C と H を一緒に選ぶと、第1類の手順と第3類の手順を合わせた一覧になる", () => {
    assert.deepEqual(stepIds(["C", "H"], {}, 30), [
      "written_information_prepared",
      "written_information_handed",
      "understanding_check",
      "legal_record",
      "contraindication_check",
    ]);
  });

  it("S13：D を選ぶと、禁忌の確認と相談を促す表示が要る", () => {
    assert.deepEqual(stepIds(["D"], {}, 30), ["contraindication_check", "consultation_notice"]);
  });

  it("E を選んで R02（包装・個数）の答えがないときは、推測せずに止める", () => {
    assert.throws(
      () => saleSelectionsFor(["E"], {}),
      (error: unknown) => error instanceof DomainRuleError && error.code === "ANSWER_MISSING",
    );
  });
});

describe("禁忌の薬は選べない（contraindication-tests.md の K 行）", () => {
  const asthma: InterviewFacts = { ...BASE, asthmaHistory: "yes" };

  it("K01：ぜんそくを起こしたことがある人に、C は販売する薬として選べない", () => {
    assert.throws(
      () => assertSaleSelectable(judgeDrugs(["C"], asthma), ["C"]),
      (error: unknown) => error instanceof DomainRuleError && error.code === "CONTRAINDICATED_NOT_SELECTABLE",
    );
  });

  it("K03：ぜんそくを起こしたことがある人に、G（問題なし）は選べる", () => {
    assert.doesNotThrow(() => assertSaleSelectable(judgeDrugs(["G"], asthma), ["G"]));
  });

  it("K09：注意（妊娠中・12週より前の C）は、禁忌ではないので選べる", () => {
    const facts: InterviewFacts = { ...BASE, pregnancy: "pregnant", dueWithin12Weeks: "no" };
    assert.doesNotThrow(() => assertSaleSelectable(judgeDrugs(["C"], facts), ["C"]));
  });

  it("禁忌判定をしていない薬は選べない", () => {
    assert.throws(
      () => assertSaleSelectable(judgeDrugs(["G"], BASE), ["J"]),
      (error: unknown) => error instanceof DomainRuleError && error.code === "DRUG_NOT_JUDGED",
    );
  });
});

describe("その薬のために聞いた項目（interview-items.md の聞く条件）", () => {
  const answers = { ...BASE };

  it("ほしい薬の流れで G のためには、コンタクトレンズ（Q13）を聞き、貼る場所（Q14）は聞かない", () => {
    const ids = questionsAskedForDrug({ answers, selectedDrugs: ["G"], route: "product" }, "G");
    assert.ok(ids.includes("Q13"));
    assert.ok(!ids.includes("Q14"));
  });

  it("ほしい薬の流れで H のためには、貼る場所（Q14）を聞き、コンタクトレンズ（Q13）は聞かない", () => {
    const ids = questionsAskedForDrug({ answers, selectedDrugs: ["H"], route: "product" }, "H");
    assert.ok(ids.includes("Q14"));
    assert.ok(!ids.includes("Q13"));
  });

  it("ほしい薬の流れでは、どの薬でも、いま飲んでいる薬（Q09）を聞く", () => {
    for (const drug of ["A", "G", "H"] as const) {
      assert.ok(questionsAskedForDrug({ answers, selectedDrugs: [drug], route: "product" }, drug).includes("Q09"));
    }
  });
});
