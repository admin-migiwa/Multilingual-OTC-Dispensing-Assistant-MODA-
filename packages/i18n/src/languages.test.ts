import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LANGUAGES, STAFF_LANGUAGE, getLanguage, isSupportedLanguage } from "./languages.ts";

describe("対応言語の一覧", () => {
  it("開始時は9言語", () => {
    assert.equal(LANGUAGES.length, 9);
  });

  it("言語コードに重複がない", () => {
    const codes = LANGUAGES.map((l) => l.code);
    assert.equal(new Set(codes).size, codes.length);
  });

  it("音声ロケールに重複がない", () => {
    const locales = LANGUAGES.map((l) => l.speechLocale);
    assert.equal(new Set(locales).size, locales.length);
  });

  it("薬剤師向けの日本語が含まれる", () => {
    assert.ok(isSupportedLanguage(STAFF_LANGUAGE));
  });

  it("どの言語にも表示名と音声ロケールがある", () => {
    for (const lang of LANGUAGES) {
      assert.ok(lang.nativeName.length > 0, lang.code);
      assert.ok(lang.japaneseName.length > 0, lang.code);
      assert.match(lang.speechLocale, /^[a-z]{2}-[A-Z]{2}$/, lang.code);
    }
  });

  it("未対応の言語コードは受け付けない", () => {
    assert.equal(isSupportedLanguage("de"), false);
    assert.equal(isSupportedLanguage(""), false);
  });

  it("言語コードから定義を取り出せる", () => {
    assert.equal(getLanguage("vi").nativeName, "Tiếng Việt");
  });
});
