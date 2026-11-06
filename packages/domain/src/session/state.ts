import { DomainRuleError } from "../errors.ts";

/**
 * 問診セッションの状態。
 * 状態はサーバーが管理し、画面はそれを表示するだけにする（docs/design.md「状態遷移と承認ゲート」）。
 */
export const SESSION_STATUSES = [
  "language_selection", // 言語選択
  "attributes", // 性別・年齢・体重・運転予定の入力
  "interview", // AI 問診
  "drug_selection", // 薬の選択（患者さんと薬剤師で一緒に）
  "pharmacist_review", // 薬剤師だけが見る確認画面
  "approved", // 薬剤師が承認済み（このときに販売記録が作られる）
  "counseling", // 説明書の印刷・服薬指導・理解の確認
  "checkout", // お会計の案内
  "completed", // 完了
  "emergency_review", // 緊急を確認中（問診を止め、薬剤師が根拠を確認している。spec.md 決まったこと No.38）
  "emergency_ended", // 緊急症状で終了（119番・受診の案内を出した。記録は残す）
  "declined", // 販売しないと判断して終了（理由を記録）
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const TERMINAL_STATUSES: readonly SessionStatus[] = ["completed", "emergency_ended", "declined"];

/** 承認後の状態。印刷・服薬指導・会計はこの状態でしか行えない。 */
export const POST_APPROVAL_STATUSES: readonly SessionStatus[] = ["approved", "counseling", "checkout", "completed"];

/**
 * 通常の遷移先。
 * - 承認（approved）に入れるのは pharmacist_review からだけ。
 * - 緊急を確認中（emergency_review）と緊急終了（emergency_ended）は、終了していないどの状態からでも入れる
 *   （ここには書かず transition で扱う）。
 * - 緊急を確認中からは、緊急終了か、確認に入る前の状態（emergencyReturnTo）に戻ることだけができる
 *   （薬剤師が「緊急ではない：元の画面に戻る」を選んだとき）。
 */
const ALLOWED_TRANSITIONS: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  language_selection: ["attributes"],
  attributes: ["interview"],
  interview: ["drug_selection"],
  drug_selection: ["interview", "pharmacist_review", "declined"],
  pharmacist_review: ["drug_selection", "approved", "declined"],
  approved: ["counseling"],
  counseling: ["checkout"],
  checkout: ["completed"],
  completed: [],
  emergency_review: [], // 戻り先は emergencyReturnTo で決まる（transition で扱う）
  emergency_ended: [],
  declined: [],
};

export interface SessionSnapshot {
  readonly status: SessionStatus;
  /** 患者さんが服薬指導の内容を理解したことを確認済みか */
  readonly understandingConfirmed: boolean;
  /** 緊急を確認中のとき、「緊急ではない」と判断したら戻る状態（確認に入る前の状態） */
  readonly emergencyReturnTo?: SessionStatus;
}

export function isTerminal(status: SessionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isPostApproval(status: SessionStatus): boolean {
  return POST_APPROVAL_STATUSES.includes(status);
}

/**
 * 状態を遷移させる。許されない遷移は DomainRuleError を投げる。
 *
 * 注意：承認（approved）への遷移には、ほかにも条件がある
 * （PIN での本人確認、区分ごとの販売手順の完了など）。それらは承認処理の側で
 * 確認したうえでこの関数を呼ぶこと。この関数は「順番」だけを保証する。
 */
export function transition(current: SessionSnapshot, to: SessionStatus): SessionSnapshot {
  if (isTerminal(current.status)) {
    throw new DomainRuleError("SESSION_ALREADY_ENDED", `終了したセッション（${current.status}）は変更できません`);
  }

  if (to === "emergency_ended") {
    return withoutReturn({ ...current, status: to });
  }

  if (to === "emergency_review") {
    if (current.status === "emergency_review") {
      throw new DomainRuleError("INVALID_TRANSITION", "すでに緊急を確認中です");
    }
    return { ...current, status: to, emergencyReturnTo: current.status };
  }

  if (current.status === "emergency_review") {
    // 緊急ではないと判断したときは、確認に入る前の状態にだけ戻れる
    if (current.emergencyReturnTo === undefined || to !== current.emergencyReturnTo) {
      throw new DomainRuleError(
        "INVALID_TRANSITION",
        "緊急の確認からは、緊急終了か、確認に入る前の状態にだけ進めます",
      );
    }
    return withoutReturn({ ...current, status: to });
  }

  const allowed = ALLOWED_TRANSITIONS[current.status];
  if (!allowed.includes(to)) {
    throw new DomainRuleError("INVALID_TRANSITION", `${current.status} から ${to} へは進めません`);
  }

  if (current.status === "counseling" && to === "checkout" && !current.understandingConfirmed) {
    throw new DomainRuleError("UNDERSTANDING_NOT_CONFIRMED", "理解の確認が済むまで会計に進めません");
  }

  return { ...current, status: to };
}

/**
 * 119番の案内を出した（緊急終了）あとに、薬剤師が押し間違いとして取り消し、緊急の確認に入る前の状態に戻す
 * （11/6 依頼主の判断）。
 * - 終了した状態から抜けられるのは、この関数で緊急終了から戻るときだけ（完了・販売しないは戻せない）。
 * - 戻れるのは、緊急の確認に入る前の状態（呼び出す側が記録から渡す）。終了・緊急の状態には戻れない。
 * - 取り消したことと、もとの「119番の案内を出す」の判断は、呼び出す側が記録に足して残す（上書きしない）。
 */
export function cancelEmergencyEnd(current: SessionSnapshot, returnTo: SessionStatus): SessionSnapshot {
  if (current.status !== "emergency_ended") {
    throw new DomainRuleError("INVALID_TRANSITION", "119番の案内を取り消せるのは、緊急終了のときだけです");
  }
  if (isTerminal(returnTo) || returnTo === "emergency_review") {
    throw new DomainRuleError("INVALID_TRANSITION", `取り消したあとに ${returnTo} へは戻れません`);
  }
  return withoutReturn({ ...current, status: returnTo });
}

function withoutReturn(snapshot: SessionSnapshot): SessionSnapshot {
  const rest: { -readonly [K in keyof SessionSnapshot]: SessionSnapshot[K] } = { ...snapshot };
  delete rest.emergencyReturnTo;
  return rest;
}

/** 承認後にだけ行える操作 */
export type PostApprovalAction = "print" | "counsel" | "checkout";

const ACTION_ALLOWED_STATUSES: Readonly<Record<PostApprovalAction, readonly SessionStatus[]>> = {
  // 説明書の印刷は、承認後なら再印刷も含めて何度でもできる
  print: ["approved", "counseling", "checkout"],
  counsel: ["approved", "counseling"],
  checkout: ["checkout"],
};

/**
 * 印刷・服薬指導・会計の API は、処理の最初に必ずこれを呼ぶ。
 * 画面の作りに頼らず、サーバー側で承認ゲートを保証するため。
 */
export function assertActionAllowed(status: SessionStatus, action: PostApprovalAction): void {
  if (!isPostApproval(status)) {
    throw new DomainRuleError("NOT_APPROVED", `薬剤師の承認前は ${action} を行えません`);
  }
  if (!ACTION_ALLOWED_STATUSES[action].includes(status)) {
    throw new DomainRuleError("ACTION_NOT_ALLOWED", `${status} の状態では ${action} を行えません`);
  }
}
