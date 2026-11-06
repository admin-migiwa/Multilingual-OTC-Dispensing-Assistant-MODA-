import {
  EMERGENCY_KEYWORD_LANGUAGES,
  EMERGENCY_RULES,
  type EmergencyKeywordLanguage,
  type EmergencyRule,
  type KeywordsByLanguage,
} from "./keywords.ts";

/** こどもの項目（EC01〜EC08）を使う年齢の上限（emergency.md「こども（15歳以下）」） */
export const CHILD_MAX_AGE = 15;

export interface EmergencyDetectionOptions {
  /** 患者さんが選んだ言語のコード（packages/i18n の LANGUAGES と同じ文字列） */
  readonly language: string;
  /** 年齢。15歳以下のときと、まだわからないときは、こどもの項目も使う（16歳以上なら使わない） */
  readonly age?: number | undefined;
}

export interface EmergencyHit {
  /** 当てはまった項目の ID（EA12 など） */
  readonly id: string;
  readonly audience: "adult" | "child";
  /** 薬剤師向けの日本語の説明 */
  readonly labelJa: string;
  /** 文の中に見つかったキーワード */
  readonly keyword: string;
  /** そのキーワードの言語 */
  readonly language: EmergencyKeywordLanguage;
}

export interface EmergencyDetectionResult {
  readonly isEmergency: boolean;
  readonly hits: readonly EmergencyHit[];
}

/** 空白で語を区切らない言語。照合のときは空白をすべて取り除く。 */
const NO_SPACE_LANGUAGES: ReadonlySet<EmergencyKeywordLanguage> = new Set(["ja", "zh-Hans", "zh-Hant", "ko"]);

/**
 * アクセント記号・声調記号の有無を区別せずに照合する言語（é と e、ộ と o を同じとみなす）。
 * ベトナム語は、声調記号を付けずに入力されても拾うため（đ は d とみなす）。
 */
const ACCENT_FOLD_LANGUAGES: ReadonlySet<EmergencyKeywordLanguage> = new Set(["es", "pt", "fr", "vi"]);

/** アポストロフィの有無を区別しない言語（can't と cant、n'arrive と narrive を同じとみなす） */
const APOSTROPHE_FOLD_LANGUAGES: ReadonlySet<EmergencyKeywordLanguage> = new Set(["en", "es", "pt", "fr", "vi"]);

/** カタカナをひらがなに変える（「クチビル」と「くちびる」を同じとみなす） */
function katakanaToHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function isKeywordLanguage(code: string): code is EmergencyKeywordLanguage {
  return (EMERGENCY_KEYWORD_LANGUAGES as readonly string[]).includes(code);
}

/**
 * 照合に使う言語。選んだ言語に加えて、日本語は必ず見る（スタッフや付き添いの人が日本語で入れる場合）。
 * 知らない言語コードのときは、見落とさないように全言語で照合する（ここでは止めない）。
 */
function languagesToCheck(language: string): readonly EmergencyKeywordLanguage[] {
  if (!isKeywordLanguage(language)) return EMERGENCY_KEYWORD_LANGUAGES;
  return language === "ja" ? ["ja"] : [language, "ja"];
}

/** 全角・半角、大文字・小文字、記号の違いをそろえる */
function normalizeBase(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[’‘`´]/g, "'");
}

function normalizeFor(text: string, language: EmergencyKeywordLanguage): string {
  let result = normalizeBase(text);
  if (language === "ja") {
    result = katakanaToHiragana(result);
  }
  if (ACCENT_FOLD_LANGUAGES.has(language)) {
    result = result.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC").replace(/đ/g, "d");
  }
  if (APOSTROPHE_FOLD_LANGUAGES.has(language)) {
    result = result.replace(/'/g, "");
  }
  if (language === "en") {
    // 「can not」「cannot」「can't」「cant」を同じとみなす
    result = result.replace(/\bcan\s*not\b/g, "cant");
  }
  if (NO_SPACE_LANGUAGES.has(language)) {
    return result.replace(/\s+/g, "");
  }
  return result.replace(/\s+/g, " ");
}

/** 入力文を、言語ごとの照合用の形にして返す関数（同じ形を何度も作らないように覚えておく） */
type NormalizedText = (language: EmergencyKeywordLanguage) => string;

function normalizedText(text: string): NormalizedText {
  const cache = new Map<EmergencyKeywordLanguage, string>();
  return (language) => {
    let value = cache.get(language);
    if (value === undefined) {
      value = normalizeFor(text, language);
      cache.set(language, value);
    }
    return value;
  };
}

function findKeyword(
  text: NormalizedText,
  keywords: KeywordsByLanguage,
  languages: readonly EmergencyKeywordLanguage[],
): { keyword: string; language: EmergencyKeywordLanguage } | null {
  for (const language of languages) {
    const haystack = text(language);
    for (const keyword of keywords[language]) {
      const needle = normalizeFor(keyword, language);
      if (needle.length > 0 && haystack.includes(needle)) {
        return { keyword, language };
      }
    }
  }
  return null;
}

/**
 * こどもの項目を使うか。15歳以下のときに加えて、年齢がまだわからないときも使う
 * （11/6 薬剤師の判断：見落とすほうが危険。emergency.md「こども（15歳以下）」）。
 * 16歳以上とわかっているときだけ使わない。
 */
function appliesToAge(rule: EmergencyRule, age: number | undefined): boolean {
  if (rule.audience === "adult") return true;
  if (age === undefined || !Number.isFinite(age) || age < 0) return true;
  return age <= CHILD_MAX_AGE;
}

/**
 * 患者さんの入力文に、緊急症状のキーワードが含まれるかを調べる（docs/design.md 7節「緊急症状」）。
 *
 * - 当てはまったら、呼び出し側は問診をすぐに止めて、緊急案内を出す。
 * - 端末（ブラウザ）の中だけで動く純粋な関数。通信やサーバーが止まっていても使える。
 * - 見落とさないことを優先する。言い過ぎで当てはまった場合は、薬剤師が判断して問診に戻す。
 */
export function detectEmergency(text: string, options: EmergencyDetectionOptions): EmergencyDetectionResult {
  const normalized = normalizedText(text);
  const languages = languagesToCheck(options.language);
  const hits: EmergencyHit[] = [];

  for (const rule of EMERGENCY_RULES) {
    if (!appliesToAge(rule, options.age)) continue;
    const found = findKeyword(normalized, rule.keywords, languages);
    if (found === null) continue;
    if (rule.alsoRequires !== undefined && findKeyword(normalized, rule.alsoRequires, languages) === null) continue;
    hits.push({ id: rule.id, audience: rule.audience, labelJa: rule.labelJa, keyword: found.keyword, language: found.language });
  }

  return { isEmergency: hits.length > 0, hits };
}
