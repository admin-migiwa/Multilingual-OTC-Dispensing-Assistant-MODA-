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
 * - 文言は packages/i18n の emergency（emergency.md の EN01〜EN04：119番・#7119・#8000・
 *   JNTO の Japan Visitor Hotline）だけ。EN04 は11/6 に薬剤師が確認した（backlog V-01・C-12）。
 *   EN05（在日の方向けの窓口）は未選定（☐）なので、窓口そのものは載せない（一覧のページは EP03 として下で紹介する）。
 * - その下に、参考になるページ（emergency.md の EP01〜EP03。11/6 依頼主の判断）を紹介する。
 * - 文言は画面のプログラムに組み込んであり、表示にサーバーへの通信を使わない。
 * - デモで電話がかからないように、119 や窓口の番号は電話のリンクにしない（ただの文字）。
 *   参考のページの URL も、押して画面が切り替わらないように、ただの文字で出す。
 */
export function EmergencyGuide({
  language,
  onLanguageChange,
  trigger,
  followUp,
  onFollowUpChange,
  onReturn,
  onShowGuide,
  onCancelGuide,
}: {
  /** 患者さんの言語。言語を選ぶ前に開いたときは null */
  language: LanguageCode | null;
  onLanguageChange: (language: LanguageCode) => void;
  trigger: EmergencyTrigger;
  /** 追加の質問の答えと観察の印。問診の内容として残すため、呼び出し側が持つ（元の画面に戻っても消えない） */
  followUp: FollowUpState;
  onFollowUpChange: (next: FollowUpState) => void;
  onReturn: () => void;
  /** 薬剤師が「119番の案内を出す」を選んだとき（記録に残すため）。表示はこの呼び出しの成否にかかわらず切り替える */
  onShowGuide?: () => void;
  /**
   * 薬剤師が「119番の案内」を押し間違えて取り消すとき（11/6 依頼主の判断）。
   * true を返したら、119番を押す前の確認の画面に戻す。false（取り消しを記録できなかった）なら案内のままにする
   */
  onCancelGuide?: () => Promise<boolean>;
}) {
  const [cancelFailed, setCancelFailed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
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
              onClick={() => {
                setStep("guide");
                setCancelFailed(false);
                onShowGuide?.();
              }}
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
              onClick={() => {
                setStep("guide");
                setCancelFailed(false);
                onShowGuide?.();
              }}
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
        {cancelFailed ? (
          <p className="text-sm text-slate-700">取り消しを記録できませんでした。通信を確かめて、もう一度押してください。</p>
        ) : null}
        <button
          type="button"
          onClick={() => {
            // 押し間違い：取り消して、119番を押す前の薬剤師の確認に戻す（問診には戻らない。「緊急ではない」の判断ではない）
            const cancel = onCancelGuide ?? (() => Promise.resolve(true));
            setCancelling(true);
            void cancel().then((ok) => {
              setCancelling(false);
              setCancelFailed(!ok);
              if (ok) setStep("confirm");
            });
          }}
          disabled={cancelling}
          className="disabled:opacity-50 rounded-xl border-2 border-slate-400 px-4 py-2 text-base font-semibold hover:bg-slate-100"
        >
          押し間違い：119番の案内を取り消して、確認に戻る
        </button>
      </div>
    </section>
  );
}

/**
 * 参考になるページ（docs/demo-data/emergency.md の EP01〜EP03。11/6 依頼主の判断）。
 * URL はどの言語でも同じなので、ここに1か所だけ置く。説明の文は packages/i18n の emergency にある。
 */
export const INFO_PAGES = [
  // EP01（EN01 の119番）：総務省消防庁「救急車利用マニュアル」
  { label: "ambulanceGuidePage", url: "https://www.fdma.go.jp/publication/portal/post2.html" },
  // EP02（EN04）：JNTO「Japan Visitor Hotline」の案内
  { label: "visitorHotlinePage", url: "https://www.jnto.go.jp/projects/visitor-support/safetravelinfo.html" },
  // EP03（EN05 の探し先）：CLAIR「多言語生活相談窓口 一覧」
  { label: "residentConsultationPage", url: "https://www.clair.or.jp/j/multiculture/association/consultation_list.html" },
] as const;

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
        <li>{t.visitorHotline}</li>
      </ul>

      <div className="space-y-2 text-base text-slate-700">
        <p className="font-semibold">{t.infoPagesTitle}</p>
        <ul className="space-y-2">
          {INFO_PAGES.map((page) => (
            <li key={page.url}>
              {t[page.label]}
              {/* デモで画面が切り替わらないように、押して開くリンクにしない */}
              <span lang="en" className="block break-all text-sm">
                {page.url}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {aiNotice}
    </div>
  );
}
