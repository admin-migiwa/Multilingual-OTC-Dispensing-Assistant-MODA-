"use client";

/**
 * 患者さんの画面の、説明書と理解の確認の下に置く「薬剤師用」の欄（日本語・たたんでおく）。
 *
 * 説明を始めたあと、薬剤師の画面に戻らずに、会計の前の手順の ✓ と「会計案内に進む」を押せるようにする
 * （iPad の受け渡しを減らすため。11/7 依頼主の判断。患者さんと薬剤師は一緒に端末を操作する。spec.md 決まったこと No.38）。
 *
 * - ボタンの置き場所を変えるだけ。承認のあとか・理解の確認と手順の ✓ がそろったかは、いままでどおりサーバーが確かめる
 *   （CLAUDE.md 絶対に守るルール1。apps/web/src/server/guidance.ts の proceedCheckout）。
 * - 出すのは日本語の手順の名前と「もう一度説明してください」の注意だけ。候補の薬・禁忌の判定などは出さない。
 */

import { useEffect, useState } from "react";

import { pharmacistApi, type PharmacistView } from "./pharmacist/pharmacist-api";
import { NetworkError, RuleError } from "./session-api";

export function StaffAfterApprovalPanel({
  sessionId,
  refreshKey,
  onCheckout,
}: {
  sessionId: string;
  /** 変わったら、サーバーの今の内容を読み直す（患者さんが理解の確認に答えたときなど） */
  refreshKey: string;
  /** 会計案内に進んだあと、患者さんの画面を読み直す */
  onCheckout: () => void;
}) {
  const [view, setView] = useState<PharmacistView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<PharmacistView>): Promise<PharmacistView | null> {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setView(next);
      return next;
    } catch (e: unknown) {
      if (e instanceof RuleError) {
        setError(`いまの状態ではこの操作はできません（${e.code}）。手順と理解の確認がそろっているか確かめてください。`);
        try {
          setView(await pharmacistApi.get(sessionId));
        } catch {
          /* 読み直せなければ、前の表示のまま知らせる */
        }
      } else if (e instanceof NetworkError) {
        setError("通信が止まりました。記録に残っていない可能性があります。通信を確かめて、もう一度押してください。");
      } else {
        setError("想定していないエラーです。");
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void run(() => pharmacistApi.get(sessionId));
  }, [sessionId, refreshKey]);

  const after = view?.afterApproval ?? null;
  // 画面でも、理解の確認と手順の ✓ がそろうまで押せなくする（最後に止めるのはサーバー）
  const allDone = after !== null && after.understanding === "confirmed" && after.steps.every((s) => s.done);
  const needsAgain = after !== null && after.understanding !== "confirmed" && after.lastNotUnderstood !== null;

  return (
    <details lang="ja" open={needsAgain || after?.understanding === "confirmed"} className="rounded-2xl border border-teal-300 bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold text-teal-900">薬剤師用：会計の前の手順と会計案内</summary>
      <div className="mt-3 space-y-3 text-sm">
        {error ? (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-900">
            {error}
          </p>
        ) : null}
        {view === null || after === null ? (
          <p className="text-slate-500">読み込み中…</p>
        ) : (
          <>
            <p className="font-semibold">
              理解の確認：
              {after.understanding === "confirmed" ? "済み（患者さんが「わかった」と答えました）" : "まだ（上で患者さんに答えてもらいます）"}
            </p>
            {needsAgain ? (
              <p className="text-amber-900">
                患者さんの答え：{after.lastNotUnderstood === "partly" ? "少しわからないところがある" : "わからなかった"}。もう一度説明してください（翻訳のチャットも使えます）。
              </p>
            ) : null}
            {after.steps.length > 0 ? (
              <ul className="space-y-2">
                {after.steps.map((step) => (
                  <li key={step.id}>
                    <label className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-5 w-5"
                        checked={step.done}
                        disabled={busy || step.byPatient}
                        onChange={(e) => void run(() => pharmacistApi.checkPostStep(sessionId, step.id, e.target.checked))}
                      />
                      <span>
                        {step.label}
                        {step.byPatient ? <span className="ml-2 text-xs text-slate-500">（患者さんの答えで記録します）</span> : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {view.status === "counseling" ? (
              <button
                type="button"
                disabled={busy || !allDone}
                onClick={() =>
                  void (async () => {
                    const next = await run(() => pharmacistApi.checkout(sessionId));
                    if (next !== null) onCheckout();
                  })()
                }
                className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                会計案内に進む
              </button>
            ) : null}
            {view.status === "counseling" && !allDone ? (
              <p className="text-amber-900">会計の前の手順と理解の確認がそろうまで、会計案内に進めません。</p>
            ) : null}
            <a
              href={`/pharmacist/${encodeURIComponent(sessionId)}`}
              className="inline-block rounded-lg border border-teal-400 px-3 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-50"
            >
              薬剤師の確認の画面を開く（説明書の作り直し・印刷など）
            </a>
          </>
        )}
      </div>
    </details>
  );
}
