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
  /**
   * 緊急の確認から「119番の案内を出す」で緊急終了になったとき、押し間違いで取り消したら戻す先
   * （確認に入る前の状態）。この状態の中にだけ持ち、外からは渡させない（cancelEmergencyEnd で使う）
   */
  readonly emergencyCancelReturnTo?: SessionStatus;
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
    const ended = withoutReturn({ ...current, status: to });
    // 緊急の確認から終了したときだけ、押し間違いの取り消し用に戻り先を残す
    return current.status === "emergency_review" && current.emergencyReturnTo !== undefined
      ? { ...ended, emergencyCancelReturnTo: current.emergencyReturnTo }
      : ended;
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
 * 「119番の案内を出す」を薬剤師が押し間違えたときに取り消し、押す前の「緊急を確認中」に戻す（11/6 依頼主の判断）。
 * 押し間違いは「緊急ではない」という判断ではないので、問診には戻さず、薬剤師の確認の画面に戻す。
 * - 終了した状態から抜けられるのは、この関数で緊急終了から戻るときだけ（完了・販売しないは戻せない）。
 * - 戻り先は、緊急の確認に入る前の状態。終了したときに状態の中に残した値（emergencyCancelReturnTo）だけを使い、
 *   外からは渡させない（承認などへ飛ばせないように）。あとで「緊急ではない」を選ぶとそこに戻る。
 * - 緊急の確認を通らずに緊急終了になったとき（戻り先がないとき）は取り消せない。
 * - 取り消したことと、もとの「119番の案内を出す」の判断は、呼び出す側が記録に足して残す（上書きしない）。
 */
export function cancelEmergencyEnd(current: SessionSnapshot): SessionSnapshot {
  if (current.status !== "emergency_ended") {
    throw new DomainRuleError("INVALID_TRANSITION", "119番の案内を取り消せるのは、緊急終了のときだけです");
  }
  const returnTo = current.emergencyCancelReturnTo;
  if (returnTo === undefined || isTerminal(returnTo) || returnTo === "emergency_review") {
    throw new DomainRuleError("INVALID_TRANSITION", "取り消して戻れる緊急の確認がありません");
  }
  const rest: { -readonly [K in keyof SessionSnapshot]: SessionSnapshot[K] } = { ...current };
  delete rest.emergencyCancelReturnTo;
  return { ...rest, status: "emergency_review", emergencyReturnTo: returnTo };
}

/**
 * 薬剤師が工程を1つ戻す操作（11/7 依頼主の判断：どの工程でも間違いは起こりうるので戻せるようにする。PIN は求めない）。
 * ふだんの遷移（ALLOWED_TRANSITIONS）とは分け、この関数でだけ後ろに戻す（承認の前へ勝手に戻らないように）。
 * - cancel_approval：承認を取り消す（承認・服薬指導・会計案内 → 薬剤師の確認）。理解の確認も「未」に戻す。
 *   販売記録は消さず、呼び出す側が「取り消した」版を足す（ルール6）。もう一度承認するまで印刷・服薬指導・会計はできない（ルール1）
 * - reset_understanding：理解の確認をやり直す（服薬指導中で、確認が済んだあと）。呼び出す側が販売記録に版を足す
 * - back_to_counseling：会計案内から服薬指導に戻る（理解の確認はそのまま）
 * - cancel_decline：「販売しない」を取り消して、薬剤師の確認に戻す（終了した状態から抜けるのはここと cancelEmergencyEnd だけ）
 * - 完了（completed）からは戻さない（販売を終えたあと。直すときは販売記録に新しい版を足す）
 */
export type UndoStep = "cancel_approval" | "reset_understanding" | "back_to_counseling" | "cancel_decline";

const UNDO_FROM: Readonly<Record<UndoStep, readonly SessionStatus[]>> = {
  cancel_approval: ["approved", "counseling", "checkout"],
  reset_understanding: ["counseling"],
  back_to_counseling: ["checkout"],
  cancel_decline: ["declined"],
};

export function undoStep(current: SessionSnapshot, step: UndoStep): SessionSnapshot {
  if (!UNDO_FROM[step].includes(current.status)) {
    throw new DomainRuleError("INVALID_TRANSITION", `${current.status} の状態では ${step} で戻せません`);
  }
  switch (step) {
    case "cancel_approval":
      return { ...current, status: "pharmacist_review", understandingConfirmed: false };
    case "reset_understanding":
      if (!current.understandingConfirmed) {
        throw new DomainRuleError("INVALID_TRANSITION", "理解の確認はまだ済んでいません");
      }
      return { ...current, understandingConfirmed: false };
    case "back_to_counseling":
      return { ...current, status: "counseling" };
    case "cancel_decline":
      return { ...current, status: "pharmacist_review" };
  }
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
