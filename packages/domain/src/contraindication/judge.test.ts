/**
 * 禁忌判定のテスト。docs/demo-data/contraindication-tests.md の ☑ の行だけから作る（1行が1つのテスト）。
 * 表と同じく、確認する内容（問診の項目）ごとにまとめている。行を足すときは同じまとまりに入れる。
 * 表に書いていない項目は、表の決まりどおり「問題のない答え」（30歳女性、妊娠・授乳なし、
 * 持病・アレルギー・併用薬・運転・飲酒なし）とする。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { IngredientFlag, IngredientId, StockedDrugId } from "./data.ts";
import type { InterviewFacts, InterviewItemId } from "./facts.ts";
import { doseForAge, judgeDrug, rankCandidates, type DrugJudgment, type Verdict } from "./judge.ts";

/** 表の「問題のない答え」。Q11〜Q14 も、どの薬でも判定できるよう問題のない答えにしておく */
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

const patient = (overrides: InterviewFacts): InterviewFacts => ({ ...BASE, ...overrides });

function expectVerdict(drugId: StockedDrugId, facts: InterviewFacts, verdict: Verdict): DrugJudgment {
  const result = judgeDrug(drugId, facts);
  assert.equal(result.verdict, verdict);
  if (verdict === "ok") assert.deepEqual(result.reasons, []);
  return result;
}

/** 理由に、指定した種類・項目のものがあることを確かめる */
function expectReason(
  result: DrugJudgment,
  expected: {
    code: string;
    item: InterviewItemId;
    /** 表の「理由として出す内容」 */
    label?: string;
    uncertain?: boolean;
    ingredient?: IngredientId;
    flag?: IngredientFlag;
  },
): void {
  const reason = result.reasons.find((r) => r.code === expected.code && r.itemIds.includes(expected.item));
  assert.ok(reason, `理由 ${expected.code}（${expected.item}）が出ていない`);
  assert.equal(reason.uncertain, expected.uncertain ?? false);
  if (expected.label !== undefined) assert.equal(reason.label, expected.label);
  if (expected.ingredient) assert.ok(reason.basis.ingredients?.includes(expected.ingredient));
  if (expected.flag) assert.ok(reason.basis.flags?.includes(expected.flag));
}

describe("禁忌判定：年齢（Q01）", () => {
  it("K04 14歳に C は禁忌（15歳未満）", () => {
    const r = expectVerdict("C", patient({ age: 14 }), "contraindicated");
    expectReason(r, { code: "AGE_UNDER", item: "Q01", label: "15歳未満" });
  });

  it("K05 15歳に C は問題なし（年齢の境目）", () => {
    expectVerdict("C", patient({ age: 15 }), "ok");
  });

  it("K31 14歳に I は禁忌（15歳未満）", () => {
    const r = expectVerdict("I", patient({ age: 14 }), "contraindicated");
    expectReason(r, { code: "AGE_UNDER", item: "Q01", label: "15歳未満" });
  });

  it("K06 11歳に E は禁忌（12歳未満）", () => {
    const r = expectVerdict("E", patient({ age: 11 }), "contraindicated");
    expectReason(r, { code: "AGE_UNDER", item: "Q01", label: "12歳未満" });
  });

  it("K07 12歳に E は問題なし（年齢の境目）", () => {
    expectVerdict("E", patient({ age: 12 }), "ok");
  });

  it("K20 4歳に F は禁忌（5歳未満）", () => {
    const r = expectVerdict("F", patient({ age: 4 }), "contraindicated");
    expectReason(r, { code: "AGE_UNDER", item: "Q01", label: "5歳未満" });
  });

  it("K20a 5歳に F は問題なしで、1回1/3包を表示する（年齢の境目）", () => {
    expectVerdict("F", patient({ age: 5 }), "ok");
    assert.equal(doseForAge("F", 5)?.dose, "1/3包");
  });

  it("K37 1歳に J は禁忌（2歳未満）", () => {
    const r = expectVerdict("J", patient({ age: 1 }), "contraindicated");
    expectReason(r, { code: "AGE_UNDER", item: "Q01", label: "2歳未満" });
  });

  it("K38 2歳に J は問題なしで、1回1/3包を表示する（年齢の境目）", () => {
    expectVerdict("J", patient({ age: 2 }), "ok");
    assert.equal(doseForAge("J", 2)?.dose, "1/3包");
  });
});

describe("禁忌判定：性別（Q02）", () => {
  it("K15 男性に A は禁忌", () => {
    // 男性には妊娠・授乳を聞かないので、答えのない状態で判定する
    const male: InterviewFacts = { ...BASE, sex: "male" };
    delete male.pregnancy;
    delete male.breastfeeding;
    const r = expectVerdict("A", male, "contraindicated");
    expectReason(r, { code: "MALE", item: "Q02", label: "男性" });
  });
});

