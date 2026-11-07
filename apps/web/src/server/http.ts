/**
 * API の入口で使う共通の処理。
 *
 * - ルールで止まったとき（DomainRuleError）は、エラーの種類（code）だけを返す。画面は code を見て同じ質問を出し直すなどする。
 * - 想定していないエラーは 500 で止める。推測で続けない（CLAUDE.md 絶対に守るルール7）。
 * - 問診の答えや入力された文をログに出さない（ルール9）。ログに出すのはエラーの種類だけ。
 */

import { DomainRuleError } from "@moda/domain";

import { AiError } from "./ai";
import { PinError } from "./pin";
import { SessionServiceError } from "./session-service";

export class BadRequestError extends Error {
  readonly code = "INVALID_REQUEST";
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new BadRequestError("送られた内容を読み取れません");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("送られた内容の形が違います");
  }
  return body as Record<string, unknown>;
}

function errorResponse(status: number, code: string): Response {
  return Response.json({ error: code }, { status, headers: { "Cache-Control": "no-store" } });
}

/** API の処理を包んで、エラーを決まった形の応答にする */
export async function handle(fn: () => Promise<unknown> | unknown): Promise<Response> {
  try {
    const result = await fn();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    if (error instanceof DomainRuleError) {
      return errorResponse(error.code === "SESSION_ALREADY_ENDED" ? 409 : 400, error.code);
    }
    if (error instanceof SessionServiceError) {
      return errorResponse(error.code === "SESSION_NOT_FOUND" ? 404 : 400, error.code);
    }
    if (error instanceof AiError) {
      // 設定がない・通信できないは 503、答えの形が違う・答えなかったは 502。どちらも推測で続けない（ルール7）
      const unavailable = error.code === "AI_NOT_CONFIGURED" || error.code === "AI_UNAVAILABLE";
      return errorResponse(unavailable ? 503 : 502, error.code);
    }
    if (error instanceof PinError) {
      // PIN の設定がないときも 400 で種類を返す（薬剤師の画面が「設定がありません」と出せるように。仮の PIN では通さない）
      return errorResponse(error.code === "PIN_LOCKED" ? 423 : 400, error.code);
    }
    if (error instanceof BadRequestError) {
      return errorResponse(400, error.code);
    }
    // 中身（健康情報が入りうる）は出さず、種類だけをログに残す
    console.error("API で想定していないエラー", error instanceof Error ? error.name : typeof error);
    return errorResponse(500, "INTERNAL_ERROR");
  }
}
