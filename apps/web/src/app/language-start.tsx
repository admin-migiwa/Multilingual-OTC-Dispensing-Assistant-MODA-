"use client";

import { useState, type FormEvent } from "react";

import { detectEmergency, type EmergencyHit } from "@moda/domain";
import { LANGUAGES, getMessages, needsAiTranslationNotice, type LanguageCode } from "@moda/i18n";

import { EmergencyGuide } from "./emergency-guide";

/**
 * 言語選択と、最初の案内（T3：言語を切り替えると文が変わることの確認用）。
 * 「ほしい薬がある」「症状から探す」から先の画面は T7 で作る。まだボタンを押しても先に進まない。
 *
 * T6：「具合が急に悪くなった」ボタンと、確認用の入力欄（緊急キーワードの判定）から緊急案内に切り替わる。
 * 判定と案内の表示は、この端末（ブラウザ）の中だけで行い、サーバーへの通信を使わない（絶対に守るルール2）。
 */
export function LanguageStart() {
  const [selected, setSelected] = useState<LanguageCode | null>(null);
  /** null：緊急案内を出していない／配列：緊急案内を出している（緊急ボタンのときは空の配列） */
  const [emergencyHits, setEmergencyHits] = useState<readonly EmergencyHit[] | null>(null);

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

  if (emergencyHits !== null) {
    return <EmergencyGuide language={selected} hits={emergencyHits} onReturn={() => setEmergencyHits(null)} />;
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
        onClick={() => setEmergencyHits([])}
        className="w-full rounded-2xl bg-red-700 px-5 py-4 text-xl font-bold text-white transition hover:bg-red-800"
      >
        {t.common.emergencyButton}
      </button>

      <EmergencyCheckBox language={selected} onEmergency={setEmergencyHits} />

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

/**
 * 確認用の入力欄（T6）。T7 で問診の画面ができるまでの仮のもの。
 * 「胸が痛い」などを入れて「判定する」を押すと、緊急キーワードに当てはまれば緊急案内に切り替わる。
 * 入力した文はどこにも送らず、保存もしない。
 */
function EmergencyCheckBox({
  language,
  onEmergency,
}: {
  language: LanguageCode;
  onEmergency: (hits: readonly EmergencyHit[]) => void;
}) {
  const [text, setText] = useState("");
  const [age, setAge] = useState("");
  const [noMatch, setNoMatch] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAge = age.trim() === "" ? undefined : Number(age);
    const detection = detectEmergency(text, { language, age: parsedAge });
    if (detection.isEmergency) {
      setNoMatch(false);
      onEmergency(detection.hits);
    } else {
      setNoMatch(true);
    }
  }

  return (
    <form lang="ja" onSubmit={handleSubmit} className="space-y-3 rounded-2xl border-2 border-dashed border-slate-300 p-4">
      <p className="text-sm font-semibold text-slate-600">
        確認用：症状を入力（問診の画面ができるまでの仮の入力欄。入力した文は送信も保存もしません）
      </p>
      <label className="block space-y-1">
        <span className="text-sm text-slate-600">症状（選んだ言語か日本語で）</span>
        <input
          type="text"
          lang={language}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setNoMatch(false);
          }}
          className="w-full rounded-xl border-2 border-slate-300 px-3 py-2 text-lg"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-slate-600">年齢（わかれば。15歳以下ならこどもの項目も判定します）</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={130}
          value={age}
          onChange={(event) => setAge(event.target.value)}
          className="w-32 rounded-xl border-2 border-slate-300 px-3 py-2 text-lg"
        />
      </label>
      <div className="flex items-center gap-4">
        <button
          type="submit"
          className="rounded-xl bg-slate-800 px-4 py-2 text-base font-semibold text-white hover:bg-slate-900"
        >
          判定する
        </button>
        {noMatch ? <span className="text-sm text-slate-600">緊急キーワードは見つかりませんでした。</span> : null}
      </div>
    </form>
  );
}
