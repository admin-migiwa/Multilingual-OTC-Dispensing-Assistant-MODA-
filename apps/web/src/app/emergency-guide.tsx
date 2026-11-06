"use client";

import { useState, type ReactNode } from "react";

import type { EmergencyHit } from "@moda/domain";
import { LANGUAGES, getMessages, needsAiTranslationNotice, type LanguageCode } from "@moda/i18n";

import { FollowUpPharmacistPanel, type FollowUpState } from "./emergency-follow-up";

/**
 * 緊急の確認を始めたきっかけ。
 * keyword：入力から緊急キーワードを検知／staff：薬剤師が手動で「緊急の確認を開く」を押した
 */
export type EmergencyTrigger =
  | { readonly kind: "keyword"; readonly text: string; readonly hits: readonly EmergencyHit[] }
  | { readonly kind: "staff" };

/**
 * 緊急の確認と緊急案内（docs/design.md 7節「緊急症状」、CLAUDE.md 絶対に守るルール2）。
 *
 * 患者さんと薬剤師が一緒に端末を操作する前提（spec.md 決まったこと No.38）。
 * 1. 確認：問診はもう止まっている。患者さんには母国語で「スタッフがすぐにお手伝いします」とだけ出し、
 *    薬剤師が日本語で根拠（入力した文・当てはまった項目）を見て、119番の案内を出すか、元の画面に戻るかを選ぶ。
 * 2. 案内：薬剤師が「119番の案内を出す」を選んだら、患者さんの言語で119番と受診を案内する。
 *
 * - 言語を選ぶ前に開いたとき（language が null）は、「スタッフがすぐにお手伝いします」を全言語で並べ、
 *   薬剤師が患者さんの言語を選べるようにする（選ぶと質問と119番の案内を母国語で出せる）。
 * - 文言は packages/i18n の emergency（emergency.md の EN01〜EN03：119番・#7119・#8000）だけ。
 *   EN04・EN05（外部の多言語窓口）は未確認（☐）なので載せない。
 * - 文言は画面のプログラムに組み込んであり、表示にサーバーへの通信を使わない。
 * - デモで電話がかからないように、119 は電話のリンクにしない（ただの文字）。
 */
