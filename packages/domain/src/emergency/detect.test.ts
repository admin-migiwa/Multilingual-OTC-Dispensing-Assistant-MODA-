import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectEmergency } from "./detect.ts";
import { EMERGENCY_KEYWORD_LANGUAGES, EMERGENCY_RULES } from "./keywords.ts";

/**
 * テストは docs/demo-data/emergency.md（11/4 薬剤師確認済み・☑）の行から作る。
 * 表にない症状を「緊急」「緊急でない」の正解として足さない。
 * 日本語以外の文は、日本語のキーワードを AI で訳したもの（未確認）に合わせた例文。
 */

function hitIds(text: string, language: string, age?: number): string[] {
  return detectEmergency(text, { language, age }).hits.map((hit) => hit.id);
}

describe("辞書の形：emergency.md の ☑ の行がそろっている", () => {
  it("おとな EA01〜EA24、こども EC01〜EC08 の32行がある", () => {
    const ids = EMERGENCY_RULES.map((rule) => rule.id);
    const expected = [
      ...Array.from({ length: 24 }, (_, i) => `EA${String(i + 1).padStart(2, "0")}`),
      ...Array.from({ length: 8 }, (_, i) => `EC${String(i + 1).padStart(2, "0")}`),
    ];
    assert.deepEqual(ids, expected);
  });

  it("EA で始まる行はおとな、EC で始まる行はこどもの項目になっている", () => {
    for (const rule of EMERGENCY_RULES) {
      assert.equal(rule.audience, rule.id.startsWith("EC") ? "child" : "adult", rule.id);
    }
  });

  it("EA24（いつもと違う・様子がおかしい）はキーワードで拾わない（緊急ボタンと薬剤師の判断）", () => {
    const ea24 = EMERGENCY_RULES.find((rule) => rule.id === "EA24");
    assert.ok(ea24);
    for (const language of EMERGENCY_KEYWORD_LANGUAGES) {
      assert.equal(ea24.keywords[language].length, 0, language);
    }
  });

  it("EA24 以外のすべての行に、9言語それぞれのキーワードがある", () => {
    for (const rule of EMERGENCY_RULES) {
      if (rule.id === "EA24") continue;
      for (const language of EMERGENCY_KEYWORD_LANGUAGES) {
        assert.ok(rule.keywords[language].length > 0, `${rule.id} ${language}`);
      }
    }
  });
});

describe("胸の痛み（EA12）：母国語で入力しても緊急として検知する", () => {
  const sameMeaning: Array<[language: string, text: string]> = [
    ["ja", "胸が痛い"],
    ["en", "My chest hurts. I have chest pain."],
    ["zh-Hans", "我胸口痛"],
    ["zh-Hant", "我胸口痛"],
    ["ko", "가슴이 아파요"],
    ["es", "Me duele el pecho"],
    ["pt", "Estou com dor no peito"],
    ["fr", "J'ai mal à la poitrine"],
    ["vi", "Tôi bị đau ngực"],
  ];

  for (const [language, text] of sameMeaning) {
    it(`「${text}」（${language}）は EA12 として緊急になる`, () => {
      const result = detectEmergency(text, { language });
      assert.equal(result.isEmergency, true);
      assert.ok(hitIds(text, language).includes("EA12"));
    });
  }

  it("「胸が痛い」は、どの言語を選んでいても日本語のまま検知する（スタッフや付き添いの人の入力）", () => {
    for (const language of EMERGENCY_KEYWORD_LANGUAGES) {
      assert.ok(hitIds("胸が痛い", language).includes("EA12"), language);
    }
  });

  it("全角・半角や大文字・小文字の違いがあっても検知する", () => {
    assert.ok(hitIds("CHEST PAIN", "en").includes("EA12"));
  });

  it("スペイン語・フランス語・ポルトガル語はアクセント記号を省いて入力しても検知する", () => {
    assert.ok(hitIds("Tengo dolor en el pecho y opresion en el pecho", "es").includes("EA12"));
    assert.ok(hitIds("J'ai une douleur a la poitrine", "fr").includes("EA12"));
  });

  it("知らない言語コードが渡されても止めずに、すべての言語で照合して検知する", () => {
    assert.ok(hitIds("chest pain", "xx").includes("EA12"));
    assert.ok(hitIds("胸が痛い", "xx").includes("EA12"));
  });

  it("当てはまったキーワードと薬剤師向けの日本語の説明を返す", () => {
    const [hit] = detectEmergency("I have chest pain", { language: "en" }).hits;
    assert.ok(hit);
    assert.equal(hit.id, "EA12");
    assert.equal(hit.keyword, "chest pain");
    assert.equal(hit.language, "en");
    assert.match(hit.labelJa, /胸/);
  });
});

