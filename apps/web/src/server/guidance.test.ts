import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError, STOCKED_DRUGS, judgeDrugs, type InterviewAnswers, type StockedDrugId } from "@moda/domain";

import { mockAiClient } from "./ai/mock.ts";
import { approveSale } from "./approval.ts";
import {
  LEAFLET_CAUTIONS,
  answerUnderstanding,
  buildLeafletJapanese,
  checkPostApprovalStep,
  createGuidance,
  giveFeedback,
  printGuidance,
  proceedCheckout,
  startCounseling,
} from "./guidance.ts";
import { checkProcedureStep, chooseSaleDrugs, openPharmacistReview } from "./pharmacist-service.ts";
import { PinError, createPinVerifier } from "./pin.ts";
import {
  SessionServiceError,
  answer,
  chooseDrugs,
  chooseRoute,
  createSession,
  getSession,
  patientView,
  type ServiceDeps,
  type SessionRecord,
} from "./session-service.ts";

// 販売手順は docs/demo-data/sales-procedures.md の ☑ の行（P01・P02・P03・S03・S05）、
// 説明書の注意の文は docs/demo-data/leaflet.md の ☑ の行（LF03・LF07）、
// 用量は drugs.md の年齢別の表（☑。F の 8〜10歳は 1/2包）から作る。
// 「承認の前は作れない・印刷できない」「版を足す」などは CLAUDE.md の絶対に守るルール1・6 の仕組みのテスト（表の行ではない）。

const NOW = new Date("2026-11-08T10:00:00+09:00");
const PINS = createPinVerifier("P1:1234");
const ai = mockAiClient();

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

async function assertRejects(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (err: unknown) => err instanceof DomainRuleError && err.code === code);
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

/** 「ほしい薬がある」で選んで答え、薬剤師の確認で販売する薬に選び、承認の前の手順に ✓ を付ける */
function reviewed(deps: ServiceDeps, drug: StockedDrugId, beforeSteps: string[], extra: InterviewAnswers = {}): string {
  const { id } = createSession(deps, "en");
  answer(deps, id, { age: 30, sex: "female" });
  chooseRoute(deps, id, "product");
  chooseDrugs(deps, id, [drug]);
  answer(deps, id, { ...fine, ...extra });
  openPharmacistReview(deps, id);
  chooseSaleDrugs(deps, id, [drug]);
  for (const step of beforeSteps) checkProcedureStep(deps, id, step, true);
  return id;
}

const approve = (deps: ServiceDeps, id: string) => approveSale(deps, PINS, id, { pharmacistId: "P1", pin: "1234" });

describe("説明書（T10）", () => {
  it("説明書の注意の文（leaflet.md）は、禁忌判定のデータの注意の理由と1つずつ対応している（文の取り違えを防ぐ）", () => {
    for (const caution of LEAFLET_CAUTIONS) {
      for (const drugId of caution.drugIds) {
        const drug = STOCKED_DRUGS.find((d) => d.id === drugId);
        assert.ok(
          drug?.rules.some((r) => r.verdict === "caution" && r.label === caution.reasonLabel),
          `${caution.id} の ${drugId}「${caution.reasonLabel}」が判定のデータにない`,
        );
      }
    }
  });

  it("LF03：D を飲んだあとに運転する予定の人の説明書には、運転しないでくださいの文が入る（AI の文ではなく表の文）", () => {
    const facts = { age: 30, sex: "female" as const, ...fine, drivingAfter: true };
    const text = buildLeafletJapanese(["D"], judgeDrugs(["D"], facts), 30);
    assert.match(text, /車やバイクの運転をしないでください/);
    assert.match(text, /モダペインA錠/);
  });

  it("drugs.md の年齢別の表：9歳の F の説明書には、1回量 1/2包 が入る", () => {
    const facts = { age: 9, sex: "female" as const, ...fine, weightKg: 28 };
    assert.match(buildLeafletJapanese(["F"], judgeDrugs(["F"], facts), 9), /9歳の1回量：1\/2包/);
  });

  it("承認の前（販売する薬を選んだあと）でも説明書は作れ、中身を確かめられる（手順「書面の準備」のため）。印刷はできない（ルール1）", async () => {
    const deps = testDeps();
    const id = reviewed(deps, "G", []);
    const record = await createGuidance(deps, ai, id);
    assert.match(record.guidances?.at(-1)?.japanese ?? "", /モダアイクリア/);
    assert.match(record.guidances?.at(-1)?.translation ?? "", /仮の AI の訳/);
    assertError(() => printGuidance(deps, id), "NOT_APPROVED");
    assertError(() => startCounseling(deps, id), "NOT_APPROVED");
    // 承認の前は、患者さんの画面に説明書を出さない
    assert.equal(patientView(getSession(deps, id)).guidance, null);
  });

  it("販売する薬を選ぶ前は説明書を作れない", async () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    answer(deps, id, { age: 30, sex: "female" });
    chooseRoute(deps, id, "product");
    chooseDrugs(deps, id, ["G"]);
    answer(deps, id, fine);
    openPharmacistReview(deps, id);
    await assertRejects(createGuidance(deps, ai, id), "NO_DRUG_SELECTED");
  });
});

