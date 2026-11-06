"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { STOCKED_DRUGS, detectEmergency, type InterviewAnswers, type StockedDrugId } from "@moda/domain";
import { LANGUAGES, getMessages, needsAiTranslationNotice, type LanguageCode } from "@moda/i18n";

import { EMPTY_FOLLOW_UP, type FollowUpState } from "./emergency-follow-up";
import { EmergencyGuide, type EmergencyTrigger } from "./emergency-guide";
import { QuestionInput } from "./question-input";
import { RuleError, sessionApi, type PatientView } from "./session-api";

/**
 * 患者さんの画面（T7c）：言語選択 → 年齢・性別 → 1問ずつの問診 → ほしい薬／症状から探す → その薬の問診 → 薬剤師の確認待ち。
 *
 * - 次に聞く項目と答えの確かめは、すべてサーバー（packages/domain のルール）が行う。画面は返ってきた1問を出すだけ
 *   （CLAUDE.md 絶対に守るルール3）。
 * - 薬剤師用の小さな「緊急の確認を開く」をどの画面にも出す。自由に入力された文は、送る前に端末の中で緊急キーワードを確かめる。
 *   緊急の確認と119番の案内は、サーバーへの通信が失敗しても端末の中だけで出す（ルール2、spec.md 決まったこと No.38）。
 * - 通信が止まったときは、推測で続けず「通信が止まりました」の画面を出し、薬剤師が緊急の確認か受診の案内を選ぶ
 *   （ルール7、docs/backlog.md C-06）。
 */

type Mode = "questions" | "search" | "symptom" | "waiting" | "not_for_sale";

