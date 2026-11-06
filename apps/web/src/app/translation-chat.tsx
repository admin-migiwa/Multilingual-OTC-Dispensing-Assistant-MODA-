"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { detectEmergency, type EmergencyHit } from "@moda/domain";
import { getLanguage, type LanguageCode } from "@moda/i18n";

/**
 * 自由入力の翻訳のチャット（T13）。患者さんと薬剤師が一緒に端末を見て使う（spec.md 決まったこと No.38）。
 *
 * - 患者さんの文 → 日本語、薬剤師の日本語 → 患者さんの言語。どちらも訳し戻しを並べ、訳が正しいかを確かめられるようにする。
 * - 訳はすべて「参考訳（AI の訳）」と出す（決まったこと No.23）。仮の AI のときは、そのことも出す。
 * - 患者さんの文は、送る前に端末の中でも緊急キーワードを照合する（通信が止まっていても緊急の確認を開けるように。CLAUDE.md 絶対に守るルール2）。
 * - サーバーが緊急と判断したら（AI の緊急フラグ・キーワード）、onEmergency で呼び出し元に知らせる。
 *   サーバーは自分で緊急の確認を開く（問診を止める）ので、呼び出し元は onEmergency を受けて画面を切り替えるだけにし、
 *   緊急を開く API をもう一度呼ばない（kind "keyword" は通信なしでも出すための端末の中の知らせ）。
 * - 翻訳がエラーで終わっても、サーバー側では緊急で止まっていることがある（AI の緊急フラグのあと、訳し戻しが失敗したなど）。
 *   そのため、エラーのときは接客の状態を読み直し、緊急の確認中なら onEmergency で知らせる（CLAUDE.md 絶対に守るルール2）。
 * - 薬剤師が一度「緊急ではない」と判断した接客（emergencyCleared）では、端末の中のキーワードでも知らせない（ルール2の例外）。
 * - 会話の中身は画面の中だけに置き、端末に保存しない。
 */

interface SessionStatusView {
  readonly status: string;
}

interface TranslationResponse {
  readonly direction: "to_ja" | "to_patient";
  readonly translation: string;
  readonly backTranslation: string;
  readonly label: string;
  readonly provider: "mock" | "anthropic";
  readonly emergency: { readonly ruleIds: readonly string[]; readonly labelsJa: readonly string[]; readonly opened: boolean };
  readonly view: SessionStatusView;
}

interface ChatEntry {
  readonly id: number;
  readonly direction: "to_ja" | "to_patient";
  readonly original: string;
  readonly result: TranslationResponse;
}

export type ChatEmergency =
  | { readonly kind: "keyword"; readonly text: string; readonly hits: readonly EmergencyHit[] }
  | { readonly kind: "server"; readonly ruleIds: readonly string[]; readonly labelsJa: readonly string[] };

const ERROR_TEXT: Readonly<Record<string, string>> = {
  AI_NOT_CONFIGURED: "AI の設定がありません（API キー）。翻訳は使えません。",
  AI_UNAVAILABLE: "AI に接続できませんでした。もう一度送るか、指さしなどで確かめてください。",
  AI_INVALID_OUTPUT: "AI の答えが正しい形ではありませんでした。もう一度送ってください。",
  AI_REFUSED: "AI がこの文を訳しませんでした。言い方を変えてください。",
  INVALID_REQUEST: "文が空か、長すぎます（500字まで）。",
  SESSION_ALREADY_ENDED: "この接客は終わっています。",
  SESSION_NOT_FOUND: "接客の記録が見つかりません。最初からやり直してください。",
  INVALID_TRANSITION: "いまの画面では翻訳できません。",
};

