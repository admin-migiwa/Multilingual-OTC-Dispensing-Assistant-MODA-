import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LANGUAGES } from "../languages.ts";
import { MESSAGES, TRANSLATION_STATUS, getMessages, needsAiTranslationNotice } from "./index.ts";

/** 入れ子になった定型文を「キーの道筋 → 文」の一覧にする */
function flatten(value: unknown, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  if (typeof value === "string") {
    result.set(prefix, value);
    return result;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      for (const [path, text] of flatten(child, prefix ? `${prefix}.${key}` : key)) {
        result.set(path, text);
      }
    }
  }
  return result;
}

const japanese = flatten(MESSAGES.ja);

describe("定型文（9言語）", () => {
  it("対応言語のすべてに定型文がある", () => {
    for (const lang of LANGUAGES) {
      assert.ok(MESSAGES[lang.code], lang.code);
    }
  });

  it("どの言語も日本語の原文と同じ項目がそろっていて、抜けも余分もない", () => {
    for (const lang of LANGUAGES) {
      const translated = flatten(MESSAGES[lang.code]);
      assert.deepEqual([...translated.keys()].sort(), [...japanese.keys()].sort(), lang.code);
    }
  });

  it("どの言語にも空の文がない", () => {
    for (const lang of LANGUAGES) {
      for (const [path, text] of flatten(MESSAGES[lang.code])) {
        assert.ok(text.trim().length > 0, `${lang.code}: ${path}`);
      }
    }
  });

  it("日本語以外の言語の文に、ひらがなが残っていない（訳し忘れがない）", () => {
    // 119番の案内だけは、電話口で言う日本語「救急です」をわざと書いている
    const japaneseOnPurpose = new Set(["emergency.call119"]);
    const hiragana = /[ぁ-ゟ]/;
    for (const lang of LANGUAGES) {
      if (lang.code === "ja") continue;
      for (const [path, text] of flatten(MESSAGES[lang.code])) {
        if (japaneseOnPurpose.has(path)) continue;
        assert.doesNotMatch(text, hiragana, `${lang.code}: ${path}`);
      }
    }
  });

  it("日本語以外の言語の文に、カタカナが残っていない（訳し忘れがない）", () => {
    // 119番の案内だけは、電話口で言う日本語「救急です」をわざと書いている（ひらがなのテストと同じ）
    const japaneseOnPurpose = new Set(["emergency.call119"]);
    const katakana = /[ァ-ヺー]/;
    for (const lang of LANGUAGES) {
      if (lang.code === "ja") continue;
      for (const [path, text] of flatten(MESSAGES[lang.code])) {
        if (japaneseOnPurpose.has(path)) continue;
        assert.doesNotMatch(text, katakana, `${lang.code}: ${path}`);
      }
    }
  });

  it("差し込みの名前（{age}・{max} など）が、どの言語でも日本語の原文と同じ", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const lang of LANGUAGES) {
      for (const [path, text] of flatten(MESSAGES[lang.code])) {
        assert.deepEqual(placeholders(text), placeholders(japanese.get(path) ?? ""), `${lang.code}: ${path}`);
      }
    }
  });

  it("緊急案内には、どの言語でも119番が書かれている", () => {
    for (const lang of LANGUAGES) {
      assert.match(getMessages(lang.code).emergency.call119, /119/, lang.code);
    }
  });

  it("緊急案内の相談窓口の番号（#7119・#8000）が、どの言語でも同じ", () => {
    for (const lang of LANGUAGES) {
      const emergency = getMessages(lang.code).emergency;
      assert.match(emergency.consultLine, /#7119/, lang.code);
      assert.match(emergency.childLine, /#8000/, lang.code);
    }
  });

  it("訪日外国人向けの窓口（emergency.md の EN04：JNTO の Japan Visitor Hotline）の番号が、どの言語でも同じ", () => {
    for (const lang of LANGUAGES) {
      const { visitorHotline } = getMessages(lang.code).emergency;
      assert.match(visitorHotline, /050-3816-2787/, lang.code);
      assert.match(visitorHotline, /Japan Visitor Hotline/, lang.code);
      assert.match(visitorHotline, /JNTO/, lang.code);
    }
  });

  it("参考になるページ（emergency.md の EP01〜EP03）の説明が、どの言語でも出どころの機関の名前つきでそろっている", () => {
    for (const lang of LANGUAGES) {
      const emergency = getMessages(lang.code).emergency;
      assert.ok(emergency.infoPagesTitle.length > 0, lang.code);
      assert.ok(emergency.ambulanceGuidePage.length > 0, lang.code);
      assert.match(emergency.visitorHotlinePage, /JNTO/, lang.code);
      assert.match(emergency.residentConsultationPage, /CLAIR/, lang.code);
    }
  });
});

describe("受診をすすめる案内（docs/demo-data/referral.md の RF01〜RF05）", () => {
  it("どの言語にも、見出し・受診をすすめる文・病院で伝えること・相談先の見出し・スタッフへの案内がそろっている", () => {
    for (const lang of LANGUAGES) {
      const referral = getMessages(lang.code).referral;
      for (const key of ["title", "body", "tellDoctor", "consultTitle", "askStaff"] as const) {
        assert.ok(referral[key].trim().length > 0, `${lang.code}: ${key}`);
      }
    }
  });

  it("日本語の原文は、依頼主が選んだ表（RF01〜RF05）の文と同じ", () => {
    const referral = getMessages("ja").referral;
    assert.equal(referral.title, "病院や診療所で診てもらってください");
    assert.equal(referral.body, "申し訳ありません。今の状態では、お店の薬（市販薬）ではお応えできません。病院や診療所での受診をおすすめします。");
    assert.equal(referral.tellDoctor, "病院では、今日の症状と、いま飲んでいる薬を伝えてください。お薬手帳があれば持って行ってください。");
    assert.equal(referral.consultTitle, "外国語で相談できるところ");
    assert.equal(referral.askStaff, "わからないことは、スタッフに聞いてください。");
  });

  it("受診をすすめる案内には119番を書かない（119番は薬剤師が緊急の確認をしてから出す）", () => {
    for (const lang of LANGUAGES) {
      for (const [path, text] of flatten(getMessages(lang.code).referral)) {
        assert.doesNotMatch(text, /119/, `${lang.code}: ${path}`);
      }
    }
  });
});

describe("訳の確認状態", () => {
  it("日本語は原文なので「AI が翻訳した文」の表示を出さない", () => {
    assert.equal(needsAiTranslationNotice("ja"), false);
  });

  it("人が確認していない AI の訳には「AI が翻訳した文」の表示を出す", () => {
    for (const lang of LANGUAGES) {
      if (lang.code === "ja") continue;
      assert.equal(TRANSLATION_STATUS[lang.code].source, "ai", lang.code);
      assert.equal(needsAiTranslationNotice(lang.code), !TRANSLATION_STATUS[lang.code].reviewed, lang.code);
    }
  });

  it("ハッカソン段階では、AI の訳はどれも人の確認済みになっていない", () => {
    for (const lang of LANGUAGES) {
      if (lang.code === "ja") continue;
      assert.equal(TRANSLATION_STATUS[lang.code].reviewed, false, lang.code);
    }
  });
});
