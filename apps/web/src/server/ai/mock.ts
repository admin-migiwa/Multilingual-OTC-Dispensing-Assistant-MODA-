/**
 * 開発用の「仮の AI」。API キーがなくても画面や流れを試せるように、決まった答えを返す。
 *
 * - 本物の AI のふりをしない：訳の頭に「［仮の AI］」を付け、画面にも「仮の AI」と出す。
 * - 緊急の判定はしない（いつも「当てはまらない」）。緊急の流れは、端末の中のキーワード照合と薬剤師の手動ボタンで試す。
 * - 本番の処理に紛れ込ませない：使うのは index.ts で AI_PROVIDER が mock（または未設定）のときだけ（CLAUDE.md 絶対に守るルール7）。
 * - 答えは本物と同じく、使う側で形を確かめる。
 */

import type { AiClient, AiRequest } from "./types.ts";

function firstText(request: AiRequest): string {
  for (const part of request.content) {
    if (part.type === "text") return part.text;
  }
  return "";
}

export function mockAiClient(): AiClient {
  return {
    provider: "mock",
    async generateJson(request: AiRequest): Promise<unknown> {
      const text = firstText(request);
      switch (request.task) {
        case "translate": {
          // 頼まれた形のとおりに答える（患者さんの文のときだけ、緊急の ID の欄がある）
          const properties = (request.schema.properties ?? {}) as Record<string, unknown>;
          const translation = `［仮の AI の訳］${text}`;
          return "emergencyRuleIds" in properties ? { translation, emergencyRuleIds: [] } : { translation };
        }
        case "back_translate":
          return { translation: `［仮の AI の訳し戻し］${text}` };
        case "read_product":
          return { readable: false, productNames: [], printedText: "" };
      }
    },
  };
}
