import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError } from "@moda/domain";

import {
  SessionServiceError,
  answer,
  cancelEmergency119,
  chooseDrugs,
  chooseRoute,
  createSession,
  decideEmergency,
  getSession,
  openEmergency,
  patientView,
  recordEmergencyFollowUp,
  type ServiceDeps,
  type SessionRecord,
} from "./session-service.ts";

function testDeps(): ServiceDeps {
  const map = new Map<string, SessionRecord>();
  let n = 0;
  return {
    store: { get: (id) => map.get(id), set: (r) => void map.set(r.id, r), all: () => map.values() },
    now: () => new Date("2026-11-06T10:00:00+09:00"),
    newId: () => `s${(n += 1)}`,
  };
}

function assertError(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => (err instanceof DomainRuleError || err instanceof SessionServiceError) && err.code === code);
}

/** 30歳女性の、問題のない基本の答え */
const basic = {
  age: 30,
  sex: "female",
  pregnancy: "no",
  breastfeeding: "no",
  asthmaHistory: "no",
  conditions: [],
  drugAllergy: "no",
  currentMedications: [],
  drivingAfter: false,
} as const;

/** 年齢・性別 →「症状から探す」→ 基本の項目、まで答える */
function answerBasicBySymptom(deps: ServiceDeps, id: string): void {
  answer(deps, id, { age: 30, sex: "female" });
  chooseRoute(deps, id, "symptom", "headache");
  answer(deps, id, basic);
}

describe("接客を始める", () => {
  it("言語を選ぶと、年齢・性別を聞く状態から始まり、最初に年齢（Q01）を聞く", () => {
    const deps = testDeps();
    const view = patientView(createSession(deps, "vi"));
    assert.equal(view.status, "attributes");
    assert.equal(view.language, "vi");
    assert.equal(view.nextQuestion, "Q01");
  });

  it("対応していない言語では始められない", () => {
    assertError(() => createSession(testDeps(), "de"), "UNSUPPORTED_LANGUAGE");
  });

  it("ない接客の記録は見つからないとして止める", () => {
    assertError(() => getSession(testDeps(), "nothing"), "SESSION_NOT_FOUND");
  });
});

describe("1問ずつ答えて、最後の質問まで進める", () => {
  it("年齢と性別を答えると問診に進み、基本の項目を答え終えると薬の選択に進む", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    assert.equal(patientView(answer(deps, id, { age: 30 })).status, "attributes");
    assert.equal(patientView(answer(deps, id, { sex: "female" })).status, "interview");
    chooseRoute(deps, id, "symptom", "headache");
    const view = patientView(answer(deps, id, basic));
    assert.equal(view.status, "drug_selection");
    assert.equal(view.basicInterviewComplete, true);
    assert.equal(view.nextQuestion, null);
  });

  it("薬を選ぶと、その薬の項目を聞く問診に戻り、答え終えると薬の選択に戻る", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    answerBasicBySymptom(deps, id);
    const chosen = patientView(chooseDrugs(deps, id, ["C"]));
    assert.equal(chosen.status, "interview");
    assert.equal(chosen.nextQuestion, "Q11");
    const done = patientView(answer(deps, id, { alcohol: false }));
    assert.equal(done.status, "drug_selection");
    assert.equal(done.interviewComplete, true);
  });

  it("決められた形でない答えは受け取らず、記録も次の質問も変わらない", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    assertError(() => answer(deps, id, { age: Number.NaN }), "FACT_INVALID");
    assert.equal(patientView(getSession(deps, id)).nextQuestion, "Q01");
  });

  it("基本の問診を答え終える前は、薬を選べない", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    assertError(() => chooseDrugs(deps, id, ["C"]), "INVALID_TRANSITION");
  });

  it("履歴には答えた項目の種類だけを残し、答えの中身は入れない", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    const record = answer(deps, id, { age: 30, sex: "female" });
    const answered = record.events.find((e) => e.type === "answered");
    assert.deepEqual(answered?.detail, ["age", "sex"]);
    assert.ok(!JSON.stringify(record.events).includes("female"));
  });
});

