import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DomainRuleError } from "../errors.ts";
import {
  SESSION_STATUSES,
  TERMINAL_STATUSES,
  assertActionAllowed,
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
