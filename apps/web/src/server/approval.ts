/**
 * 薬剤師の PIN での承認と、販売記録の作成（T9a。spec.md 決まったこと No.25、CLAUDE.md 絶対に守るルール1・6）。
 *
 * - 承認の処理の中で、PIN・問診が終わっていること・禁忌・販売手順（承認の前の手順の ✓）をサーバーで確かめる
 *   （画面の表示だけに頼らない）。どれかが足りなければ止め、記録は変えない。
 * - 販売記録は、承認と同じ書き込みで初めて作る（ルール1）。データベースがないので、接客の記録の中に販売記録を持ち、
 *   **1回の store.set** で承認（状態）と販売記録を一緒に残す。これがトランザクションの代わり。
 *   そのため、この処理は load から set まで同期のまま書き、途中に await をはさまない（はさむと2回の承認が重なりうる）。
 *   2回目の承認は、状態が approved なので transition で止まる。
 * - 販売記録は上書きしない。直すときや理解の確認の結果を残すときは、新しい版を足す（ルール6。理解の確認は T10）。
 * - 患者さんの氏名は持たない。PIN は記録・履歴・ログに出さない（ルール9）。
 */

import {
  DomainRuleError,
  STOCKED_DRUGS,
  abusePreventionAnswers,
  assertApprovalAllowed,
  assertInterviewComplete,
  assertSaleSelectable,
  saleSelectionsFor,
  undoStep,
  type StockedDrugId,
} from "@moda/domain";
import type { LanguageCode } from "@moda/i18n";

import {
  currentRound,
  currentSaleDrugIds,
  newReviewRound,
  japanDate,
  judgmentsOf,
  overriddenDrugIdsOf,
  procedureOf,
  withRound,
  type PharmacistReviewRound,
} from "./pharmacist-service.ts";
import type { PinVerifier } from "./pin.ts";
import { event, load, moveTo, type ServiceDeps, type SessionRecord } from "./session-service.ts";

/** 販売記録の1品目（法定項目の品名・数量） */
export interface SaleItem {
  readonly drugId: StockedDrugId;
  readonly name: string;
  readonly classification: string;
  /** 1包装の量（包装の量が決まっている薬だけ。例：E の小箱60錠） */
  readonly packageAmount: number | null;
  readonly quantity: number;
}

/** 販売記録の1つの版（足していくだけで、書き換えない） */
export interface SaleRecordVersion {
  readonly version: number;
  readonly at: string;
  /**
   * この版を作った理由（v1 は承認、理解の確認が済んだら understanding_confirmed。T10）。
   * 工程を戻したとき（11/7 依頼主の判断）：承認の取り消し approval_cancelled、もう一度の承認 reapproved、
   * 理解の確認のやり直し understanding_reset（sale-versions.ts）
   */
  readonly reason: "approved" | "understanding_confirmed" | "approval_cancelled" | "reapproved" | "understanding_reset";
  /** 販売日時（承認した時刻） */
  readonly soldAt: string;
  /** 販売・情報提供をした薬剤師（架空の一覧の ID と表示名） */
  readonly pharmacist: { readonly id: string; readonly name: string };
  readonly items: readonly SaleItem[];
  /** 販売手順の版（施行日）と、承認の前に済んだ手順 */
  readonly procedureEffectiveFrom: string;
  readonly completedStepIds: readonly string[];
  /** 承認のときの禁忌の判定（薬ごとの結果と理由。あとから確かめるため） */
  readonly judgments: readonly { readonly drugId: StockedDrugId; readonly verdict: string; readonly reasons: readonly string[] }[];
  /** 禁忌の解除（販売する薬について、この確認で解除したもの。理由と薬剤師。design.md 5節「禁忌解除の有無と理由」） */
  readonly overrides: readonly {
    readonly drugId: StockedDrugId;
    readonly at: string;
    readonly pharmacist: { readonly id: string; readonly name: string };
    readonly reasonCode: string;
    readonly reasonText: string | null;
    readonly judgedReasons: readonly string[];
  }[];
  /** 理解の確認の結果（v1 は「未」。確認が済んだら T10 で版を足す。No.25） */
  readonly understanding: "not_yet" | "confirmed";
  readonly language: LanguageCode;
}

export interface SaleRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly versions: readonly SaleRecordVersion[];
}

/** 今の確認で、承認の前に ✓ が付いている手順（今の「販売する薬」の選択の、手順ごとの最後の付け外し） */
export function completedStepIdsOf(round: PharmacistReviewRound): string[] {
  const choiceIndex = round.saleChoices.length - 1;
  const latest = new Map<string, boolean>();
  for (const check of round.stepChecks) {
    if (check.choiceIndex === choiceIndex) latest.set(check.stepId, check.checked);
  }
  return [...latest].filter(([, checked]) => checked).map(([stepId]) => stepId);
}

/**
 * 薬剤師が PIN で承認し、同じ書き込みで販売記録を作る（pharmacist_review → approved）。
 * 順に確かめる：PIN → 確認中であること・販売する薬 → 問診が終わっていること → 禁忌 → 承認の前の手順。
 */
