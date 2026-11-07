import { EMERGENCY_RULES } from "@moda/domain";

import { handle } from "@/server/http";
import { defaultDeps, getSession } from "@/server/session-service";

export const dynamic = "force-dynamic";

/**
 * 翻訳のチャットの記録（原文・訳・訳し戻し。起きた順）。backlog S-13。
 * チャットは患者さんと薬剤師が一緒に見る画面なので、両方の画面のチャットがこれを読んで、前の会話を出す（画面を移っても消えないように）
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => ({
    entries: (getSession(defaultDeps(), id).chatLog ?? []).map((entry) => ({
      ...entry,
      emergencyLabelsJa: entry.emergencyRuleIds.map((ruleId) => EMERGENCY_RULES.find((rule) => rule.id === ruleId)?.labelJa ?? ruleId),
    })),
  }));
}
