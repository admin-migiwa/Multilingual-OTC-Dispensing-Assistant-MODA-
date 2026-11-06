/**
 * Claude API（ハッカソン版の接続先。spec.md 決まったこと No.37）。
 *
 * - モデルは Claude Opus 5.5（claude-opus-5-5）。訳と読み取りは短い仕事なので、考える深さ（effort）は low にする。
 * - 答えは JSON Schema で形を決めて受け取る（構造化出力）。それでも使う側で必ずもう一度確かめる（CLAUDE.md 絶対に守るルール8）。
 * - 失敗・時間切れ・安全上の理由で答えなかったときは AiError で止める（ルール7）。
 * - 送った文や答えをログに出さない（ルール9）。ログに出すのはエラーの種類と状態コードだけ。
 * - API キーはサーバーの環境変数 ANTHROPIC_API_KEY だけ（ルール9）。
 */

import Anthropic from "@anthropic-ai/sdk";

import { AiError, type AiClient, type AiContent, type AiRequest } from "./types.ts";

export const ANTHROPIC_MODEL = "claude-opus-5-5";

/** 1回の呼び出しを待つ長さ（ミリ秒）。店頭で長く待たせないため短めにする */
const TIMEOUT_MS = 30_000;

function toBlock(part: AiContent): Anthropic.ContentBlockParam {
  if (part.type === "text") return { type: "text", text: part.text };
  return { type: "image", source: { type: "base64", media_type: part.mediaType, data: part.base64 } };
}

export function anthropicAiClient(apiKey: string): AiClient {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });

  return {
    provider: "anthropic",
    async generateJson(request: AiRequest): Promise<unknown> {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 4096,
          output_config: { effort: "low", format: { type: "json_schema", schema: request.schema } },
          system: request.system,
          messages: [{ role: "user", content: request.content.map(toBlock) }],
        });
      } catch (error: unknown) {
        // 中身は出さず、種類と状態コードだけを残す
        const status = error instanceof Anthropic.APIError ? error.status : undefined;
        console.error("AI の呼び出しに失敗", error instanceof Error ? error.name : typeof error, status ?? "");
        throw new AiError("AI_UNAVAILABLE", "AI を呼び出せませんでした");
      }

      if (response.stop_reason === "refusal") throw new AiError("AI_REFUSED", "AI が答えませんでした");
      if (response.stop_reason !== "end_turn") {
        throw new AiError("AI_INVALID_OUTPUT", "AI の答えが途中で切れました");
      }
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new AiError("AI_INVALID_OUTPUT", "AI の答えが JSON ではありません");
      }
    },
  };
}
