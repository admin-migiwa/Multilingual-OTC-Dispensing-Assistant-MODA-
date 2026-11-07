/**
 * 禁忌の解除の理由（design.md「禁忌の判定と解除」の理由リスト＋11/7 依頼主の判断。backlog C-14）。
 *
 * - 禁忌の薬は既定で選べない。薬剤師が PIN で再認証し、ここから理由を選んで解除する（CLAUDE.md 絶対に守るルール4）。
 * - 「その他」は自由記述が必須。
 * - 「聞き取りと違った」を選んでも、問診の答えの訂正はここではしない（backlog に残す）。
 * - 理由リストは施行日つきの版で持つ（design.md 5節「禁忌解除の理由リスト」）。いまは版が1つ。
 */

import { DomainRuleError } from "../errors.ts";

export const OVERRIDE_REASONS_EFFECTIVE_FROM = "2026-11-07";

export const OVERRIDE_REASONS = [
  { code: "answer_differed", label: "問診の聞き取りと実際の状況が違った", requiresText: false },
  { code: "doctor_approved", label: "医師の指示・了承がある", requiresText: false },
  { code: "confirmed_not_applicable", label: "該当しないことを口頭で確認した", requiresText: false },
  // 11/7 依頼主の判断：いま飲んでいる薬で併用の禁忌になっても、前の薬をやめて今回の薬に切り替えるだけのことがある（例：K11）
  { code: "switching_not_combined", label: "切り替えるため併用しない", requiresText: false },
  { code: "other", label: "その他", requiresText: true },
] as const;

export type OverrideReasonCode = (typeof OVERRIDE_REASONS)[number]["code"];

/** 自由記述の長さの上限 */
export const MAX_OVERRIDE_TEXT_LENGTH = 200;

/** 理由が決められた形か（理由リストにあるか、「その他」なら文があるか）を確かめ、記録する文を返す */
export function checkOverrideReason(code: string, text: string | null): { code: OverrideReasonCode; text: string | null } {
  const reason = OVERRIDE_REASONS.find((r) => r.code === code);
  if (!reason) throw new DomainRuleError("OVERRIDE_REASON_INVALID", "禁忌の解除の理由がリストにありません");
  const trimmed = text?.trim() ?? "";
  if (trimmed.length > MAX_OVERRIDE_TEXT_LENGTH) {
    throw new DomainRuleError("OVERRIDE_REASON_INVALID", "禁忌の解除の理由の文が長すぎます");
  }
  if (reason.requiresText && trimmed === "") {
    throw new DomainRuleError("OVERRIDE_REASON_INVALID", "「その他」の理由を書いてください");
  }
  return { code: reason.code, text: trimmed === "" ? null : trimmed };
}
