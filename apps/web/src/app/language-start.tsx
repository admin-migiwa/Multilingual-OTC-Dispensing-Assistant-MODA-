"use client";

import { useState } from "react";

import { LANGUAGES, getMessages, needsAiTranslationNotice, type LanguageCode } from "@moda/i18n";

/**
 * 言語選択と、最初の案内（T3：言語を切り替えると文が変わることの確認用）。
 * 「ほしい薬がある」「症状から探す」から先の画面は T7 で作る。まだボタンを押しても先に進まない。
 */
export function LanguageStart() {
  const [selected, setSelected] = useState<LanguageCode | null>(null);

  if (selected === null) {
    return (
      <>
        <header className="space-y-2 text-center">
          <p className="text-sm font-semibold tracking-widest text-teal-700">MODA</p>
          <h1 className="text-3xl font-bold">{getMessages("ja").languageSelect.title}</h1>
          <p lang="en" className="text-lg text-slate-600">
            {getMessages("en").languageSelect.title}
          </p>
        </header>

        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {LANGUAGES.map((lang) => (
            <li key={lang.code}>
              <button
                type="button"
                lang={lang.code}
                onClick={() => setSelected(lang.code)}
                className="flex min-h-20 w-full items-center justify-center rounded-2xl border-2 border-slate-200 px-4 text-xl font-semibold transition hover:border-teal-600 hover:bg-teal-50 focus-visible:outline-4 focus-visible:outline-teal-600"
              >
                {lang.nativeName}
              </button>
            </li>
          ))}
        </ul>
      </>
    );
  }

  const t = getMessages(selected);

  return (
    <section lang={selected} className="space-y-8">
      <header className="space-y-2 text-center">
        <p className="text-sm font-semibold tracking-widest text-teal-700">MODA</p>
        <p className="text-base text-slate-500">{t.languageSelect.selected}</p>
        <h1 className="text-3xl font-bold">{t.start.title}</h1>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          className="flex min-h-28 flex-col items-start justify-center gap-1 rounded-2xl border-2 border-slate-200 px-5 py-4 text-left transition hover:border-teal-600 hover:bg-teal-50"
        >
          <span className="text-xl font-semibold">{t.start.haveProduct}</span>
          <span className="text-sm text-slate-600">{t.start.haveProductHint}</span>
        </button>
        <button
          type="button"
          className="flex min-h-28 flex-col items-start justify-center gap-1 rounded-2xl border-2 border-slate-200 px-5 py-4 text-left transition hover:border-teal-600 hover:bg-teal-50"
        >
          <span className="text-xl font-semibold">{t.start.findBySymptom}</span>
          <span className="text-sm text-slate-600">{t.start.findBySymptomHint}</span>
        </button>
      </div>

      <button
        type="button"
        className="w-full rounded-2xl bg-red-700 px-5 py-4 text-xl font-bold text-white transition hover:bg-red-800"
      >
        {t.common.emergencyButton}
      </button>

      {needsAiTranslationNotice(selected) ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{t.common.aiTranslationNotice}</p>
      ) : null}

      <button
        type="button"
        onClick={() => setSelected(null)}
        className="text-base text-slate-600 underline underline-offset-4"
      >
        {t.common.back}
      </button>
    </section>
  );
}
