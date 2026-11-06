/**
 * 緊急の根拠を薬剤師が読むための内容（docs/backlog.md C-08。spec.md 決まったこと No.38）。
 *
 * - 薬剤師の日本語の画面だけが使う。患者さんの画面（PatientView）には入れない。
 * - 入力された文は原文のまま返す（判断の根拠を確かめるため）。ログ・履歴には出さない（CLAUDE.md 絶対に守るルール9）。
 * - 記録を書き換えず、読むだけ。
 */

import { EMERGENCY_RULES } from "@moda/domain";

import type { EmergencyDecision, EmergencyTrigger, RecordedFollowUp, SessionRecord } from "./session-service.ts";

export interface EmergencyEvidenceItem {
  readonly openedAt: string;
  readonly trigger: EmergencyTrigger;
  /** 当てはまった緊急症状の表の項目（ID と薬剤師向けの日本語の説明） */
  readonly matchedRules: readonly { readonly id: string; readonly labelJa: string }[];
  /** 検知のもとになった患者さんの入力（原文。手動で開いたときは null） */
  readonly inputText: string | null;
  /** 緊急の確認画面で送られた内容（起きた順。最後のものが判断のときの内容） */
  readonly followUps: readonly RecordedFollowUp[];
  readonly decision: EmergencyDecision | null;
  readonly decidedAt: string | null;
  readonly cancelledAt: string | null;
}

export interface EmergencyEvidence {
  readonly id: string;
  readonly status: SessionRecord["snapshot"]["status"];
  /** 緊急の記録（起きた順） */
  readonly emergencies: readonly EmergencyEvidenceItem[];
}

function labelOf(id: string): string {
  // 記録には表にある ID しか入れていない（session-service.ts の assertKnownRuleIds）。見つからなければ ID のまま出す
  return EMERGENCY_RULES.find((rule) => rule.id === id)?.labelJa ?? id;
}

export function emergencyEvidence(record: SessionRecord): EmergencyEvidence {
  return {
    id: record.id,
    status: record.snapshot.status,
    emergencies: record.emergencies.map((e) => ({
      openedAt: e.openedAt,
      trigger: e.trigger,
      matchedRules: e.matchedRuleIds.map((id) => ({ id, labelJa: labelOf(id) })),
      inputText: e.inputText,
      followUps: e.followUps,
      decision: e.decision,
      decidedAt: e.decidedAt,
      cancelledAt: e.cancelledAt,
    })),
  };
}