describe("緊急の確認（決まったこと No.38）", () => {
  it("問診の途中で緊急の確認を開くと、問診が止まる（答えを受け取らない）", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    answer(deps, id, { age: 30, sex: "female" });
    const opened = openEmergency(deps, id, { trigger: "keyword", matchedRuleIds: ["EA12"], inputText: "chest pain" });
    assert.equal(opened.snapshot.status, "emergency_review");
    assert.equal(patientView(opened).nextQuestion, null);
    assertError(() => answer(deps, id, { asthmaHistory: "no" }), "INVALID_TRANSITION");
  });

  it("薬剤師が「緊急ではない」と判断したら、確認の前の状態に戻り、問診を続けられる", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    answer(deps, id, { age: 30, sex: "female" });
    chooseRoute(deps, id, "symptom", "headache");
    openEmergency(deps, id, { trigger: "staff" });
    const back = decideEmergency(deps, id, "not_emergency");
    assert.equal(back.snapshot.status, "interview");
    assert.equal(patientView(back).nextQuestion, "Q03");
  });

  it("薬剤師が「119番の案内を出す」を選んだら、緊急終了になる", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    openEmergency(deps, id, { trigger: "staff" });
    assert.equal(decideEmergency(deps, id, "show_119").snapshot.status, "emergency_ended");
  });

  it("緊急の答え・観察の印・薬剤師の判断を、同じ接客の記録に残す", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    openEmergency(deps, id, { trigger: "keyword", matchedRuleIds: ["EA12"], inputText: "chest pain" });
    recordEmergencyFollowUp(deps, id, { answers: { EF01: "yes" }, scale: 8, observedRuleIds: ["EA06"] });
    const record = decideEmergency(deps, id, "show_119");
    const [emergency] = record.emergencies;
    assert.equal(emergency?.trigger, "keyword");
    assert.deepEqual(emergency?.matchedRuleIds, ["EA12"]);
    assert.equal(emergency?.inputText, "chest pain");
    assert.deepEqual(emergency?.followUps, [
      { answers: { EF01: "yes" }, scale: 8, observedRuleIds: ["EA06"], at: "2026-11-06T01:00:00.000Z" },
    ]);
    assert.equal(emergency?.decision, "show_119");
    assert.equal(emergency?.returnTo, "attributes");
  });

  it("緊急の確認中でなければ、判断や追加の答えは受け取らない", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    assertError(() => decideEmergency(deps, id, "show_119"), "INVALID_TRANSITION");
    assertError(
      () => recordEmergencyFollowUp(deps, id, { answers: {}, scale: null, observedRuleIds: [] }),
      "INVALID_TRANSITION",
    );
  });

  it("つらさの数字は0〜10の整数だけを受け取る", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    openEmergency(deps, id, { trigger: "staff" });
    assertError(
      () => recordEmergencyFollowUp(deps, id, { answers: {}, scale: 11, observedRuleIds: [] }),
      "INVALID_REQUEST",
    );
  });

  it("緊急終了のあとは、問診も緊急の確認も続けられない", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    openEmergency(deps, id, { trigger: "staff" });
    decideEmergency(deps, id, "show_119");
    assertError(() => answer(deps, id, { age: 30 }), "SESSION_ALREADY_ENDED");
    assertError(() => openEmergency(deps, id, { trigger: "staff" }), "SESSION_ALREADY_ENDED");
  });
});

describe("レビュー後の直し（No.13）", () => {
  it("緊急の確認画面の内容を送り直しても、前の内容を消さずに足していく", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    openEmergency(deps, id, { trigger: "staff" });
    recordEmergencyFollowUp(deps, id, { answers: { EF01: "yes" }, scale: 9, observedRuleIds: ["EA06"] });
    const record = recordEmergencyFollowUp(deps, id, { answers: {}, scale: null, observedRuleIds: [] });
    const followUps = record.emergencies[0]?.followUps ?? [];
    assert.equal(followUps.length, 2);
    assert.equal(followUps[0]?.scale, 9);
  });

  it("緊急症状の表にない ID や、自由な文は緊急の記録に入れない", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    assertError(() => openEmergency(deps, id, { trigger: "keyword", matchedRuleIds: ["I have chest pain"] }), "INVALID_REQUEST");
    openEmergency(deps, id, { trigger: "staff" });
    assertError(
      () => recordEmergencyFollowUp(deps, id, { answers: { "my heart hurts": "yes" }, scale: null, observedRuleIds: [] }),
      "INVALID_REQUEST",
    );
    assertError(
      () => recordEmergencyFollowUp(deps, id, { answers: {}, scale: null, observedRuleIds: ["free text"] }),
      "INVALID_REQUEST",
    );
  });

  it("長すぎる入力は受け取らない", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    assertError(() => openEmergency(deps, id, { trigger: "keyword", inputText: "x".repeat(501) }), "INVALID_REQUEST");
  });

  it("薬を選んだあと、その薬の項目に答える途中でも薬を選び直せる", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    answerBasicBySymptom(deps, id);
    chooseDrugs(deps, id, ["C"]);
    const view = patientView(chooseDrugs(deps, id, ["A"]));
    assert.deepEqual(view.selectedDrugs, ["A"]);
    assert.equal(view.status, "drug_selection");
    assert.equal(view.interviewComplete, true);
  });

  it("終了した接客に答えを送ると「終了済み」として止める", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    openEmergency(deps, id, { trigger: "staff" });
    decideEmergency(deps, id, "show_119");
    assertError(() => answer(deps, id, { age: 30 }), "SESSION_ALREADY_ENDED");
  });

  it("訂正した項目と、訂正で消えた項目を、種類だけ履歴に残す", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    answer(deps, id, { age: 30, sex: "female" });
    chooseRoute(deps, id, "symptom", "headache");
    answer(deps, id, { pregnancy: "no", breastfeeding: "no" });
    const record = answer(deps, id, { sex: "male" });
    const corrected = record.events.find((e) => e.type === "corrected");
    const cleared = record.events.find((e) => e.type === "answers_cleared");
    assert.deepEqual(corrected?.detail, ["sex"]);
    assert.deepEqual([...(cleared?.detail ?? [])].sort(), ["breastfeeding", "pregnancy"]);
  });
});

