/**
 * 画面からサーバーの API（apps/web/src/app/api/sessions）を呼ぶ部分。
 *
 * - 通信が失敗したとき・サーバーが止まっているときは NetworkError を投げる。画面は推測で続けず、
 *   「通信が止まりました」の画面を出す（CLAUDE.md 絶対に守るルール7、docs/backlog.md C-06）。
 * - ルールで止まったとき（決められた形でない答えなど）は RuleError を投げる。画面は同じ質問をもう一度出す。
 */

import type { InterviewAnswers, QuestionId, SessionStatus, StockedDrugId } from "@moda/domain";
import type { LanguageCode } from "@moda/i18n";

export interface PatientView {
  readonly id: string;
  readonly language: LanguageCode;
  readonly status: SessionStatus;
  readonly nextQuestion: QuestionId | null;
  readonly selectedDrugs: readonly StockedDrugId[];
  readonly basicInterviewComplete: boolean;
  readonly interviewComplete: boolean;
}

export class NetworkError extends Error {
  override readonly name = "NetworkError";
}

export class RuleError extends Error {
  override readonly name = "RuleError";
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

async function call(path: string, body?: unknown): Promise<PatientView> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new NetworkError("通信できません");
  }
  if (response.status >= 500) throw new NetworkError("サーバーが応答しません");
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new NetworkError("サーバーの応答を読み取れません");
  }
  if (!response.ok) {
    const code = data !== null && typeof data === "object" && "error" in data ? String(data.error) : "UNKNOWN";
    throw new RuleError(code);
  }
  return data as PatientView;
}

export const sessionApi = {
  start: (language: LanguageCode) => call("/api/sessions", { language }),
  get: (id: string) => call(`/api/sessions/${encodeURIComponent(id)}`),
  answer: (id: string, answers: InterviewAnswers) => call(`/api/sessions/${encodeURIComponent(id)}/answers`, { answers }),
  chooseDrugs: (id: string, drugIds: readonly StockedDrugId[]) =>
    call(`/api/sessions/${encodeURIComponent(id)}/drugs`, { drugIds }),
  openEmergency: (
    id: string,
    input: { trigger: "keyword" | "staff"; matchedRuleIds?: readonly string[]; inputText?: string | null },
  ) => call(`/api/sessions/${encodeURIComponent(id)}/emergency`, input),
  recordFollowUp: (
    id: string,
    followUp: { answers: Record<string, string>; scale: number | null; observedRuleIds: readonly string[] },
  ) => call(`/api/sessions/${encodeURIComponent(id)}/emergency/follow-up`, followUp),
  decideEmergency: (id: string, decision: "show_119" | "not_emergency") =>
    call(`/api/sessions/${encodeURIComponent(id)}/emergency/decision`, { decision }),
};
