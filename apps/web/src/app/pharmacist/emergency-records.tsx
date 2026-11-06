"use client";

/**
 * 薬剤師の画面の「緊急の確認の記録」（日本語だけ。docs/backlog.md C-08）。
 * 入力された文・当てはまった項目・追加の答え・判断を、記録の順に読むだけ（書き換えない）。
 */

import { useEffect, useState } from "react";

import type { EmergencyEvidence } from "@/server/emergency-evidence";

const TRIGGER: Record<string, string> = {
  keyword: "緊急キーワードの検知",
  staff: "薬剤師が手動で開いた",
  ai: "AI の緊急の知らせ（翻訳のチャット）",
};
const DECISION: Record<string, string> = { show_119: "119番の案内を出す", not_emergency: "緊急ではない" };

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function EmergencyRecords({ sessionId, refreshKey }: { sessionId: string; refreshKey: string }) {
  const [evidence, setEvidence] = useState<EmergencyEvidence | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/pharmacist/emergency-evidence`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as EmergencyEvidence;
      })
      .then((data) => {
        if (!cancelled) {
          setEvidence(data);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  if (failed) {
    return <p className="text-sm text-red-900">緊急の確認の記録を読み込めませんでした（通信を確かめてください）。</p>;
  }
  if (evidence === null || evidence.emergencies.length === 0) return null;

  return (
    <section className="space-y-3 rounded-2xl border border-red-200 p-5">
      <h2 className="text-xl font-bold">緊急の確認の記録（{evidence.emergencies.length}件）</h2>
      <ol className="space-y-3">
        {evidence.emergencies.map((e, i) => {
          const last = e.followUps.at(-1);
          return (
            <li key={`${e.openedAt}-${i}`} className="space-y-1 rounded-xl bg-red-50 p-3 text-sm">
              <p className="font-semibold">
                {time(e.openedAt)} {TRIGGER[e.trigger] ?? e.trigger} → 判断：
                {e.decision ? `${DECISION[e.decision] ?? e.decision}（${e.decidedAt ? time(e.decidedAt) : ""}）` : "まだ"}
                {e.cancelledAt ? `／押し間違いとして取り消し（${time(e.cancelledAt)}）` : ""}
              </p>
              {e.inputText ? (
                <p>
                  入力された文：<span className="rounded bg-yellow-50 px-1">「{e.inputText}」</span>
                  <span className="ml-2 text-xs text-slate-500">原文のまま</span>
                </p>
              ) : null}
              {e.matchedRules.length > 0 ? (
                <p>当てはまった項目：{e.matchedRules.map((r) => `${r.id} ${r.labelJa}`).join("、")}</p>
              ) : null}
              {last ? (
                <p>
                  追加の答え：
                  {Object.entries(last.answers)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("、") || "なし"}
                  ／つらさ：{last.scale ?? "なし"}／観察の印：{last.observedRuleIds.join("、") || "なし"}
                  {e.followUps.length > 1 ? `（送り直し ${e.followUps.length} 回。最後の内容）` : ""}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