describe("おとなの項目：emergency.md のキーワードで検知する", () => {
  const rows: Array<[id: string, text: string]> = [
    ["EA01", "顔がしびれる"],
    ["EA02", "口がゆがむ"],
    ["EA03", "ろれつがまわらない"],
    ["EA04", "視野が欠ける"],
    ["EA05", "物がだぶって見える"],
    ["EA06", "顔色が悪い"],
    ["EA07", "今までで一番ひどい頭痛がする"],
    ["EA09", "急にふらつく"],
    ["EA10", "背中の激痛"],
    ["EA11", "息苦しい"],
    ["EA13", "痛みが移動する"],
    ["EA14", "激しい腹痛"],
    ["EA15", "血を吐いた"],
    ["EA16", "黒い便が出た"],
    ["EA17", "片方の腕に力が入らない"],
    ["EA18", "意識がない"],
    ["EA19", "冷や汗が出る"],
    ["EA20", "のどにつまった"],
    ["EA21", "けいれんしている"],
    ["EA22", "血が止まらない"],
    ["EA23", "高いところから落ちた"],
  ];

  for (const [id, text] of rows) {
    it(`「${text}」は ${id} として緊急になる`, () => {
      assert.ok(hitIds(text, "ja").includes(id));
    });
  }
});

describe("突然の高熱（EA08）：「突然」「急に」とあわせたときだけ緊急にする（決定8）", () => {
  it("「突然の高熱」は緊急になる", () => {
    assert.ok(hitIds("突然の高熱", "ja").includes("EA08"));
  });

  it("「急に高熱が出た」は緊急になる", () => {
    assert.ok(hitIds("急に高熱が出た", "ja").includes("EA08"));
  });

  it("ただの「高熱」では緊急にしない", () => {
    const result = detectEmergency("高熱", { language: "ja" });
    assert.equal(result.isEmergency, false);
  });

  it("「熱がある」では緊急にしない", () => {
    const result = detectEmergency("熱がある", { language: "ja" });
    assert.equal(result.isEmergency, false);
  });

  it("英語でも、「sudden」がないただの「high fever」では緊急にしない", () => {
    assert.equal(detectEmergency("I have a high fever", { language: "en" }).isEmergency, false);
    assert.ok(hitIds("I suddenly got a high fever", "en").includes("EA08"));
  });
});

describe("こどもの項目（EC01〜EC08）は15歳以下のときだけ使う", () => {
  it("10歳で「くちびるが紫」は EC01 として緊急になる", () => {
    assert.ok(hitIds("くちびるが紫", "ja", 10).includes("EC01"));
  });

  it("15歳で「ゼーゼーしている」は EC02 として緊急になる", () => {
    assert.ok(hitIds("ゼーゼーしている", "ja", 15).includes("EC02"));
  });

  it("16歳では、こどもの項目（くちびるが紫）は使わない", () => {
    assert.equal(detectEmergency("くちびるが紫", { language: "ja", age: 16 }).isEmergency, false);
  });

  it("30歳では、こどもの項目（嘔吐が止まらない）は使わない", () => {
    assert.equal(detectEmergency("嘔吐が止まらない", { language: "ja", age: 30 }).isEmergency, false);
  });

  it("年齢がまだわからないときは、こどもの項目は使わない", () => {
    assert.equal(detectEmergency("くちびるが紫", { language: "ja" }).isEmergency, false);
  });

  it("こどもでも、おとなの項目（胸が痛い）は使う", () => {
    assert.ok(hitIds("胸が痛い", "ja", 8).includes("EA12"));
  });

  const rows: Array<[id: string, text: string]> = [
    ["EC03", "手足が固まっている"],
    ["EC04", "頭を強くぶつけた"],
    ["EC05", "水分が取れない"],
    ["EC06", "虫に刺された"],
    ["EC07", "ひどいやけど"],
    ["EC08", "赤ちゃんの様子がおかしい"],
  ];
  for (const [id, text] of rows) {
    it(`5歳で「${text}」は ${id} として緊急になる`, () => {
      assert.ok(hitIds(text, "ja", 5).includes(id));
    });
  }

  it("英語でも、5歳で「purple lips」は EC01 として緊急になる", () => {
    assert.ok(hitIds("His lips are purple", "en", 5).includes("EC01"));
  });
});

describe("キーワードがない入力", () => {
  it("空の入力は緊急にしない", () => {
    assert.equal(detectEmergency("", { language: "ja" }).isEmergency, false);
    assert.equal(detectEmergency("   ", { language: "en" }).isEmergency, false);
  });
});
