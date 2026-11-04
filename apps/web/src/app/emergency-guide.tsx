"use client";

import type { EmergencyHit } from "@moda/domain";
import { getMessages, needsAiTranslationNotice, type LanguageCode } from "@moda/i18n";

/**
 * 緊急案内の画面（docs/design.md 7節「緊急症状」、CLAUDE.md 絶対に守るルール2）。
 *
 * - 文言は packages/i18n の emergency（emergency.md の EN01〜EN03：119番・#7119・#8000）だけ。
 *   EN04・EN05（外部の多言語窓口）は未確認（☐）なので載せない。
 * - 文言は画面のプログラムに組み込んであり、表示にサーバーへの通信を使わない。
 * - 下半分は薬剤師向けの日本語。言い過ぎで止まった場合は、薬剤師が判断して戻せる。
 */
export function EmergencyGuide({
  language,
  hits,
  onReturn,
}: {
  language: LanguageCode;
  /** キーワードで検知したときの当てはまった項目。緊急ボタンから来たときは空 */
  hits: readonly EmergencyHit[];
  onReturn: () => void;
}) {
  const t = getMessages(language).emergency;
  const ja = getMessages("ja").emergency;

  return (
    <section className="space-y-8" aria-live="assertive">
      <div lang={language} className="space-y-6 rounded-3xl border-4 border-red-700 bg-red-50 p-6">
        <h1 className="text-3xl font-bold text-red-800">{t.title}</h1>
        <p className="text-xl">{t.body}</p>

        <a
          href="tel:119"
          className="flex items-center gap-4 rounded-2xl bg-red-700 px-5 py-4 text-white hover:bg-red-800"
        >
          <span className="text-5xl font-black tracking-wider">119</span>
          <span className="text-lg font-semibold">{t.call119}</span>
        </a>

        <p className="rounded-2xl bg-white px-5 py-4 text-lg font-semibold">{t.staffHelp}</p>

        <ul className="space-y-2 text-base text-slate-700">
          <li>{t.consultLine}</li>
          <li>{t.childLine}</li>
        </ul>

        {needsAiTranslationNotice(language) ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {getMessages(language).common.aiTranslationNotice}
          </p>
        ) : null}
      </div>

      <div lang="ja" className="space-y-3 rounded-2xl border-2 border-slate-300 p-5">
        <h2 className="text-lg font-bold">薬剤師・スタッフの方へ</h2>
        <p className="text-base">{ja.call119}</p>
        {hits.length > 0 ? (
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-600">入力から緊急キーワードを検知しました：</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {hits.map((hit) => (
                <li key={hit.id}>
                  {hit.id}：{hit.labelJa}（「{hit.keyword}」）
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-slate-600">患者さんが「緊急」ボタンを押しました。</p>
        )}
        <p className="text-sm text-slate-600">
          キーワードは見落とさないことを優先しているため、言い過ぎで止まることがあります。緊急でないと判断したときは、下のボタンで戻れます。
        </p>
        <button
          type="button"
          onClick={onReturn}
          className="rounded-xl border-2 border-slate-400 px-4 py-2 text-base font-semibold hover:bg-slate-100"
        >
          薬剤師が確認した：緊急ではないので元の画面に戻る
        </button>
      </div>
    </section>
  );
}