describe("服薬指導・理解の確認・会計案内・評価（T10）", () => {
  it("P02・S03：C を承認したあと、説明書を作って服薬指導を始め、理解の確認が済むまで会計案内に進めない。わかったで販売記録に版2ができ、版1は変わらない", async () => {
    const deps = testDeps();
    const id = reviewed(deps, "C", ["written_information_prepared"]);
    approve(deps, id);
    await createGuidance(deps, ai, id);
    printGuidance(deps, id);
    assert.equal(startCounseling(deps, id).snapshot.status, "counseling");
    checkPostApprovalStep(deps, id, "written_information_handed", true);
    checkPostApprovalStep(deps, id, "legal_record", true);
    // S03：理解の確認が済んでいない
    assertError(() => proceedCheckout(deps, id), "PROCEDURE_INCOMPLETE_FOR_CHECKOUT");

    const v1 = getSession(deps, id).saleRecord?.versions[0];
    answerUnderstanding(deps, id, "partly");
    assert.equal(getSession(deps, id).saleRecord?.versions.length, 1); // わからないところがあるときは版を足さない
    const confirmed = answerUnderstanding(deps, id, "understood");
    assert.equal(confirmed.saleRecord?.versions.length, 2);
    assert.equal(confirmed.saleRecord?.versions[1]?.understanding, "confirmed");
    assert.equal(confirmed.saleRecord?.versions[1]?.reason, "understanding_confirmed");
    assert.deepEqual(confirmed.saleRecord?.versions[0], v1);
    assert.equal(confirmed.snapshot.understandingConfirmed, true);
    // 2回目の「わかった」は受け付けない（版を重ねて足さない）
    assertError(() => answerUnderstanding(deps, id, "understood"), "UNDERSTANDING_ALREADY_CONFIRMED");

    assert.equal(proceedCheckout(deps, id).snapshot.status, "checkout");
    const done = giveFeedback(deps, id, "good");
    assert.equal(done.snapshot.status, "completed");
    assert.equal(done.feedback?.rating, "good");
    // 評価は販売記録に入れない
    assert.equal(done.saleRecord?.versions.length, 2);
  });

  it("P01：書面を渡す（承認の後の手順）が済んでいないと、理解の確認が済んでも会計案内に進めない", async () => {
    const deps = testDeps();
    const id = reviewed(deps, "C", ["written_information_prepared"]);
    approve(deps, id);
    await createGuidance(deps, ai, id);
    startCounseling(deps, id);
    answerUnderstanding(deps, id, "understood");
    checkPostApprovalStep(deps, id, "legal_record", true);
    assertError(() => proceedCheckout(deps, id), "PROCEDURE_INCOMPLETE_FOR_CHECKOUT");
  });

  it("S05：A は薬剤師の前での服用の確認が済んでいないと、会計案内に進めない（承認はできる）", async () => {
    const deps = testDeps();
    const id = reviewed(deps, "A", ["written_information_prepared", "separate_document_check"]);
    assert.equal(approve(deps, id).snapshot.status, "approved");
    await createGuidance(deps, ai, id);
    startCounseling(deps, id);
    answerUnderstanding(deps, id, "understood");
    checkPostApprovalStep(deps, id, "written_information_handed", true);
    checkPostApprovalStep(deps, id, "legal_record", true);
    assertError(() => proceedCheckout(deps, id), "PROCEDURE_INCOMPLETE_FOR_CHECKOUT");
    checkPostApprovalStep(deps, id, "witnessed_dosing", true);
    assert.equal(proceedCheckout(deps, id).snapshot.status, "checkout");
  });

  it("理解の確認は薬剤師の ✓ では付けられない。承認の前の手順も、承認のあとには付け外しできない", async () => {
    const deps = testDeps();
    const id = reviewed(deps, "C", ["written_information_prepared"]);
    approve(deps, id);
    assertError(() => checkPostApprovalStep(deps, id, "understanding_check", true), "STEP_RECORDED_BY_PATIENT");
    assertError(() => checkPostApprovalStep(deps, id, "written_information_prepared", false), "INVALID_REQUEST");
  });

  it("承認の前は、理解の確認・会計案内・評価を受け付けない（ルール1）", () => {
    const deps = testDeps();
    const id = reviewed(deps, "G", ["contraindication_check"]);
    assertError(() => answerUnderstanding(deps, id, "understood"), "NOT_APPROVED");
    assertError(() => proceedCheckout(deps, id), "INVALID_TRANSITION");
    assertError(() => giveFeedback(deps, id, "good"), "NOT_APPROVED");
  });

  it("説明書がないと服薬指導を始められない", () => {
    const deps = testDeps();
    const id = reviewed(deps, "G", ["contraindication_check"]);
    approve(deps, id);
    assertError(() => startCounseling(deps, id), "GUIDANCE_NOT_READY");
  });

  it("理解の確認の答え・評価の種類だけを履歴に残し、説明書の文は履歴に入れない", async () => {
    const deps = testDeps();
    const id = reviewed(deps, "G", ["contraindication_check"], { softContactLens: true });
    approve(deps, id);
    const record = await createGuidance(deps, ai, id);
    // LF07（G・コンタクト）の文が説明書にある
    assert.match(record.guidances?.at(-1)?.japanese ?? "", /ソフトコンタクトレンズを外してから使ってください/);
    assert.equal(JSON.stringify(record.events).includes("ソフトコンタクトレンズ"), false);
  });
});