describe("禁忌判定：妊娠（Q03・Q03a）", () => {
  it("K16 妊娠している人に A は禁忌", () => {
    const r = expectVerdict("A", patient({ pregnancy: "pregnant" }), "contraindicated");
    expectReason(r, { code: "PREGNANT", item: "Q03", label: "妊娠" });
  });

  it("K26 妊娠しているかもしれない人に A は禁忌（妊娠の可能性）", () => {
    const r = expectVerdict("A", patient({ pregnancy: "maybe" }), "contraindicated");
    expectReason(r, { code: "PREGNANT", item: "Q03", uncertain: true, label: "妊娠の可能性" });
  });

  it("K45 11歳女性で妊娠しているかもしれない人に A は禁忌（A は12歳未満でも妊娠を確かめる。妊娠の可能性）", () => {
    const r = expectVerdict("A", patient({ age: 11, pregnancy: "maybe" }), "contraindicated");
    expectReason(r, { code: "PREGNANT", item: "Q03", uncertain: true, label: "妊娠の可能性" });
  });

  it("K46 11歳女性で妊娠していない人に A は問題なし（K45 と対になる行）", () => {
    expectVerdict("A", patient({ age: 11, pregnancy: "no" }), "ok");
  });

  it("K47 A と一緒に選んで妊娠を聞いた11歳女性で、妊娠している人に J は注意（妊娠中・相談）", () => {
    const r = expectVerdict("J", patient({ age: 11, pregnancy: "pregnant" }), "caution");
    expectReason(r, { code: "PREGNANT_CONSULT", item: "Q03", label: "妊娠中（相談）" });
  });

  it("K48 A と一緒に選んで妊娠を聞いた11歳女性で、妊娠しているかもしれない人に J は注意（妊娠の可能性）", () => {
    const r = expectVerdict("J", patient({ age: 11, pregnancy: "maybe" }), "caution");
    expectReason(r, { code: "PREGNANT_CONSULT", item: "Q03", uncertain: true, label: "妊娠の可能性" });
  });

  it("K43 妊娠しているかもしれない人に C は禁忌（出産予定日まで12週以内かがわからない）", () => {
    const r = expectVerdict("C", patient({ pregnancy: "maybe" }), "contraindicated");
    expectReason(r, { code: "DUE_WITHIN_12_WEEKS", item: "Q03", uncertain: true, flag: "nsaid", label: "妊娠の可能性（出産予定日まで12週以内かがわからない）" });
  });

  it("K08 妊娠していて出産予定日まで12週以内の人に C は禁忌", () => {
    const r = expectVerdict("C", patient({ pregnancy: "pregnant", dueWithin12Weeks: "yes" }), "contraindicated");
    expectReason(r, { code: "DUE_WITHIN_12_WEEKS", item: "Q03a", ingredient: "N1", flag: "nsaid", label: "出産予定日まで12週以内" });
  });

  it("K09 妊娠していて出産予定日まで12週より前の人に C は注意（相談）", () => {
    const r = expectVerdict("C", patient({ pregnancy: "pregnant", dueWithin12Weeks: "no" }), "caution");
    expectReason(r, { code: "PREGNANT_CONSULT", item: "Q03a", ingredient: "N1", flag: "nsaid", label: "妊娠中（相談）" });
  });

  it("K29 妊娠していて出産予定日まで12週以内かが「わからない」人に C は禁忌", () => {
    const r = expectVerdict(
      "C",
      patient({ pregnancy: "pregnant", dueWithin12Weeks: "unknown" }),
      "contraindicated",
    );
    expectReason(r, { code: "DUE_WITHIN_12_WEEKS", item: "Q03a", uncertain: true, label: "出産予定日が不明" });
  });
});

describe("禁忌判定：授乳（Q04）", () => {
  it("K17 授乳中の人に A は注意（服用後24時間は授乳を避ける）", () => {
    const r = expectVerdict("A", patient({ breastfeeding: "yes" }), "caution");
    expectReason(r, { code: "BREASTFEEDING", item: "Q04", ingredient: "L1", label: "服用後24時間は授乳を避ける" });
  });

  it("K18 授乳中の人に E は禁忌（C1）", () => {
    const r = expectVerdict("E", patient({ breastfeeding: "yes" }), "contraindicated");
    expectReason(r, { code: "BREASTFEEDING", item: "Q04", ingredient: "C1", label: "授乳中（C1）" });
  });

  it("K49 11歳女性で授乳中の人に A は注意（A は12歳未満でも授乳を確かめる。服用後24時間は授乳を避ける）", () => {
    const r = expectVerdict("A", patient({ age: 11, breastfeeding: "yes" }), "caution");
    expectReason(r, { code: "BREASTFEEDING", item: "Q04", ingredient: "L1", label: "服用後24時間は授乳を避ける" });
  });

  it("K50 A と一緒に選んで授乳を聞いた11歳女性で、授乳中の人に E は禁忌（12歳未満・授乳中）", () => {
    const r = expectVerdict("E", patient({ age: 11, breastfeeding: "yes" }), "contraindicated");
    expectReason(r, { code: "AGE_UNDER", item: "Q01", label: "12歳未満" });
    expectReason(r, { code: "BREASTFEEDING", item: "Q04", ingredient: "C1", label: "授乳中（C1）" });
  });
});

