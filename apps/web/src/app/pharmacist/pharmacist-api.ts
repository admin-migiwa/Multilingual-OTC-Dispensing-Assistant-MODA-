/**
 * 薬剤師の確認画面からサーバーの API（apps/web/src/app/api/sessions/[id]/pharmacist）を呼ぶ部分。
 * 通信が失敗したら NetworkError、ルールで止まったら RuleError（code つき）を投げる。画面は推測で続けない（ルール7）。
 */

import type { StockedDrugId } from "@moda/domain";

import type { PharmacistView } from "@/server/pharmacist-service";

import { NetworkError, RuleError } from "../session-api";

export type { PharmacistView };

/** 禁忌の解除（T9b）に送るもの */
export interface OverrideInput {
  readonly drugId: StockedDrugId;
  readonly pharmacistId: string;
  readonly pin: string;
  readonly reasonCode: string;
  readonly reasonText: string | null;
}

async function call(path: string, body?: unknown): Promise<PharmacistView> {
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
  return data as PharmacistView;
}

const base = (id: string) => `/api/sessions/${encodeURIComponent(id)}/pharmacist`;

export const pharmacistApi = {
  get: (id: string) => call(base(id)),
  open: (id: string) => call(`${base(id)}/open`, {}),
  chooseSaleDrugs: (id: string, drugIds: readonly StockedDrugId[]) => call(`${base(id)}/sale-drugs`, { drugIds }),
  checkStep: (id: string, stepId: string, checked: boolean) => call(`${base(id)}/steps`, { stepId, checked }),
  back: (id: string) => call(`${base(id)}/back`, {}),
  decline: (id: string, reason: string) => call(`${base(id)}/decline`, { reason }),
  chooseCandidates: (id: string, drugIds: readonly StockedDrugId[]) => call(`${base(id)}/candidates`, { drugIds }),
  /** PIN で承認し、販売記録を作る（T9a）。PIN は画面に残さない */
  approve: (id: string, pharmacistId: string, pin: string) => call(`${base(id)}/approve`, { pharmacistId, pin }),
  /** 説明書を作る・印刷する・服薬指導を始める・承認の後の手順の ✓・会計案内へ（T10） */
  createGuidance: (id: string) => call(`${base(id)}/guidance`, {}),
  printGuidance: (id: string) => call(`${base(id)}/print`, {}),
  startCounseling: (id: string) => call(`${base(id)}/counsel`, {}),
  checkPostStep: (id: string, stepId: string, checked: boolean) => call(`${base(id)}/post-steps`, { stepId, checked }),
  checkout: (id: string) => call(`${base(id)}/checkout`, {}),
  /** 禁忌を解除する（T9b）。PIN は画面に残さない */
  override: (id: string, input: OverrideInput) => call(`${base(id)}/override`, input),
};