export function approveSale(
  deps: ServiceDeps,
  pins: PinVerifier,
  id: string,
  input: { pharmacistId: string; pin: string },
): SessionRecord {
  const now = deps.now();
  // 1. PIN（違えば PinError。記録は変えない）
  const pharmacist = pins.verify(input.pharmacistId, input.pin, now);

  // 2. 薬剤師の確認中で、販売する薬が選ばれていること
  const record = load(deps, id);
  const { index, round } = currentRound(record);
  const drugIds = currentSaleDrugIds(round);
  if (drugIds.length === 0) throw new DomainRuleError("NO_DRUG_SELECTED", "販売する薬を選んでから承認します");

  // 3. 問診が終わっていること（判定に要る答えがそろっていること）
  assertInterviewComplete(record.interview);

  // 4. 禁忌の薬が入っていないこと（この確認の中で薬剤師が解除した薬は除く。T9b）
  const judgments = judgmentsOf(record);
  assertSaleSelectable(judgments, drugIds, overriddenDrugIdsOf(round));

  // 5. 承認の前の販売手順がすべて済んでいること（日本時間の日付で版を選ぶ。C-07・C-15）
  const procedure = procedureOf(record, drugIds, now);
  const completedStepIds = completedStepIdsOf(round);
  assertApprovalAllowed(procedure, completedStepIds);

  // ここから下は、例外が起きない計算と書き込みだけ
  const at = now.toISOString();
  const selections = saleSelectionsFor(drugIds, abusePreventionAnswers(record.interview));
  const items: SaleItem[] = selections.map(({ drug, quantity }) => {
    const stocked = STOCKED_DRUGS.find((d) => d.id === drug.id);
    // 取扱薬にない薬は、ここまでの判定で止まっているはず。万一のときも推測で埋めずに止める（ルール7）
    if (!stocked) throw new DomainRuleError("UNKNOWN_DRUG", `取扱薬 ${drug.id} が見つかりません`);
    return {
      drugId: stocked.id,
      name: stocked.name,
      classification: stocked.classification,
      packageAmount: drug.packageAmount ?? null,
      quantity,
    };
  });
  // 承認を取り消したあとの、もう一度の承認：前の販売記録に「reapproved」の版を足す（前の承認と取り消しを残す。ルール6）。
  // 取り消していない販売記録があるのに承認に来ることはない（状態が承認のあとなので currentRound で止まる）が、念のため止める
  const previous = record.saleRecord;
  const previousLatest = previous?.versions.at(-1);
  if (previous && previousLatest?.reason !== "approval_cancelled") {
    throw new DomainRuleError("INVALID_TRANSITION", "取り消していない販売記録があります");
  }
  const created: SaleRecord = {
    id: previous?.id ?? deps.newId(),
    sessionId: record.id,
    createdAt: previous?.createdAt ?? at,
    versions: [
      {
        version: (previousLatest?.version ?? 0) + 1,
        at,
        reason: previous ? "reapproved" : "approved",
        soldAt: at,
        pharmacist: { id: pharmacist.id, name: pharmacist.name },
        items,
        procedureEffectiveFrom: procedure.effectiveFrom,
        completedStepIds: procedure.steps.filter((s) => completedStepIds.includes(s.id)).map((s) => s.id),
        judgments: judgments
          .filter((j) => drugIds.includes(j.drugId))
          .map((j) => ({ drugId: j.drugId, verdict: j.verdict, reasons: j.reasons.map((r) => r.label) })),
        overrides: (round.overrides ?? [])
          .filter((o) => drugIds.includes(o.drugId))
          .map((o) => ({ drugId: o.drugId, at: o.at, pharmacist: o.pharmacist, reasonCode: o.reasonCode, reasonText: o.reasonText, judgedReasons: o.judgedReasons })),
        understanding: "not_yet",
        language: record.language,
      },
    ],
  };
  const saleRecord: SaleRecord = previous ? { ...previous, versions: [...previous.versions, ...created.versions] } : created;
  const closed = withRound(record, index, { ...round, closedAt: at, saleRecordId: saleRecord.id });
  const moved = moveTo(deps, closed, "approved");
  const next: SessionRecord = {
    ...moved,
    saleRecord,
    events: [...moved.events, event(deps, "approved", [pharmacist.id, saleRecord.id])],
  };
  deps.store.set(next);
  return next;
}

/**
 * 承認を取り消す（承認・服薬指導・会計案内 → 薬剤師の確認。11/7 依頼主の判断。PIN は求めない）。
 * - 販売記録は消さず、「approval_cancelled」の版を足す（ルール6）。もう一度承認すると「reapproved」の版を足す
 * - 薬剤師の確認を新しく開く（販売する薬・手順の ✓ は選び直し。前の確認は閉じたまま残る）
 * - もう一度承認するまで、印刷・服薬指導・会計はできない（状態が承認の前に戻るので assertActionAllowed で止まる。ルール1）
 */
export function cancelApproval(deps: ServiceDeps, id: string): SessionRecord {
  const record = load(deps, id);
  const snapshot = undoStep(record.snapshot, "cancel_approval");
  const sale = record.saleRecord;
  const latest = sale?.versions.at(-1);
  if (!sale || !latest || latest.reason === "approval_cancelled") {
    throw new DomainRuleError("NOT_APPROVED", "取り消す承認がありません");
  }
  const at = deps.now().toISOString();
  const cancelled: SaleRecordVersion = { ...latest, version: latest.version + 1, at, reason: "approval_cancelled", understanding: "not_yet" };
  const next: SessionRecord = {
    ...record,
    snapshot,
    saleRecord: { ...sale, versions: [...sale.versions, cancelled] },
    pharmacistReviews: [...(record.pharmacistReviews ?? []), newReviewRound(at)],
    events: [
      ...record.events,
      event(deps, "approval_cancelled", [sale.id]),
      event(deps, "sale_record_versioned", [sale.id, String(cancelled.version)]),
      event(deps, "status_changed", [snapshot.status]),
    ],
  };
  deps.store.set(next);
  return next;
}

/** 販売記録の一覧（新しい順）。記録の一覧の画面で使う（日本語の薬剤師用） */
export function listSaleRecords(records: Iterable<SessionRecord>): SaleRecord[] {
  return [...records]
    .flatMap((r) => (r.saleRecord ? [r.saleRecord] : []))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 店頭の日付（記録の一覧で日付ごとに見るため） */
export { japanDate };