describe("禁忌判定：ぜんそく歴（Q06）", () => {
  it("K01 ぜんそくを起こしたことがある人に C は禁忌（NSAID系の成分）", () => {
    const r = expectVerdict("C", patient({ asthmaHistory: "yes" }), "contraindicated");
    expectReason(r, { code: "ASTHMA", item: "Q06", ingredient: "N1", flag: "nsaid", label: "ぜんそく（NSAID系の成分）" });
  });

  it("K02 ぜんそくを起こしたことがある人に D は禁忌（NSAID系の成分）", () => {
    const r = expectVerdict("D", patient({ asthmaHistory: "yes" }), "contraindicated");
    expectReason(r, { code: "ASTHMA", item: "Q06", ingredient: "N2", flag: "nsaid", label: "ぜんそく（NSAID系の成分）" });
  });

  it("K33 ぜんそくを起こしたことがある人に I は禁忌（解熱鎮痛薬）", () => {
    const r = expectVerdict("I", patient({ asthmaHistory: "yes" }), "contraindicated");
    expectReason(r, { code: "ASTHMA", item: "Q06", label: "ぜんそく（解熱鎮痛薬）" });
  });

  it("K03 ぜんそくを起こしたことがある人でも G は問題なし", () => {
    expectVerdict("G", patient({ asthmaHistory: "yes" }), "ok");
  });

  it("K34 ぜんそくを起こしたことがある人でも漢方 J は問題なし", () => {
    expectVerdict("J", patient({ asthmaHistory: "yes" }), "ok");
  });

  it("K27 ぜんそく歴が「わからない」人に C は禁忌（ぜんそく歴が不明）", () => {
    const r = expectVerdict("C", patient({ asthmaHistory: "unknown" }), "contraindicated");
    expectReason(r, { code: "ASTHMA", item: "Q06", uncertain: true, ingredient: "N1", label: "ぜんそく歴が不明" });
  });

  it("K30 ぜんそく歴が「わからない」人に I は禁忌（ぜんそく歴が不明）", () => {
    const r = expectVerdict("I", patient({ asthmaHistory: "unknown" }), "contraindicated");
    expectReason(r, { code: "ASTHMA", item: "Q06", uncertain: true, label: "ぜんそく歴が不明" });
  });

  it("K28 ぜんそく歴が「わからない」人のかぜ薬は、B・E が禁忌で、漢方 J が候補の先頭に来る", () => {
    const ranked = rankCandidates(["B", "E", "J"], patient({ asthmaHistory: "unknown" }));
    assert.equal(ranked[0]?.drugId, "J");
    assert.equal(ranked[0]?.verdict, "ok");
    for (const id of ["B", "E"] as const) {
      const j = ranked.find((r) => r.drugId === id);
      assert.ok(j);
      assert.equal(j.verdict, "contraindicated");
      expectReason(j, { code: "ASTHMA", item: "Q06", uncertain: true });
    }
  });
});

describe("禁忌判定：治療中の病気（Q07）", () => {
  it("K10 胃潰瘍で治療中の人に C は禁忌", () => {
    const r = expectVerdict("C", patient({ conditions: ["gastric_ulcer"] }), "contraindicated");
    expectReason(r, { code: "CONDITION", item: "Q07", ingredient: "N1", flag: "gi_damage", label: "胃潰瘍で治療中" });
  });

  it("K19 透析を受けている人に F は禁忌", () => {
    const r = expectVerdict("F", patient({ conditions: ["dialysis"] }), "contraindicated");
    expectReason(r, { code: "CONDITION", item: "Q07", ingredient: "G1", label: "透析療法中" });
  });

  it("K21 緑内障の人に G は注意（相談）", () => {
    const r = expectVerdict("G", patient({ conditions: ["glaucoma"] }), "caution");
    expectReason(r, { code: "CONDITION", item: "Q07", ingredient: "V1", label: "緑内障（相談）" });
  });

  it("K35 高血圧で治療中の人に J は注意（カンゾウの類）", () => {
    const r = expectVerdict("J", patient({ conditions: ["hypertension"] }), "caution");
    expectReason(r, { code: "CONDITION", item: "Q07", ingredient: "GZ1", label: "カンゾウの類（むくみ・高血圧）" });
  });
});