export function TranslationChat({
  sessionId,
  language,
  age,
  emergencyCleared = false,
  onEmergency,
}: {
  sessionId: string;
  language: LanguageCode;
  /** わかっていれば年齢（端末の中のキーワード照合で、こどもの項目を使うかに使う） */
  age?: number | undefined;
  /** 薬剤師が一度「緊急ではない」と判断した接客か（patientView.emergencyCleared） */
  emergencyCleared?: boolean;
  onEmergency: (emergency: ChatEmergency) => void;
}) {
  const [direction, setDirection] = useState<"to_ja" | "to_patient">("to_ja");
  const [text, setText] = useState("");
  const [entries, setEntries] = useState<readonly ChatEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patientLanguage = getLanguage(language);

  /** 翻訳がエラーで終わったとき、サーバー側で緊急の確認に入っていないかを読み直す */
  async function checkStoppedByServer() {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      if (!response.ok) return;
      const view = (await response.json()) as Partial<SessionStatusView>;
      if (view.status === "emergency_review") onEmergency({ kind: "server", ruleIds: [], labelsJa: [] });
    } catch {
      // 通信が止まっているときは、端末の中のキーワード照合と薬剤師の手動ボタンで対応する
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sent = text.trim();
    if (!sent || sending) return;
    setError(null);

    // 患者さんの文は、送る前に端末の中で緊急キーワードを照合する（通信に頼らない）
    if (direction === "to_ja" && !emergencyCleared) {
      const local = detectEmergency(sent, { language, age });
      if (local.isEmergency) onEmergency({ kind: "keyword", text: sent, hits: local.hits });
    }

    setSending(true);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, text: sent }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<TranslationResponse> & { error?: string };
      if (!response.ok || typeof body.translation !== "string") {
        setError(ERROR_TEXT[body.error ?? ""] ?? "翻訳できませんでした。");
        if (direction === "to_ja") await checkStoppedByServer();
        return;
      }
      const result = body as TranslationResponse;
      setEntries((previous) => [...previous, { id: previous.length + 1, direction, original: sent, result }]);
      setText("");
      // この翻訳で止めたとき、またはすでに止まっていて緊急の項目が当てはまったとき（送り直しなど）
      if (result.emergency.opened || (result.view.status === "emergency_review" && result.emergency.ruleIds.length > 0)) {
        onEmergency({ kind: "server", ruleIds: result.emergency.ruleIds, labelsJa: result.emergency.labelsJa });
      }
    } catch {
      setError("通信が止まりました。右上の「緊急の確認を開く」は使えます。");
      if (direction === "to_ja") await checkStoppedByServer();
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border-2 border-slate-300 p-4">
      <header lang="ja" className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-slate-800">翻訳のチャット</h2>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
          参考訳（AI の訳）
        </span>
        {entries.some((entry) => entry.result.provider === "mock") ? (
          <span className="rounded-full bg-slate-200 px-3 py-1 text-sm text-slate-700">仮の AI（開発用）</span>
        ) : null}
      </header>

      <ol className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className="space-y-2 rounded-xl bg-slate-50 p-3">
            {entry.direction === "to_ja" ? (
              <>
                <Line label={`患者さん（${patientLanguage.japaneseName}）`} text={entry.original} lang={language} />
                <Line label="日本語の参考訳（AI の訳）" text={entry.result.translation} lang="ja" strong />
                <Line
                  label={`確認用：${patientLanguage.japaneseName}に訳し戻した文（患者さんが見て確かめる）`}
                  text={entry.result.backTranslation}
                  lang={language}
                />
              </>
            ) : (
              <>
                <Line label="薬剤師（日本語）" text={entry.original} lang="ja" />
                <Line
                  label={`${patientLanguage.japaneseName}の参考訳（AI の訳）`}
                  text={entry.result.translation}
                  lang={language}
                  strong
                />
                <Line label="確認用：日本語に訳し戻した文（薬剤師が見て確かめる）" text={entry.result.backTranslation} lang="ja" />
              </>
            )}
            {entry.result.emergency.ruleIds.length > 0 ? (
              <p lang="ja" className="rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-900">
                緊急症状の可能性：{entry.result.emergency.ruleIds.join("・")}（{entry.result.emergency.labelsJa.join("／")}）
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div lang="ja" className="flex gap-2" role="radiogroup" aria-label="だれが書くか">
          <DirectionButton active={direction === "to_ja"} onClick={() => setDirection("to_ja")}>
            患者さんが書く → 日本語
          </DirectionButton>
          <DirectionButton active={direction === "to_patient"} onClick={() => setDirection("to_patient")}>
            薬剤師が書く → {patientLanguage.japaneseName}
          </DirectionButton>
        </div>
        <textarea
          lang={direction === "to_ja" ? language : "ja"}
          value={text}
          maxLength={500}
          rows={3}
          onChange={(event) => setText(event.target.value)}
          className="w-full rounded-xl border-2 border-slate-300 px-3 py-2 text-lg"
        />
        <div lang="ja" className="flex items-center gap-4">
          <button
            type="submit"
            disabled={sending || text.trim() === ""}
            className="rounded-xl bg-slate-800 px-4 py-2 text-base font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {sending ? "訳しています…" : "訳す"}
          </button>
          {error ? <span className="text-sm font-semibold text-red-700">{error}</span> : null}
        </div>
      </form>
    </section>
  );
}

function Line({ label, text, lang, strong = false }: { label: string; text: string; lang: string; strong?: boolean }) {
  return (
    <div>
      <p lang="ja" className="text-xs text-slate-500">
        {label}
      </p>
      <p lang={lang} className={strong ? "text-lg font-semibold text-slate-900" : "text-base text-slate-700"}>
        {text}
      </p>
    </div>
  );
}

function DirectionButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`rounded-xl border-2 px-3 py-2 text-sm font-semibold ${
        active ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