export function EmergencyGuide({
  language,
  onLanguageChange,
  trigger,
  followUp,
  onFollowUpChange,
  onReturn,
}: {
  /** 患者さんの言語。言語を選ぶ前に開いたときは null */
  language: LanguageCode | null;
  onLanguageChange: (language: LanguageCode) => void;
  trigger: EmergencyTrigger;
  /** 追加の質問の答えと観察の印。問診の内容として残すため、呼び出し側が持つ（元の画面に戻っても消えない） */
  followUp: FollowUpState;
  onFollowUpChange: (next: FollowUpState) => void;
  onReturn: () => void;
}) {
  const [step, setStep] = useState<"confirm" | "guide">("confirm");

  const aiNotice =
    language !== null && needsAiTranslationNotice(language) ? (
      <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {getMessages(language).common.aiTranslationNotice}
      </p>
    ) : null;

  const languagePicker =
    language === null ? (
      <div className="space-y-2 rounded-2xl bg-slate-50 p-4">
        <p className="text-base font-bold">患者さんの言語を選んでください（質問と119番の案内を母国語で出します）</p>
        <ul className="grid grid-cols-3 gap-2">
          {LANGUAGES.map((lang) => (
            <li key={lang.code}>
              <button
                type="button"
                lang={lang.code}
                onClick={() => onLanguageChange(lang.code)}
                className="w-full rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-base font-semibold hover:border-teal-600 hover:bg-teal-50"
              >
                {lang.nativeName}
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  if (step === "confirm") {
    return (
      <section className="space-y-8" aria-live="assertive">
        <div className="space-y-4 rounded-3xl border-4 border-amber-500 bg-amber-50 p-6">
          {language === null ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {LANGUAGES.map((lang) => (
                <li key={lang.code} lang={lang.code} className="text-lg font-bold">
                  {getMessages(lang.code).emergency.staffHelp}
                </li>
              ))}
            </ul>
          ) : (
            <p lang={language} className="text-2xl font-bold">
              {getMessages(language).emergency.staffHelp}
            </p>
          )}
          {aiNotice}
        </div>

        <div lang="ja" className="space-y-4 rounded-2xl border-2 border-slate-300 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">薬剤師の確認：119番の案内を出しますか？</h2>
            {/* 明らかに救急のときに、下まで操作せずにすぐ案内へ進めるように上にも置く */}
            <button
              type="button"
              onClick={() => setStep("guide")}
              className="rounded-2xl bg-red-700 px-4 py-3 text-base font-bold text-white hover:bg-red-800"
            >
              119番の案内を出す
            </button>
          </div>
          <p className="text-sm text-slate-600">問診は止めてあります。下の根拠を確認して、どちらかを選んでください。</p>

          {languagePicker}

          {trigger.kind === "keyword" ? (
            <dl className="space-y-3">
              <div>
                <dt className="text-sm font-semibold text-slate-600">患者さんが入力した文</dt>
                <dd lang={language ?? undefined} className="mt-1 rounded-xl bg-slate-100 px-4 py-2 text-lg">
                  {trigger.text}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-600">当てはまった緊急症状（docs/demo-data/emergency.md）</dt>
                <dd>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-base">
                    {trigger.hits.map((hit) => (
                      <li key={hit.id}>
                        {hit.id}：{hit.labelJa}（見つかった言葉：「{hit.keyword}」）
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-base">薬剤師が「緊急の確認を開く」を押しました。患者さんの様子を確認してください。</p>
          )}

          {trigger.kind === "keyword" ? (
            <p className="text-sm text-slate-600">
              キーワードは見落とさないことを優先しているため、言い過ぎで当てはまることがあります。
            </p>
          ) : null}

          {language !== null ? (
            <FollowUpPharmacistPanel language={language} state={followUp} onChange={onFollowUpChange} />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setStep("guide")}
              className="rounded-2xl bg-red-700 px-4 py-4 text-lg font-bold text-white hover:bg-red-800"
            >
              119番の案内を出す
            </button>
            <button
              type="button"
              onClick={onReturn}
              className="rounded-2xl border-2 border-slate-400 px-4 py-4 text-lg font-semibold hover:bg-slate-100"
            >
              緊急ではない：元の画面に戻る
            </button>
          </div>
        </div>
      </section>
    );
  }

  const jaEmergency = getMessages("ja").emergency;

  return (
    <section className="space-y-8" aria-live="assertive">
      {language === null ? (
        <div className="space-y-4 rounded-3xl border-4 border-red-700 bg-red-50 p-6">
          <div className="flex items-center gap-4 rounded-2xl bg-red-700 px-5 py-4 text-white">
            <span className="text-5xl font-black tracking-wider">119</span>
          </div>
          <div lang="ja">{languagePicker}</div>
        </div>
      ) : (
        <GuideBody language={language} aiNotice={aiNotice} />
      )}

      <div lang="ja" className="space-y-3 rounded-2xl border-2 border-slate-300 p-5">
        <p className="text-base">{jaEmergency.call119}</p>
        <button
          type="button"
          onClick={() => setStep("confirm")}
          className="rounded-xl border-2 border-slate-400 px-4 py-2 text-base font-semibold hover:bg-slate-100"
        >
          薬剤師の確認に戻る
        </button>
      </div>
    </section>
  );
}

/** 患者さんの言語の119番の案内 */
function GuideBody({ language, aiNotice }: { language: LanguageCode; aiNotice: ReactNode }) {
  const t = getMessages(language).emergency;
  return (
    <div lang={language} className="space-y-6 rounded-3xl border-4 border-red-700 bg-red-50 p-6">
      <h1 className="text-3xl font-bold text-red-800">{t.title}</h1>
      <p className="text-xl">{t.body}</p>

      <div className="flex items-center gap-4 rounded-2xl bg-red-700 px-5 py-4 text-white">
        <span className="text-5xl font-black tracking-wider">119</span>
        <span className="text-lg font-semibold">{t.call119}</span>
      </div>

      <p className="rounded-2xl bg-white px-5 py-4 text-lg font-semibold">{t.staffHelp}</p>

      <ul className="space-y-2 text-base text-slate-700">
        <li>{t.consultLine}</li>
        <li>{t.childLine}</li>
      </ul>

      {aiNotice}
    </div>
  );
}