export function LanguageStart() {
  const [language, setLanguage] = useState<LanguageCode | null>(null);
  const [view, setView] = useState<PatientView | null>(null);
  const [mode, setMode] = useState<Mode>("questions");
  const [busy, setBusy] = useState(false);
  const [networkDown, setNetworkDown] = useState(false);
  const [notUnderstood, setNotUnderstood] = useState(false);
  /** null：緊急の確認・案内を出していない */
  const [emergency, setEmergency] = useState<EmergencyTrigger | null>(null);
  /** 緊急の確認で聞いた答えと観察の印（判断のときにサーバーの記録に残す） */
  const [followUp, setFollowUp] = useState<FollowUpState>(EMPTY_FOLLOW_UP);
  /** サーバーの記録に残せなかったとき（表示は続ける。薬剤師に知らせる） */
  const [recordFailed, setRecordFailed] = useState(false);
  /** 緊急キーワードの判定に使う年齢（Q01 の答え。こどもの項目を使うかを決める） */
  const age = useRef<number | undefined>(undefined);

  /** サーバーを呼び、結果で画面を進める。通信が止まったら「通信が止まりました」の画面にする */
  async function run(action: () => Promise<PatientView>): Promise<void> {
    setBusy(true);
    setNotUnderstood(false);
    try {
      const next = await action();
      setView(next);
      setNetworkDown(false);
    } catch (error: unknown) {
      if (error instanceof RuleError) {
        // 決められた形でない答えなど。推測で進めず、同じ質問をもう一度出す
        setNotUnderstood(true);
      } else {
        setNetworkDown(true);
      }
    } finally {
      setBusy(false);
    }
  }

  function chooseLanguage(code: LanguageCode) {
    setLanguage(code);
    void run(() => sessionApi.start(code));
  }

  /** 緊急の確認を開く。表示はすぐに切り替え、記録は通信できれば残す */
  function openEmergency(trigger: EmergencyTrigger) {
    setEmergency(trigger);
    setRecordFailed(false);
    if (view === null) return;
    sessionApi
      .openEmergency(view.id, {
        trigger: trigger.kind,
        matchedRuleIds: trigger.kind === "keyword" ? trigger.hits.map((h) => h.id) : [],
        inputText: trigger.kind === "keyword" ? trigger.text : null,
      })
      .catch(() => setRecordFailed(true));
  }

  /** 自由に入力された文に緊急キーワードがあれば、緊急の確認に切り替えて true を返す */
  function checkFreeText(text: string): boolean {
    if (language === null) return false;
    const detection = detectEmergency(text, { language, age: age.current });
    if (!detection.isEmergency) return false;
    openEmergency({ kind: "keyword", text, hits: detection.hits });
    return true;
  }

  /** 薬剤師の判断を記録に残す（追加の答えを先に残す） */
  async function recordDecision(decision: "show_119" | "not_emergency"): Promise<PatientView | null> {
    if (view === null) return null;
    const answers: Record<string, string> = {};
    for (const [key, value] of Object.entries(followUp.answers)) {
      if (typeof value === "string") answers[key] = value;
    }
    await sessionApi.recordFollowUp(view.id, { answers, scale: followUp.scale, observedRuleIds: [...followUp.observed] });
    return sessionApi.decideEmergency(view.id, decision);
  }

  if (emergency !== null) {
    return (
      <>
        {recordFailed ? (
          <p lang="ja" className="rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-700">
            通信が止まっているため、緊急の確認を記録に残せていません（案内はこのまま出せます）。
          </p>
        ) : null}
        <EmergencyGuide
          language={language}
          onLanguageChange={setLanguage}
          trigger={emergency}
          followUp={followUp}
          onFollowUpChange={setFollowUp}
          onShowGuide={() => {
            recordDecision("show_119").catch(() => setRecordFailed(true));
          }}
          onReturn={() => {
            setEmergency(null);
            setFollowUp(EMPTY_FOLLOW_UP);
            if (view === null) return;
            const id = view.id;
            void run(async () => (await recordDecision("not_emergency")) ?? sessionApi.get(id));
          }}
        />
      </>
    );
  }

  return (
    <>
      <StaffEmergencyButton onOpen={() => openEmergency({ kind: "staff" })} />
      {language === null ? (
        <LanguageSelect onSelect={chooseLanguage} />
      ) : networkDown ? (
        <NetworkDown
          language={language}
          onEmergency={() => openEmergency({ kind: "staff" })}
          onNotForSale={() => {
            setNetworkDown(false);
            setMode("not_for_sale");
          }}
          onRetry={() => void run(() => (view === null ? sessionApi.start(language) : sessionApi.get(view.id)))}
        />
      ) : (
        <PatientFrame language={language}>
          {notUnderstood ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-lg">{getMessages(language).interview.notUnderstood}</p>
          ) : null}
          <PatientBody
            language={language}
            view={view}
            mode={mode}
            busy={busy}
            onMode={setMode}
            onFreeText={checkFreeText}
            onAnswer={(answers: InterviewAnswers) => {
              if (view === null) return;
              if (answers.age !== undefined) age.current = answers.age;
              void run(() => sessionApi.answer(view.id, answers));
            }}
            onChooseDrug={(id: StockedDrugId) => {
              if (view === null) return;
              setMode("questions");
              void run(() => sessionApi.chooseDrugs(view.id, [id]));
            }}
          />
        </PatientFrame>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * 薬剤師用の「緊急の確認を開く」（日本語・小さく右上）。患者さんのどの画面にも出す。
 * 見てわかる緊急・言葉にできない人・通信が止まったときに、薬剤師が手動で緊急の確認を開く。
 */
function StaffEmergencyButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      lang="ja"
      onClick={onOpen}
      className="fixed right-3 top-3 z-10 rounded-lg border border-red-300 bg-white/90 px-3 py-1.5 text-xs font-semibold text-red-800 shadow-sm hover:bg-red-50"
    >
      薬剤師用：緊急の確認を開く
    </button>
  );
}

function LanguageSelect({ onSelect }: { onSelect: (code: LanguageCode) => void }) {
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
              onClick={() => onSelect(lang.code)}
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

function PatientFrame({ language, children }: { language: LanguageCode; children: ReactNode }) {
  const t = getMessages(language);
  return (
    <section lang={language} className="space-y-8">
      <header className="space-y-1 text-center">
        <p className="text-sm font-semibold tracking-widest text-teal-700">MODA</p>
        <p className="text-base text-slate-500">{t.languageSelect.selected}</p>
      </header>
      {children}
      {needsAiTranslationNotice(language) ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{t.common.aiTranslationNotice}</p>
      ) : null}
    </section>
  );
}

function PatientBody({
  language,
  view,
  mode,
  busy,
  onMode,
  onAnswer,
  onChooseDrug,
  onFreeText,
}: {
  language: LanguageCode;
  view: PatientView | null;
  mode: Mode;
  busy: boolean;
  onMode: (mode: Mode) => void;
  onAnswer: (answers: InterviewAnswers) => void;
  onChooseDrug: (id: StockedDrugId) => void;
  onFreeText: (text: string) => boolean;
}) {
  const t = getMessages(language);

  if (mode === "not_for_sale") {
    return <p className="rounded-2xl bg-slate-50 px-5 py-6 text-2xl leading-relaxed">{t.pharmacist.notForSale}</p>;
  }
  if (view === null) {
    return <p className="text-center text-lg text-slate-500">…</p>;
  }

  // 問診（年齢・性別から、サーバーが決めた1問ずつ）
  if (view.nextQuestion !== null) {
    return (
      <>
        {view.status === "attributes" ? <p className="text-lg text-slate-600">{t.interview.intro}</p> : null}
        <QuestionInput
          key={view.nextQuestion}
          language={language}
          questionId={view.nextQuestion}
          busy={busy}
          onSubmit={onAnswer}
          onFreeText={onFreeText}
        />
      </>
    );
  }

  // 選んだ薬の項目まで答え終えた → 薬剤師の確認待ち（T8）
  if (view.interviewComplete || mode === "waiting") {
    return (
      <div className="space-y-4 rounded-2xl bg-teal-50 px-5 py-6">
        <p className="text-2xl font-bold">{t.interview.done}</p>
        <p className="text-lg">{t.pharmacist.waiting}</p>
      </div>
    );
  }

  // 基本の項目を答え終えた → ほしい薬がある／症状から探す
  if (mode === "search") {
    return <DrugSearch language={language} busy={busy} onChoose={onChooseDrug} onBack={() => onMode("questions")} />;
  }
  if (mode === "symptom") {
    return (
      <SymptomInput
        language={language}
        onSubmit={(text) => {
          if (onFreeText(text)) return;
          // 症状から候補を選ぶのは薬剤師（T8）。ハッカソン版では症状の文を記録に残さない（docs/backlog.md S-11）
          onMode("waiting");
        }}
        onBack={() => onMode("questions")}
      />
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t.start.title}</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onMode("search")}
          className="flex min-h-28 flex-col items-start justify-center gap-1 rounded-2xl border-2 border-slate-200 px-5 py-4 text-left transition hover:border-teal-600 hover:bg-teal-50"
        >
          <span className="text-xl font-semibold">{t.start.haveProduct}</span>
          <span className="text-sm text-slate-600">{t.start.haveProductHint}</span>
        </button>
        <button
          type="button"
          onClick={() => onMode("symptom")}
          className="flex min-h-28 flex-col items-start justify-center gap-1 rounded-2xl border-2 border-slate-200 px-5 py-4 text-left transition hover:border-teal-600 hover:bg-teal-50"
        >
          <span className="text-xl font-semibold">{t.start.findBySymptom}</span>
          <span className="text-sm text-slate-600">{t.start.findBySymptomHint}</span>
        </button>
      </div>
    </div>
  );
}

