"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";

import { getMessages, type LanguageCode } from "@moda/i18n";

/**
 * 「ほしい薬がある」：写真（スマホの画面・実物の箱）か、商品名の入力から、取扱薬の候補を出す（T12）。
 *
 * - 撮影の前に、患者さんの言語で「文字を読むために AI に送る・保存しない」を示して同意をもらう（spec.md 決まったこと No.27）。
 *   同意しなければ、名前の入力に進む。
 * - 写真は端末の中で小さくしてから送り（位置情報などの付加情報も消える）、送ったら画面の中からも消す。端末に保存しない。
 * - 出すのは「候補」。どれにするかは薬剤師が確かめて選ぶ（CLAUDE.md 絶対に守るルール10）。AI が薬を勧める表示はしない（決まったこと No.22）。
 */

interface Candidate {
  readonly drugId: string;
  readonly name: string;
  readonly stocked: boolean;
  readonly score: number;
}

interface IdentifyResponse {
  readonly source: "photo" | "text";
  readonly readable: boolean;
  readonly productNames: readonly string[];
  readonly candidates: readonly Candidate[];
  readonly provider: "mock" | "anthropic" | null;
}

type Step = "start" | "consent" | "camera" | "name";

/** 送る写真の長い辺の上限（文字が読める大きさで、送る量を小さくする） */
const MAX_EDGE = 1568;

const ERROR_TEXT: Readonly<Record<string, string>> = {
  AI_NOT_CONFIGURED: "AI の設定がありません（API キー）。商品名を入力してください。",
  AI_UNAVAILABLE: "AI に接続できませんでした。もう一度撮るか、商品名を入力してください。",
  AI_INVALID_OUTPUT: "読み取りの結果が正しい形ではありませんでした。もう一度撮ってください。",
  AI_REFUSED: "この写真は読み取れませんでした。商品名を入力してください。",
  INVALID_REQUEST: "写真か名前の形が違います。",
};

/** 写真を端末の中で小さくし、JPEG の base64 にする（付加情報は描き直すときに消える） */
async function shrinkToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export function ProductFinder({
  language,
  onChoose,
}: {
  language: LanguageCode;
  /** 薬剤師が候補を選んだとき */
  onChoose: (drugId: string) => void;
}) {
  const messages = getMessages(language);
  const [step, setStep] = useState<Step>("start");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IdentifyResponse | null>(null);

  async function send(body: unknown) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/products/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<IdentifyResponse> & { error?: string };
      if (!response.ok || !Array.isArray(data.candidates)) {
        setError(ERROR_TEXT[data.error ?? ""] ?? "候補を出せませんでした。");
        return;
      }
      setResult(data as IdentifyResponse);
    } catch {
      setError("通信が止まりました。商品名を薬剤師に見せてください。");
    } finally {
      setBusy(false);
    }
  }

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 選んだ写真を入力欄からすぐに消す（同じ写真をもう一度選べるように、また端末の画面に残さないように）
    event.target.value = "";
    if (!file) return;
    let base64: string;
    try {
      base64 = await shrinkToJpeg(file);
    } catch {
      setError("写真を読み込めませんでした。");
      return;
    }
    await send({ consent: true, image: { mediaType: "image/jpeg", base64 } });
  }

  function handleName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim()) void send({ text: name });
  }

  return (
    <section className="space-y-4 rounded-2xl border-2 border-slate-300 p-4">
      {step === "start" ? (
        <div lang={language} className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setStep("consent")}
            className="rounded-xl bg-slate-800 px-4 py-3 text-lg font-semibold text-white"
          >
            📷 {messages.start.haveProductHint}
          </button>
        </div>
      ) : null}

      {step === "consent" ? (
        <div lang={language} className="space-y-3">
          <h2 className="text-xl font-bold">{messages.photoConsent.title}</h2>
          <p className="text-lg">{messages.photoConsent.body}</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep("camera")}
              className="rounded-xl bg-slate-800 px-4 py-3 text-lg font-semibold text-white"
            >
              {messages.photoConsent.agree}
            </button>
            <button
              type="button"
              onClick={() => setStep("name")}
              className="rounded-xl border-2 border-slate-300 px-4 py-3 text-lg"
            >
              {messages.photoConsent.decline}
            </button>
          </div>
        </div>
      ) : null}

      {step === "camera" ? (
        <div className="space-y-3">
          <label className="inline-block cursor-pointer rounded-xl bg-slate-800 px-4 py-3 text-lg font-semibold text-white">
            📷 {messages.photoConsent.agree}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handlePhoto} />
          </label>
          <button lang="ja" type="button" onClick={() => setStep("name")} className="ml-3 text-sm text-slate-600 underline">
            商品名を入力する
          </button>
        </div>
      ) : null}

      {step === "name" ? (
        <form lang="ja" onSubmit={handleName} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            placeholder="商品名（例：モダシップ）"
            className="flex-1 rounded-xl border-2 border-slate-300 px-3 py-2 text-lg"
          />
          <button type="submit" disabled={busy || !name.trim()} className="rounded-xl bg-slate-800 px-4 py-2 text-white disabled:opacity-50">
            探す
          </button>
        </form>
      ) : null}

      {busy ? <p lang="ja" className="text-slate-600">読み取っています…</p> : null}
      {error ? <p lang="ja" className="font-semibold text-red-700">{error}</p> : null}

      {result ? (
        <div lang="ja" className="space-y-2">
          {result.provider === "mock" ? <p className="text-sm text-slate-500">仮の AI（開発用）：写真は読みません</p> : null}
          {result.productNames.length > 0 ? (
            <p className="text-sm text-slate-600">読み取った名前：{result.productNames.join("、")}</p>
          ) : null}
          {result.candidates.length === 0 ? (
            <p className="text-slate-700">
              候補が見つかりませんでした。
              {step !== "name" ? (
                <button type="button" onClick={() => setStep("name")} className="ml-2 underline">
                  商品名を入力する
                </button>
              ) : null}
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-700">候補（薬剤師が確かめて選んでください）</p>
              <ul className="space-y-2">
                {result.candidates.map((candidate) => (
                  <li key={candidate.drugId}>
                    <button
                      type="button"
                      onClick={() => onChoose(candidate.drugId)}
                      className="w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-left hover:border-slate-800"
                    >
                      <span className="text-lg font-semibold">{candidate.name}</span>
                      {candidate.stocked ? null : (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-sm text-amber-900">
                          店で扱っていない薬
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
