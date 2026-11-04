import type { LanguageCode } from "../languages.ts";
import { en } from "./en.ts";
import { es } from "./es.ts";
import { fr } from "./fr.ts";
import { ja, type Messages } from "./ja.ts";
import { ko } from "./ko.ts";
import { pt } from "./pt.ts";
import { vi } from "./vi.ts";
import { zhHans } from "./zh-Hans.ts";
import { zhHant } from "./zh-Hant.ts";

export type { Messages };

/** 言語ごとの定型文。言語の一覧（languages.ts）と同じ言語がそろっていないと型で止まる。 */
export const MESSAGES: Readonly<Record<LanguageCode, Messages>> = {
  ja,
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  ko,
  es,
  pt,
  fr,
  vi,
};

/**
 * 訳の出どころと、人による確認の状態。
 * - original：日本語の原文
 * - ai：AI による翻訳。人が確認するまでは、画面に「AI が翻訳した文」と表示する
 *
 * ハッカソン段階では外部の確認をしない（docs/spec.md 決まったこと No.23）。
 * 確認が済んだ言語だけ reviewed を true にする。
 */
export interface TranslationStatus {
  readonly source: "original" | "ai";
  readonly reviewed: boolean;
}

export const TRANSLATION_STATUS: Readonly<Record<LanguageCode, TranslationStatus>> = {
  ja: { source: "original", reviewed: true },
  en: { source: "ai", reviewed: false },
  "zh-Hans": { source: "ai", reviewed: false },
  "zh-Hant": { source: "ai", reviewed: false },
  ko: { source: "ai", reviewed: false },
  es: { source: "ai", reviewed: false },
  pt: { source: "ai", reviewed: false },
  fr: { source: "ai", reviewed: false },
  vi: { source: "ai", reviewed: false },
};

/** その言語の定型文を返す。 */
export function getMessages(code: LanguageCode): Messages {
  return MESSAGES[code];
}

/** 画面に「AI が翻訳した文（未確認）」の表示が必要か。 */
export function needsAiTranslationNotice(code: LanguageCode): boolean {
  const status = TRANSLATION_STATUS[code];
  return status.source === "ai" && !status.reviewed;
}