describe("ほかの答えも一緒に受け取る（11/6 の判断、J-06）", () => {
  it("男性が妊娠についても答えたら、妊娠の答えは捨て、年齢と性別は受け取って、捨てた項目を履歴に残す", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    const record = answer(deps, id, { age: 30, sex: "male", pregnancy: "not_applicable" });
    assert.equal(record.interview.answers.sex, "male");
    assert.equal(record.interview.answers.pregnancy, undefined);
    assert.equal(record.snapshot.status, "interview");
    assert.deepEqual(record.events.find((e) => e.type === "answers_ignored")?.detail, ["Q03"]);
    assert.deepEqual(record.events.find((e) => e.type === "answered")?.detail, ["age", "sex"]);
  });
});

describe("問診の流れを選ぶ（11/6 の判断）", () => {
  it("年齢・性別を答えると、流れを選ぶまで次の質問は出ない", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    const view = patientView(answer(deps, id, { age: 30, sex: "female" }));
    assert.equal(view.status, "interview");
    assert.equal(view.route, null);
    assert.equal(view.nextQuestion, null);
  });

  it("「ほしい薬がある」を選ぶとすぐに薬の選択に進み、選んだ薬の判定に使う項目だけを聞く", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    answer(deps, id, { age: 30, sex: "female" });
    const route = patientView(chooseRoute(deps, id, "product"));
    assert.equal(route.status, "drug_selection");
    const chosen = patientView(chooseDrugs(deps, id, ["G"]));
    assert.equal(chosen.status, "interview");
    assert.equal(chosen.nextQuestion, "Q07");
    answer(deps, id, { conditions: [] });
    // いま飲んでいる薬（Q09）は、判定に使わなくてもどの薬でも聞く（11/6 依頼主の判断。K39）
    assert.equal(patientView(getSession(deps, id)).nextQuestion, "Q09");
    answer(deps, id, { currentMedications: [] });
    const done = patientView(answer(deps, id, { softContactLens: false }));
    assert.equal(done.status, "drug_selection");
    assert.equal(done.interviewComplete, true);
  });

  it("「症状から探す」では、入力された症状を記録に残し、履歴には中身を入れない", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    answer(deps, id, { age: 30, sex: "female" });
    const record = chooseRoute(deps, id, "symptom", "sore throat");
    assert.equal(record.symptomText, "sore throat");
    assert.equal(patientView(record).nextQuestion, "Q03");
    assert.ok(!JSON.stringify(record.events).includes("sore throat"));
  });

  it("年齢・性別を答える前は、流れを選べない", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    assertError(() => chooseRoute(deps, id, "product"), "INVALID_TRANSITION");
  });

  it("薬を選んだあとは、流れを選び直せない", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    answer(deps, id, { age: 30, sex: "female" });
    chooseRoute(deps, id, "product");
    chooseDrugs(deps, id, ["H"]);
    assertError(() => chooseRoute(deps, id, "symptom"), "INVALID_TRANSITION");
  });
});

