import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError } from "../errors.ts";
import {
  SESSION_STATUSES,
  TERMINAL_STATUSES,
  assertActionAllowed,
  cancelEmergencyEnd,
  undoStep,
  transition,
  type SessionSnapshot,
  type SessionStatus,
} from "./state.ts";

const at = (status: SessionStatus, understandingConfirmed = false): SessionSnapshot => ({
  status,
  understandingConfirmed,
});

function assertRuleError(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => err instanceof DomainRuleError && err.code === code);
}

describe("承認ゲート：承認前は印刷・服薬指導・会計に進めない", () => {
  const preApproval: SessionStatus[] = [
    "language_selection",
    "attributes",
    "interview",
    "drug_selection",
    "pharmacist_review",
    "emergency_ended",
    "declined",
  ];

  for (const status of preApproval) {
    for (const action of ["print", "counsel", "checkout"] as const) {
      it(`${status} の状態では ${action} できない`, () => {
        assertRuleError(() => assertActionAllowed(status, action), "NOT_APPROVED");
      });
    }
  }

  it("承認後は説明書を印刷できる", () => {
    assert.doesNotThrow(() => assertActionAllowed("approved", "print"));
  });

  it("会計の状態でも説明書を再印刷できる", () => {
    assert.doesNotThrow(() => assertActionAllowed("checkout", "print"));
  });

  it("服薬指導の前に会計はできない", () => {
    assertRuleError(() => assertActionAllowed("approved", "checkout"), "ACTION_NOT_ALLOWED");
  });
});

describe("承認に入れるのは薬剤師の確認画面からだけ", () => {
  for (const status of SESSION_STATUSES) {
    if (status === "pharmacist_review" || TERMINAL_STATUSES.includes(status)) continue;
    it(`${status} から approved へは進めない`, () => {
      assertRuleError(() => transition(at(status), "approved"), "INVALID_TRANSITION");
    });
  }

  it("pharmacist_review から approved へは進める", () => {
    assert.equal(transition(at("pharmacist_review"), "approved").status, "approved");
  });
});

describe("緊急症状", () => {
  for (const status of SESSION_STATUSES) {
    if (TERMINAL_STATUSES.includes(status)) continue;
    it(`${status} からいつでも緊急終了できる`, () => {
      assert.equal(transition(at(status), "emergency_ended").status, "emergency_ended");
    });
  }

  it("緊急終了したあとは薬の選択に進めない", () => {
    assertRuleError(() => transition(at("emergency_ended"), "drug_selection"), "SESSION_ALREADY_ENDED");
  });
});

describe("理解の確認", () => {
  it("理解の確認が済んでいないと会計に進めない", () => {
    assertRuleError(() => transition(at("counseling", false), "checkout"), "UNDERSTANDING_NOT_CONFIRMED");
  });

  it("理解の確認が済めば会計に進める", () => {
    assert.equal(transition(at("counseling", true), "checkout").status, "checkout");
  });
});

describe("通常の流れ", () => {
  it("言語選択から完了まで順番に進める", () => {
    let s = at("language_selection");
    for (const next of [
      "attributes",
      "interview",
      "drug_selection",
      "pharmacist_review",
      "approved",
      "counseling",
    ] as const) {
      s = transition(s, next);
    }
    s = transition({ ...s, understandingConfirmed: true }, "checkout");
    s = transition(s, "completed");
    assert.equal(s.status, "completed");
  });

  it("薬の選択中にチャットへ戻れる", () => {
    assert.equal(transition(at("drug_selection"), "interview").status, "interview");
  });

  it("販売しないと判断して終了できる", () => {
    assert.equal(transition(at("pharmacist_review"), "declined").status, "declined");
  });

  it("完了したセッションは変更できない", () => {
    assertRuleError(() => transition(at("completed"), "counseling"), "SESSION_ALREADY_ENDED");
  });
});

