"use client";

/**
 * 販売記録の一覧（T9a）。新しい順に、各記録の版を並べる。読むだけで、書き換えない（CLAUDE.md 絶対に守るルール6）。
 * ハッカソン版はサーバーのメモリにあるので、サーバーを止めると消える（docs/backlog.md S-03）。
 */

import { useEffect, useState } from "react";

import { OVERRIDE_REASONS } from "@moda/domain";

import type { SaleRecord } from "@/server/approval";

import { ModaBrand } from "../../decor";

/** 版を足した理由の表示 */
const REASON_LABELS: Record<string, string> = {
  approved: "承認",
  understanding_confirmed: "理解の確認：済み",
  approval_cancelled: "承認の取り消し",
  reapproved: "もう一度の承認",
  understanding_reset: "理解の確認のやり直し",
};

function time(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function SaleRecords() {
  const [records, setRecords] = useState<readonly SaleRecord[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sales", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { records: SaleRecord[] };
      })
      .then((data) => {
        if (!cancelled) setRecords(data.records);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <header className="space-y-2">
        {/* 前の画面（薬剤師の確認画面など）に戻る。前の画面がなければ最初の画面へ */}
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? window.history.back() : window.location.assign("/"))}
          className="min-h-11 text-lg text-slate-600 underline underline-offset-4"
        >
          ← 戻る
        </button>
        <div className="flex items-center gap-3">
          <ModaBrand />
          <span className="rounded-full bg-indigo-700 px-3 py-1 text-sm font-bold text-white">薬剤師用</span>
        </div>
        <h1 className="text-3xl font-bold">販売記録の一覧</h1>
        <p className="text-sm text-slate-500">
          承認と同時に作った記録です。書き換えず、直すときや理解の確認の結果は新しい版として足します。
        </p>
      </header>
      {failed ? <p className="text-red-900">販売記録を読み込めませんでした（通信を確かめてください）。</p> : null}
      {records === null && !failed ? <p className="text-slate-500">読み込み中…</p> : null}
      {records !== null && records.length === 0 ? <p className="text-slate-600">まだ販売記録はありません。</p> : null}
      <ol className="space-y-4">
        {(records ?? []).map((record) => {
          const latest = record.versions.at(-1);
          return (
            <li key={record.id} className="space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <p className="font-semibold">
                {latest ? time(latest.soldAt) : ""} ／ 販売記録 <span className="font-mono text-sm">{record.id}</span>（版{latest?.version}）
                {latest?.reason === "approval_cancelled" ? <span className="ml-2 rounded bg-red-100 px-2 text-red-900">承認を取り消し中</span> : null}
              </p>
              {latest ? (
                <>
                  <ul className="list-disc pl-6">
                    {latest.items.map((item) => (
                      <li key={item.drugId}>
                        {item.name}（{item.classification}）{item.packageAmount !== null ? `${item.packageAmount}錠入り` : ""} × {item.quantity}
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm text-slate-700">
                    薬剤師：{latest.pharmacist.name} ／ 理解の確認：{latest.understanding === "confirmed" ? "済み" : "未"} ／ 販売手順の版：
                    {latest.procedureEffectiveFrom} 施行 ／ 接客の言語：{latest.language}
                  </p>
                  {latest.overrides.length > 0 ? (
                    <p className="text-sm text-red-900">
                      禁忌の解除：
                      {latest.overrides
                        .map(
                          (o) =>
                            `${o.drugId}（${OVERRIDE_REASONS.find((r) => r.code === o.reasonCode)?.label ?? o.reasonCode}${o.reasonText ? "：" + o.reasonText : ""}／${o.pharmacist.name}）`,
                        )
                        .join("、")}
                    </p>
                  ) : null}
                  {record.versions.length > 1 ? (
                    <details className="text-sm text-slate-600">
                      <summary>版の履歴（{record.versions.length}件）</summary>
                      <ol className="list-decimal pl-6">
                        {record.versions.map((v) => (
                          <li key={v.version}>
                            版{v.version}：{time(v.at)}（{REASON_LABELS[v.reason] ?? v.reason}）
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}
