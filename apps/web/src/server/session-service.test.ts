import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError } from "@moda/domain";

import {
  SessionServiceError,
  answer,
  chooseDrugs,
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
    const view = patientView(answer(deps, id, basic));
    assert.equal(view.status, "drug_selection");
    assert.equal(view.basicInterviewComplete, true);
    assert.equal(view.nextQuestion, null);
  });

  it("薬を選ぶと、その薬の項目を聞く問診に戻り、答え終えると薬の選択に戻る", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    answer(deps, id, basic);
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
    assert.deepEqual(emergency?.followUp, { answers: { EF01: "yes" }, scale: 8, observedRuleIds: ["EA06"] });
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
    assertError(() => answer(deps, id, { age: 30 }), "INVALID_TRANSITION");
    assertError(() => openEmergency(deps, id, { trigger: "staff" }), "SESSION_ALREADY_ENDED");
  });
});