describe("レビュー後の直し（No.14）", () => {
  it("「ほしい薬がある」で、薬の項目に答えている途中でも薬を選び直せる", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    answer(deps, id, { age: 30, sex: "female" });
    chooseRoute(deps, id, "product");
    chooseDrugs(deps, id, ["C"]);
    const view = patientView(chooseDrugs(deps, id, ["H"]));
    assert.deepEqual(view.selectedDrugs, ["H"]);
    // 貼り薬 H でも、いま飲んでいる薬（Q09）を先に聞く（11/6 依頼主の判断。K39）
    assert.equal(view.nextQuestion, "Q09");
  });
});

describe("119番の案内の取り消しと、確認済みの接客（11/6 依頼主の判断）", () => {
  function startInterview(deps: ServiceDeps): string {
    const { id } = createSession(deps, "en");
    answer(deps, id, { age: 30, sex: "female" });
    chooseRoute(deps, id, "symptom", "headache");
    return id;
  }

  it("「119番の案内を出す」を押し間違いとして取り消すと、問診には戻らず、押す前の薬剤師の確認に戻る。もとの判断は記録に残る", () => {
    const deps = testDeps();
    const id = startInterview(deps);
    openEmergency(deps, id, { trigger: "keyword", matchedRuleIds: ["EA12"], inputText: "chest pain" });
    decideEmergency(deps, id, "show_119");
    const back = cancelEmergency119(deps, id);
    assert.equal(back.snapshot.status, "emergency_review");
    assert.equal(patientView(back).nextQuestion, null); // 問診は止まったまま
    assert.equal(back.emergencies[0]?.decision, "show_119");
    assert.notEqual(back.emergencies[0]?.cancelledAt, null);
    // 確認をやり直すため、同じ根拠で判断前の緊急の記録が足される
    assert.equal(back.emergencies[1]?.decision, null);
    assert.equal(back.emergencies[1]?.inputText, "chest pain");
    assert.deepEqual(back.emergencies[1]?.matchedRuleIds, ["EA12"]);
    assert.deepEqual(back.emergencies[1]?.followUps, []); // 追加の答えは次の判断のときにあらためて記録する（二重にしない）
    assert.ok(back.events.some((e) => e.type === "emergency_cancelled"));
  });

  it("取り消したあと、薬剤師が「緊急ではない」を選べば問診に戻り、もう一度「119番の案内を出す」も選べる", () => {
    const deps = testDeps();
    const id = startInterview(deps);
    openEmergency(deps, id, { trigger: "staff" });
    decideEmergency(deps, id, "show_119");
    cancelEmergency119(deps, id);
    const back = decideEmergency(deps, id, "not_emergency");
    assert.equal(back.snapshot.status, "interview");
    assert.equal(patientView(back).nextQuestion, "Q03");

    const deps2 = testDeps();
    const id2 = startInterview(deps2);
    openEmergency(deps2, id2, { trigger: "staff" });
    decideEmergency(deps2, id2, "show_119");
    cancelEmergency119(deps2, id2);
    assert.equal(decideEmergency(deps2, id2, "show_119").snapshot.status, "emergency_ended");
  });

  it("同じ「119番の案内」は二度は取り消せない", () => {
    const deps = testDeps();
    const id = startInterview(deps);
    openEmergency(deps, id, { trigger: "staff" });
    decideEmergency(deps, id, "show_119");
    cancelEmergency119(deps, id);
    assertError(() => cancelEmergency119(deps, id), "INVALID_TRANSITION");
  });

  it("119番の案内を出していなければ、取り消しはできない", () => {
    const deps = testDeps();
    const id = startInterview(deps);
    assertError(() => cancelEmergency119(deps, id), "INVALID_TRANSITION");
    openEmergency(deps, id, { trigger: "staff" });
    assertError(() => cancelEmergency119(deps, id), "INVALID_TRANSITION");
  });

  it("薬剤師が「緊急ではない」と判断するまでは、確認済みの印は付かない", () => {
    const deps = testDeps();
    const id = startInterview(deps);
    assert.equal(patientView(getSession(deps, id)).emergencyCleared, false);
    openEmergency(deps, id, { trigger: "staff" });
    assert.equal(patientView(getSession(deps, id)).emergencyCleared, false);
    assert.equal(patientView(decideEmergency(deps, id, "not_emergency")).emergencyCleared, true);
  });

  it("範囲の外の年齢（121歳）は受け取らず、記録も変えない（C-13）", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    const before = getSession(deps, id);
    assert.throws(() => answer(deps, id, { age: 121, sex: "female" }), (e: unknown) => e instanceof DomainRuleError && e.code === "FACT_INVALID");
    assert.deepEqual(getSession(deps, id), before);
  });

  it("画面を読み直したときに緊急キーワードの確認で使う年齢を返す（まだ答えていなければ null）", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    assert.equal(patientView(getSession(deps, id)).age, null);
    assert.equal(patientView(answer(deps, id, { age: 30, sex: "female" })).age, 30);
  });

  it("119番の案内を押し間違いで取り消しただけでは、確認済みの印は付かない（「緊急ではない」の判断ではないため）", () => {
    const deps = testDeps();
    const id = startInterview(deps);
    openEmergency(deps, id, { trigger: "staff" });
    assert.equal(patientView(decideEmergency(deps, id, "show_119")).emergencyCleared, false);
    assert.equal(patientView(cancelEmergency119(deps, id)).emergencyCleared, false);
  });
});

