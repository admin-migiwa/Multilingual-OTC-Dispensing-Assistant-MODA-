/**
 * AI を呼ぶ回数の上限（公開前の点検 11/8）。
 *
 * 公開した URL では誰でも翻訳・写真の読み取りを呼べるので、何度も呼ばれて API の残高を使い切られないよう、
 * サーバー全体で「1分あたり」「1時間あたり」の回数に上限をかける（サーバーは1台なので、メモリの数え方で足りる。backlog S-03）。
 * 上限を超えたら AI を呼ばずに AI_UNAVAILABLE で止める（仮の答えで続けない。CLAUDE.md 絶対に守るルール7）。
 * 送った文や答えはここでは見ない・ログに出さない（ルール9）。
 */

import { AiError, type AiClient, type AiRequest } from "./types.ts";

export interface AiRateLimits {
  readonly perMinute: number;
  readonly perHour: number;
}

/** 決まった値。デモの1回の接客（翻訳の往復・写真・説明書）は数十回に収まる */
export const DEFAULT_AI_RATE_LIMITS: AiRateLimits = { perMinute: 30, perHour: 300 };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** 環境変数（AI_MAX_CALLS_PER_MINUTE・AI_MAX_CALLS_PER_HOUR）から上限を読む。正の整数でなければ決まった値を使う */
export function aiRateLimitsFromEnv(env: Readonly<Record<string, string | undefined>>): AiRateLimits {
  const read = (value: string | undefined, fallback: number) => {
    const n = Number((value ?? "").trim());
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return {
    perMinute: read(env.AI_MAX_CALLS_PER_MINUTE, DEFAULT_AI_RATE_LIMITS.perMinute),
    perHour: read(env.AI_MAX_CALLS_PER_HOUR, DEFAULT_AI_RATE_LIMITS.perHour),
  };
}

/** AI の呼び出し口を包み、回数の上限をかける。上限に届いた呼び出しは数えない（AI を呼んでいないため） */
export function rateLimitedAiClient(
  inner: AiClient,
  limits: AiRateLimits,
  now: () => number = () => Date.now(),
): AiClient {
  const calls: number[] = [];
  return {
    provider: inner.provider,
    generateJson(request: AiRequest): Promise<unknown> {
      const t = now();
      while (calls.length > 0 && calls[0]! <= t - HOUR_MS) calls.shift();
      const lastMinute = calls.filter((at) => at > t - MINUTE_MS).length;
      if (lastMinute >= limits.perMinute || calls.length >= limits.perHour) {
        return Promise.reject(new AiError("AI_UNAVAILABLE", "AI を呼ぶ回数の上限に達しました"));
      }
      calls.push(t);
      return inner.generateJson(request);
    },
  };
}