/** 文字の形をそろえる（全角・半角、大文字・小文字、「（架空）」の有無の違いで見落とさないため） */
function normalizeName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[（(]架空[）)]/g, "").replace(/\s/g, "");
}

/** ほしい薬を商品名で探す（取扱薬だけ。写真の読み取りは T12） */
function DrugSearch({
  language,
  busy,
  onChoose,
  onBack,
}: {
  language: LanguageCode;
  busy: boolean;
  onChoose: (id: StockedDrugId) => void;
  onBack: () => void;
}) {
  const t = getMessages(language);
  const [query, setQuery] = useState("");
  const q = normalizeName(query);
  const matches = q === "" ? STOCKED_DRUGS : STOCKED_DRUGS.filter((drug) => normalizeName(drug.name).includes(q));
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t.start.haveProduct}</h1>
      <input
        type="search"
        value={query}
        placeholder={t.start.searchPlaceholder}
        onChange={(event) => setQuery(event.target.value)}
        className="w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-xl"
        autoFocus
      />
      {matches.length === 0 ? (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-lg">{t.start.noMatch}</p>
      ) : (
        <ul className="grid gap-3">
          {matches.map((drug) => (
            <li key={drug.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChoose(drug.id)}
                className="flex w-full items-center justify-between gap-4 rounded-2xl border-2 border-slate-200 px-5 py-4 text-left hover:border-teal-600 hover:bg-teal-50 disabled:opacity-50"
              >
                {/* 商品名は日本の商品の表記（日本語）のまま出す */}
                <span lang="ja" className="text-xl font-semibold">
                  {drug.name}
                </span>
                <span className="shrink-0 text-base text-teal-800">{t.start.chooseDrug}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onBack} className="text-base text-slate-600 underline underline-offset-4">
        {t.common.back}
      </button>
    </div>
  );
}

/** 症状から探す（症状を自由に入力。送る前に緊急キーワードを確かめる） */
function SymptomInput({
  language,
  onSubmit,
  onBack,
}: {
  language: LanguageCode;
  onSubmit: (text: string) => void;
  onBack: () => void;
}) {
  const t = getMessages(language);
  const [text, setText] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (text.trim() !== "") onSubmit(text.trim());
  }
  return (
    <form onSubmit={submit} className="space-y-6">
      <h1 className="text-3xl font-bold">{t.start.symptomPrompt}</h1>
      <textarea
        value={text}
        maxLength={500}
        onChange={(event) => setText(event.target.value)}
        className="h-36 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-xl"
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={text.trim() === ""}
          className="rounded-2xl bg-teal-700 px-6 py-4 text-xl font-bold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {t.common.next}
        </button>
        <button type="button" onClick={onBack} className="text-base text-slate-600 underline underline-offset-4">
          {t.common.back}
        </button>
      </div>
    </form>
  );
}

/** 通信が止まったとき（推測で続けない。薬剤師が緊急の確認か受診の案内を選ぶ） */
function NetworkDown({
  language,
  onEmergency,
  onNotForSale,
  onRetry,
}: {
  language: LanguageCode;
  onEmergency: () => void;
  onNotForSale: () => void;
  onRetry: () => void;
}) {
  const t = getMessages(language);
  return (
    <section className="space-y-6">
      <p lang={language} className="rounded-2xl border-4 border-amber-500 bg-amber-50 px-5 py-6 text-2xl font-bold">
        {t.common.networkError}
      </p>
      <div lang="ja" className="space-y-3 rounded-2xl border-2 border-slate-300 p-5">
        <p className="text-lg font-bold">薬剤師の方へ：通信が止まったため、問診を続けられません。</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onEmergency}
            className="rounded-2xl bg-red-700 px-4 py-4 text-lg font-bold text-white hover:bg-red-800"
          >
            緊急の確認を開く
          </button>
          <button
            type="button"
            onClick={onNotForSale}
            className="rounded-2xl border-2 border-slate-400 px-4 py-4 text-lg font-semibold hover:bg-slate-100"
          >
            受診をすすめる案内を出す
          </button>
        </div>
        <button type="button" onClick={onRetry} className="text-base text-slate-700 underline underline-offset-4">
          {t.common.retry}
        </button>
      </div>
    </section>
  );
}
