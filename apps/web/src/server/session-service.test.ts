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
    store: { get: (id) => map.get(id), set: (r) => void map.set(r.id, r) },
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

  it("「119番の案内を出す」を押し間違いとして取り消すと、確認の前の問診に戻り、もとの判断は記録に残る", () => {
    const deps = testDeps();
    const id = startInterview(deps);
    openEmergency(deps, id, { trigger: "staff" });
    decideEmergency(deps, id, "show_119");
    const back = cancelEmergency119(deps, id);
    assert.equal(back.snapshot.status, "interview");
    assert.equal(patientView(back).nextQuestion, "Q03");
    assert.equal(back.emergencies[0]?.decision, "show_119");
    assert.notEqual(back.emergencies[0]?.cancelledAt, null);
    assert.ok(back.events.some((e) => e.type === "emergency_cancelled"));
  });

  it("119番の案内は二度は取り消せない", () => {
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

  it("119番の案内を取り消したときも、確認済みの印が付く", () => {
    const deps = testDeps();
    const id = startInterview(deps);
    openEmergency(deps, id, { trigger: "staff" });
    assert.equal(patientView(decideEmergency(deps, id, "show_119")).emergencyCleared, false);
    assert.equal(patientView(cancelEmergency119(deps, id)).emergencyCleared, true);
  });
});
