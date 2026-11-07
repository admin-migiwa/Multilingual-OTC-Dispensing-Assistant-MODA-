/**
 * AI の接続先を選ぶ、ただ1か所（CLAUDE.md「技術構成」）。
 *
 * 環境変数 AI_PROVIDER で切り替える（.env.example）。
 * - 未設定・mock：仮の AI（開発用）
 * - anthropic：Claude API。ANTHROPIC_API_KEY がなければエラーで止める（仮の AI に切り替えない。CLAUDE.md 絶対に守るルール7）
 * - それ以外（bedrock など、まだ作っていないもの）：エラーで止める
 */

import { anthropicAiClient } from "./anthropic.ts";
import { mockAiClient } from "./mock.ts";
import { AiError, type AiClient } from "./types.ts";

export { AiError, type AiClient, type AiContent, type AiErrorCode, type AiImageType, type AiRequest } from "./types.ts";

type Env = Readonly<Record<string, string | undefined>>;

export function createAiClient(env: Env): AiClient {
  const provider = (env.AI_PROVIDER ?? "").trim() || "mock";
  if (provider === "mock") return mockAiClient();
  if (provider === "anthropic") {
    const apiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
    if (!apiKey) throw new AiError("AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY が設定されていません");
    return anthropicAiClient(apiKey);
  }
  throw new AiError("AI_NOT_CONFIGURED", "AI_PROVIDER の値に対応していません");
}

let cached: AiClient | undefined;

/** サーバーで使う AI。初めて使うときに環境変数から作る */
export function defaultAiClient(): AiClient {
  cached ??= createAiClient(process.env);
  return cached;
}