describe("緊急を確認中（emergency_review）：問診を止め、薬剤師の判断で終了か元の画面に戻る（spec.md 決まったこと No.38）", () => {
  const notEnded: SessionStatus[] = [
    "language_selection",
    "attributes",
    "interview",
    "drug_selection",
    "pharmacist_review",
    "approved",
    "counseling",
    "checkout",
  ];

  for (const status of notEnded) {
    it(`${status} の状態からでも、緊急の確認に入れる`, () => {
      const reviewing = transition(at(status), "emergency_review");
      assert.equal(reviewing.status, "emergency_review");
      assert.equal(reviewing.emergencyReturnTo, status);
    });

    it(`${status} から緊急の確認に入り、「緊急ではない」と判断したら ${status} に戻る`, () => {
      const back = transition(transition(at(status), "emergency_review"), status);
      assert.equal(back.status, status);
      assert.equal(back.emergencyReturnTo, undefined);
    });
  }

  it("緊急の確認から、119番の案内を出したら緊急終了になる", () => {
    const ended = transition(transition(at("interview"), "emergency_review"), "emergency_ended");
    assert.equal(ended.status, "emergency_ended");
    assert.equal(ended.emergencyReturnTo, undefined);
  });

  it("緊急の確認中は、確認に入る前の状態以外には進めない（問診を勝手に進めない）", () => {
    const reviewing = transition(at("interview"), "emergency_review");
    assertRuleError(() => transition(reviewing, "drug_selection"), "INVALID_TRANSITION");
    assertRuleError(() => transition(reviewing, "approved"), "INVALID_TRANSITION");
  });

  it("緊急の確認中に、もう一度緊急の確認には入れない", () => {
    const reviewing = transition(at("interview"), "emergency_review");
    assertRuleError(() => transition(reviewing, "emergency_review"), "INVALID_TRANSITION");
  });

  it("緊急の確認中は、印刷・服薬指導・会計ができない", () => {
    const reviewing = transition(at("counseling", true), "emergency_review");
    for (const action of ["print", "counsel", "checkout"] as const) {
      assertRuleError(() => assertActionAllowed(reviewing.status, action), "NOT_APPROVED");
    }
  });

  it("終了したセッションからは、緊急の確認に入れない", () => {
    for (const status of TERMINAL_STATUSES) {
      assertRuleError(() => transition(at(status), "emergency_review"), "SESSION_ALREADY_ENDED");
    }
  });
});

describe("119番の案内の取り消し（押し間違い。11/6 依頼主の判断）", () => {
  /** 問診中 → 緊急の確認 → 119番の案内を出す、で終わった状態 */
  const endedFrom = (status: SessionStatus): SessionSnapshot =>
    transition(transition(at(status), "emergency_review"), "emergency_ended");

  it("取り消すと、問診には戻らず、119番を押す前の「緊急を確認中」（薬剤師の確認）に戻る", () => {
    const back = cancelEmergencyEnd(endedFrom("interview"));
    assert.equal(back.status, "emergency_review");
    assert.equal(back.emergencyReturnTo, "interview");
    assert.equal(back.emergencyCancelReturnTo, undefined);
  });

  it("取り消したあと、薬剤師が「緊急ではない」を選べば元の問診に戻り、「119番の案内を出す」を選べば緊急終了になる", () => {
    const back = cancelEmergencyEnd(endedFrom("interview"));
    assert.equal(transition(back, "interview").status, "interview");
    assert.equal(transition(back, "emergency_ended").status, "emergency_ended");
  });

  it("取り消したあとも、緊急の確認から元の画面以外（承認・薬剤師の確認など）へは進めない", () => {
    const back = cancelEmergencyEnd(endedFrom("interview"));
    assertRuleError(() => transition(back, "approved"), "INVALID_TRANSITION");
    assertRuleError(() => transition(back, "pharmacist_review"), "INVALID_TRANSITION");
  });

  it("戻り先は終了したときの状態の中に残した値だけを使う（外から戻り先を渡して承認などへ飛ばせない）", () => {
    // 緊急の確認を通らずに終わったとき（戻り先が残っていない）は取り消せない
    assertRuleError(() => cancelEmergencyEnd(transition(at("interview"), "emergency_ended")), "INVALID_TRANSITION");
    // 戻り先として承認済みを書き込んだ状態を渡しても、承認済みには戻らない
    const forged: SessionSnapshot = { ...at("emergency_ended"), emergencyCancelReturnTo: "completed" };
    assertRuleError(() => cancelEmergencyEnd(forged), "INVALID_TRANSITION");
  });

  it("緊急終了でなければ取り消せない（完了・販売しない・問診中・緊急を確認中）", () => {
    for (const status of ["completed", "declined", "interview", "emergency_review"] as SessionStatus[]) {
      assertRuleError(() => cancelEmergencyEnd({ ...at(status), emergencyCancelReturnTo: "interview" }), "INVALID_TRANSITION");
    }
  });

  it("同じ「119番の案内」は二度は取り消せない（取り消すと戻り先は消える）", () => {
    const back = cancelEmergencyEnd(endedFrom("interview"));
    assertRuleError(() => cancelEmergencyEnd(back), "INVALID_TRANSITION");
  });
});