// sales-procedures.md S09・S10・S11（☑）。18歳未満の大容量・複数個を R02 の時点で止める（backlog M-12）
describe("R02 の時点の個数・包装の制限（M-12）", () => {
  /** 「ほしい薬がある」で E を選び、R02 の手前まで答える */
  function toR02(deps: ServiceDeps, age: number): string {
    const { id } = createSession(deps, "en");
    answer(deps, id, { age, sex: "female" });
    chooseRoute(deps, id, "product");
    chooseDrugs(deps, id, ["E"]);
    answer(deps, id, { ...basic, age, alcohol: false, otherStorePurchase: "no" });
    assert.equal(patientView(getSession(deps, id)).nextQuestion, "R02");
    return id;
  }

  it("S09・S10・S11：17歳の R02 では小箱1個だけが選べ、選べない選択肢ごとの注意文を返す（年齢・個数は版のデータの値）", () => {
    const deps = testDeps();
    const id = toR02(deps, 17);
    assert.deepEqual(patientView(getSession(deps, id)).packageOptions, {
      allowed: ["small_one"],
      noticeByChoice: { large_one: "minor_large_package", multiple: "minor_multiple_packages" },
      minorAgeBelow: 18,
      minorMaxQuantity: 1,
    });
  });

  it("S09・S10：17歳が大箱1個・小箱2個を答えても受け取らず、記録は変わらない", () => {
    const deps = testDeps();
    const id = toR02(deps, 17);
    const before = getSession(deps, id);
    assertError(() => answer(deps, id, { packageChoice: "large_one" }), "QUANTITY_NOT_ALLOWED");
    assertError(() => answer(deps, id, { packageChoice: "multiple", multipleCount: 2 }), "QUANTITY_NOT_ALLOWED");
    assert.equal(getSession(deps, id), before);
  });

  it("S11：17歳が小箱1個を答えると受け取る", () => {
    const deps = testDeps();
    const id = toR02(deps, 17);
    assert.equal(answer(deps, id, { packageChoice: "small_one" }).interview.answers.packageChoice, "small_one");
  });

  it("S07・S09：30歳で大箱1個と答えたあと年齢を17歳に直すと、R02 と R03 の答えを消して R02 を聞き直す", () => {
    const deps = testDeps();
    const id = toR02(deps, 30);
    answer(deps, id, { packageChoice: "large_one" });
    answer(deps, id, { reasonText: "family" });
    const record = answer(deps, id, { age: 17 });
    assert.equal(record.interview.answers.packageChoice, undefined);
    assert.equal(record.interview.answers.reasonText, undefined);
    assert.equal(patientView(record).nextQuestion, "R02");
    assert.equal(record.events.some((e) => e.type === "answers_cleared" && e.detail.includes("R02")), true);
  });

  it("S11：17歳で小箱1個と答えたあと年齢を30歳に直しても、R02 の答えは消えない", () => {
    const deps = testDeps();
    const id = toR02(deps, 17);
    answer(deps, id, { packageChoice: "small_one" });
    assert.equal(answer(deps, id, { age: 30 }).interview.answers.packageChoice, "small_one");
  });

  it("決定12・S10：17歳が B と E を一緒に選ぼうとすると止まる（R02 にどの包装も選べないため）", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    answer(deps, id, { age: 17, sex: "female" });
    chooseRoute(deps, id, "product");
    const before = getSession(deps, id);
    assertError(() => chooseDrugs(deps, id, ["B", "E"]), "QUANTITY_NOT_ALLOWED");
    assert.equal(getSession(deps, id), before);
  });

  it("S06：30歳の R02 では、どれも選べて注意文は出さない", () => {
    const deps = testDeps();
    const id = toR02(deps, 30);
    assert.deepEqual(patientView(getSession(deps, id)).packageOptions?.noticeByChoice, {});
  });
});
