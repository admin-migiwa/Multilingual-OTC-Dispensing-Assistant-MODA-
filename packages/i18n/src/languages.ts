/**
 * 対応言語の一覧。言語を足すときはここだけを編集する（docs/design.md「対応言語」）。
 *
 * 言語を有効にする前に必ず済ませること：
 * - 定型文（緊急案内・問診の質問・注意事項・説明文）の翻訳と、人による確認
 * - Azure AI Speech の音声認識・読み上げが使えるかの確認（speechLocale）
 * - 実機（iPad）での表示確認（フォント・文字の崩れ）
 */
export interface LanguageDefinition {
  /** アプリ内で使う言語コード（BCP 47） */
  readonly code: string;
  /** その言語自身での表記（言語選択ボタンに出す） */
  readonly nativeName: string;
  /** 薬剤師・管理者向けの日本語表記 */
  readonly japaneseName: string;
  /** 音声認識・読み上げに使うロケール（Azure AI Speech） */
  readonly speechLocale: string;
  /** 文字の向き */
  readonly direction: "ltr" | "rtl";
}

export const LANGUAGES = [
  { code: "ja", nativeName: "日本語", japaneseName: "日本語", speechLocale: "ja-JP", direction: "ltr" },
  { code: "en", nativeName: "English", japaneseName: "英語", speechLocale: "en-US", direction: "ltr" },
  { code: "zh-Hans", nativeName: "简体中文", japaneseName: "中国語（簡体）", speechLocale: "zh-CN", direction: "ltr" },
  { code: "zh-Hant", nativeName: "繁體中文", japaneseName: "中国語（繁体）", speechLocale: "zh-TW", direction: "ltr" },
  { code: "ko", nativeName: "한국어", japaneseName: "韓国語", speechLocale: "ko-KR", direction: "ltr" },
  { code: "es", nativeName: "Español", japaneseName: "スペイン語", speechLocale: "es-ES", direction: "ltr" },
  { code: "pt", nativeName: "Português", japaneseName: "ポルトガル語", speechLocale: "pt-BR", direction: "ltr" },
  { code: "fr", nativeName: "Français", japaneseName: "フランス語", speechLocale: "fr-FR", direction: "ltr" },
  { code: "vi", nativeName: "Tiếng Việt", japaneseName: "ベトナム語", speechLocale: "vi-VN", direction: "ltr" },
] as const satisfies readonly LanguageDefinition[];

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

/** 薬剤師・管理者向け画面の言語 */
export const STAFF_LANGUAGE: LanguageCode = "ja";

export function isSupportedLanguage(code: string): code is LanguageCode {
  return LANGUAGES.some((lang) => lang.code === code);
}

export function getLanguage(code: LanguageCode): LanguageDefinition {
  const found = LANGUAGES.find((lang) => lang.code === code);
  if (!found) {
    // 型で守られているので通常は起きない。起きたら設定の誤りなので止める。
    throw new Error(`未対応の言語コードです: ${code}`);
  }
  return found;
}