describe("工程を戻す（11/7 依頼主の判断）", () => {
  it("承認のあと（承認・服薬指導・会計案内）は、承認を取り消して薬剤師の確認に戻れる。理解の確認も「未」に戻る", () => {
    for (const status of ["approved", "counseling", "checkout"] as SessionStatus[]) {
      const back = undoStep(at(status, true), "cancel_approval");
      assert.equal(back.status, "pharmacist_review");
      assert.equal(back.understandingConfirmed, false);
    }
  });

  it("承認を取り消したあとは、もう一度承認するまで印刷・服薬指導・会計はできない", () => {
    const back = undoStep(at("counseling", true), "cancel_approval");
    assertRuleError(() => assertActionAllowed(back.status, "print"), "NOT_APPROVED");
    assertRuleError(() => assertActionAllowed(back.status, "counsel"), "NOT_APPROVED");
    assertRuleError(() => assertActionAllowed(back.status, "checkout"), "NOT_APPROVED");
  });

  it("承認の前・完了のあとは、承認を取り消せない", () => {
    for (const status of ["interview", "drug_selection", "pharmacist_review", "completed", "declined"] as SessionStatus[]) {
      assertRuleError(() => undoStep(at(status), "cancel_approval"), "INVALID_TRANSITION");
    }
  });

  it("理解の確認は、服薬指導中で確認が済んだあとだけやり直せる。やり直すと会計に進めない", () => {
    const reset = undoStep(at("counseling", true), "reset_understanding");
    assert.equal(reset.status, "counseling");
    assert.equal(reset.understandingConfirmed, false);
    assertRuleError(() => transition(reset, "checkout"), "UNDERSTANDING_NOT_CONFIRMED");
    assertRuleError(() => undoStep(at("counseling", false), "reset_understanding"), "INVALID_TRANSITION");
    assertRuleError(() => undoStep(at("checkout", true), "reset_understanding"), "INVALID_TRANSITION");
  });

  it("会計案内から服薬指導に戻れる（理解の確認はそのまま）。会計案内のときだけ", () => {
    const back = undoStep(at("checkout", true), "back_to_counseling");
    assert.equal(back.status, "counseling");
    assert.equal(back.understandingConfirmed, true);
    assertRuleError(() => undoStep(at("counseling", true), "back_to_counseling"), "INVALID_TRANSITION");
    assertRuleError(() => undoStep(at("completed", true), "back_to_counseling"), "INVALID_TRANSITION");
  });

  it("「販売しない」は取り消して薬剤師の確認に戻れる。ほかの終了（完了・緊急終了）は戻せない", () => {
    assert.equal(undoStep(at("declined"), "cancel_decline").status, "pharmacist_review");
    assertRuleError(() => undoStep(at("completed"), "cancel_decline"), "INVALID_TRANSITION");
    assertRuleError(() => undoStep(at("emergency_ended"), "cancel_decline"), "INVALID_TRANSITION");
  });

  it("ふだんの遷移では、承認のあとから承認の前へ戻れない（戻すのは undoStep だけ）", () => {
    assertRuleError(() => transition(at("counseling", true), "pharmacist_review"), "INVALID_TRANSITION");
    assertRuleError(() => transition(at("checkout", true), "counseling"), "INVALID_TRANSITION");
  });
});
