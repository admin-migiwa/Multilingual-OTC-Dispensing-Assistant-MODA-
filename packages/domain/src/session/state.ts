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
  "emergency_ended", // 緊急症状で終了（記録は残す）
  "declined", // 販売しないと判断して終了（理由を記録）
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const TERMINAL_STATUSES: readonly SessionStatus[] = ["completed", "emergency_ended", "declined"];

/** 承認後の状態。印刷・服薬指導・会計はこの状態でしか行えない。 */
export const POST_APPROVAL_STATUSES: readonly SessionStatus[] = ["approved", "counseling", "checkout", "completed"];

/**
 * 通常の遷移先。
 * - 承認（approved）に入れるのは pharmacist_review からだけ。
 * - 緊急終了（emergency_ended）は、終了していないどの状態からでも入れる（ここには書かず transition で扱う）。
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
  emergency_ended: [],
  declined: [],
};

export interface SessionSnapshot {
  readonly status: SessionStatus;
  /** 患者さんが服薬指導の内容を理解したことを確認済みか */
  readonly understandingConfirmed: boolean;
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
    return { ...current, status: to };
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