describe("禁忌判定：薬のアレルギー歴（Q08）", () => {
  it("K40 薬のアレルギー歴が「わからない」人に A は問題なし（わからないは「なし」として扱う）", () => {
    expectVerdict("A", patient({ drugAllergy: "unknown" }), "ok");
  });
});

describe("禁忌判定：いま飲んでいる薬（Q09）", () => {
  it("K11 解熱鎮痛薬を飲んでいる人に C は禁忌（ほかの解熱鎮痛薬との併用）", () => {
    const r = expectVerdict("C", patient({ currentMedications: ["analgesic"] }), "contraindicated");
    expectReason(r, { code: "CONCURRENT_USE", item: "Q09", label: "ほかの解熱鎮痛薬との併用" });
  });

  it("K32 解熱鎮痛薬を飲んでいる人に I は禁忌（ほかの解熱鎮痛薬との併用）", () => {
    const r = expectVerdict("I", patient({ currentMedications: ["analgesic"] }), "contraindicated");
    expectReason(r, { code: "CONCURRENT_USE", item: "Q09", label: "ほかの解熱鎮痛薬との併用" });
  });

  it("K24 かぜ薬を飲んでいる人に E は禁忌（ほかのかぜ薬との併用）", () => {
    const r = expectVerdict("E", patient({ currentMedications: ["cold"] }), "contraindicated");
    expectReason(r, { code: "CONCURRENT_USE", item: "Q09", label: "ほかのかぜ薬との併用" });
  });

  it("K36 漢方を飲んでいる人に J は注意（生薬の重なり）", () => {
    const r = expectVerdict("J", patient({ currentMedications: ["kampo"] }), "caution");
    expectReason(r, { code: "CONCURRENT_USE", item: "Q09", label: "生薬の重なり" });
  });

  it("K39 病院で出された薬（処方薬）を飲んでいるだけでは、C の判定は変わらない（問題なし）", () => {
    expectVerdict(
      "C",
      patient({ currentMedications: ["prescription"], prescriptionDrugNames: ["架空の処方薬"] }),
      "ok",
    );
  });
});

describe("禁忌判定：運転（Q10）", () => {
  it("K12 服用後に運転する予定の人に D は注意（眠くなる成分）", () => {
    const r = expectVerdict("D", patient({ drivingAfter: true }), "caution");
    expectReason(r, { code: "DRIVING", item: "Q10", ingredient: "S1", flag: "drowsiness", label: "眠くなる成分（運転しない）" });
  });

  it("K13 服用後に運転する予定でも、眠くなる成分のない C は問題なし", () => {
    expectVerdict("C", patient({ drivingAfter: true }), "ok");
  });
});

describe("禁忌判定：飲酒（Q11）", () => {
  it("K14 服用前後に飲酒する予定の人に D は注意（飲酒）", () => {
    const r = expectVerdict("D", patient({ alcohol: true }), "caution");
    expectReason(r, { code: "ALCOHOL", item: "Q11", label: "飲酒" });
  });

  it("K44 服用前後に飲酒する予定の人に I は注意（飲酒）", () => {
    const r = expectVerdict("I", patient({ alcohol: true }), "caution");
    expectReason(r, { code: "ALCOHOL", item: "Q11", label: "飲酒" });
  });
});

describe("禁忌判定：飲む予定の日数（Q12）", () => {
  it("K41 15日飲む予定の人に F は注意（14日を超えて飲む予定）", () => {
    const r = expectVerdict("F", patient({ plannedDays: 15 }), "caution");
    expectReason(r, { code: "LONG_TERM_USE", item: "Q12", label: "14日を超えて飲む予定" });
  });

  it("K42 14日飲む予定の人に F は問題なし（日数の境目）", () => {
    expectVerdict("F", patient({ plannedDays: 14 }), "ok");
  });
});

describe("禁忌判定：コンタクトレンズ（Q13）・貼る場所（Q14）", () => {
  it("K22 ソフトコンタクトレンズをつけている人に G は注意（外して使う）", () => {
    const r = expectVerdict("G", patient({ softContactLens: true }), "caution");
    expectReason(r, { code: "SOFT_CONTACT_LENS", item: "Q13", label: "コンタクトを外して使う" });
  });

  it("K23 湿疹・傷のある場所に貼るなら H は注意（使わない）", () => {
    const r = expectVerdict("H", patient({ applicationSite: "eczema_or_wound" }), "caution");
    expectReason(r, { code: "APPLICATION_SITE", item: "Q14", label: "湿疹・かぶれ・傷口には使わない" });
  });
});

describe("禁忌判定：何も当てはまらない", () => {
  it("K25 何も当てはまらない30歳女性に E は問題なし", () => {
    expectVerdict("E", patient({}), "ok");
  });
});
